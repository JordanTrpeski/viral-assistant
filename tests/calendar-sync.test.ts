import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ReconnectRequiredError, type GoogleCalendar } from "../src/dashboard/calendar/google.js";
import { emptyEventsDocument, validateEventsDocument, type EventFetchRequest, type EventFetchResult, type EventsDocument, type StoredEvent } from "../src/dashboard/calendar/events.js";
import { CalendarSync, formatSyncLine, type EventSource } from "../src/dashboard/calendar/sync.js";
import { JsonDocumentStore } from "../src/dashboard/store.js";

const ZONE = "Europe/Ljubljana";
const CLOCK = (): Date => new Date("2027-01-10T00:00:00.000Z");

// ---- helpers ------------------------------------------------------------------------------------------------

function cal(id: string, role: string, extra: Partial<GoogleCalendar> = {}): GoogleCalendar {
  const writable = role === "owner" || role === "writer";
  return { id, name: extra.name ?? id, accessRole: role, primary: extra.primary ?? false, writable, colour: extra.colour ?? null };
}

const gone: EventFetchResult = { status: "gone", items: [], nextSyncToken: null, nextPageToken: null };
const httpError: EventFetchResult = { status: "error", items: [], nextSyncToken: null, nextPageToken: null, error: "HTTP 500" };
function ok(items: unknown[], nextSyncToken: string | null, nextPageToken: string | null = null): EventFetchResult {
  return { status: "ok", items, nextSyncToken, nextPageToken };
}

interface Recorded { id: string; request: EventFetchRequest; }

function makeSource(calendars: GoogleCalendar[], handlers: Record<string, (request: EventFetchRequest) => EventFetchResult>, calls: Recorded[] = []): EventSource {
  return {
    async listCalendars() { return calendars; },
    async fetchEvents(id, request) { calls.push({ id, request }); return handlers[id]!(request); }
  };
}

async function freshStore(): Promise<{ store: JsonDocumentStore<EventsDocument>; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "viral-sync-"));
  return { store: new JsonDocumentStore<EventsDocument>(join(dir, "events.json"), validateEventsDocument, emptyEventsDocument), dir };
}

function seedEvent(calendarId: string, eventId: string, over: Partial<StoredEvent> = {}): StoredEvent {
  return { calendarId, eventId, title: "Seed", allDay: false, start: "2027-01-15T09:00:00+01:00", end: null, date: "2027-01-15", time: "09:00", endTime: null, endDate: null, timeZone: ZONE, status: "confirmed", colour: null, ...over };
}

function newSync(store: JsonDocumentStore<EventsDocument>, source: EventSource): CalendarSync {
  return new CalendarSync(source, store, { clock: CLOCK, zone: () => ZONE });
}

// ---- tests --------------------------------------------------------------------------------------------------

test("sync: timed and all-day events are stored correctly, including the all-day last day", async () => {
  const { store, dir } = await freshStore();
  try {
    const source = makeSource([cal("primary", "owner", { primary: true })], {
      primary: () => ok([
        { id: "t1", status: "confirmed", summary: "Standup", start: { dateTime: "2027-01-15T09:00:00+01:00" }, end: { dateTime: "2027-01-15T09:30:00+01:00" } },
        { id: "a1", status: "confirmed", summary: "Trip", start: { date: "2027-02-01" }, end: { date: "2027-02-04" } }
      ], "token-1")
    });
    await newSync(store, source).syncAll();

    const events = (await store.read()).events;
    const timed = events.find((event) => event.eventId === "t1")!;
    assert.equal(timed.allDay, false);
    assert.equal(timed.start, "2027-01-15T09:00:00+01:00", "the instant/offset is kept exactly as Google gave it");
    assert.deepEqual([timed.date, timed.time, timed.endTime], ["2027-01-15", "09:00", "09:30"], "local wall clock derived in the settings zone");

    const allDay = events.find((event) => event.eventId === "a1")!;
    assert.equal(allDay.allDay, true);
    assert.equal(allDay.time, null);
    assert.deepEqual([allDay.date, allDay.endDate], ["2027-02-01", "2027-02-03"], "Google's exclusive end date becomes the inclusive last day");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("sync: a cancelled event is removed from the store", async () => {
  const { store, dir } = await freshStore();
  try {
    await store.update((draft) => {
      draft.calendars = [{ id: "cal1", name: "Cal 1", colour: null, readOnly: false, syncToken: "s1" }];
      draft.events = [seedEvent("cal1", "E1", { title: "Old" })];
    });
    const source = makeSource([cal("cal1", "owner")], {
      cal1: (request) => request.syncToken === "s1" ? ok([{ id: "E1", status: "cancelled" }], "s2") : ok([], "s2")
    });
    const result = await newSync(store, source).syncAll();

    assert.equal((await store.read()).events.find((event) => event.eventId === "E1"), undefined, "the event is gone");
    assert.equal(result.removed, 1);
    assert.equal(result.changed, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("sync: a 410 Gone triggers a full resync for that calendar only", async () => {
  const { store, dir } = await freshStore();
  try {
    await store.update((draft) => {
      draft.calendars = [
        { id: "calA", name: "A", colour: null, readOnly: false, syncToken: "sA1" },
        { id: "calB", name: "B", colour: null, readOnly: false, syncToken: "sB1" }
      ];
      draft.events = [seedEvent("calA", "old-A"), seedEvent("calB", "keep-B")];
    });
    const calls: Recorded[] = [];
    const source = makeSource([cal("calA", "owner"), cal("calB", "owner")], {
      calA: (request) => request.syncToken ? gone : ok([{ id: "new-A", status: "confirmed", summary: "Fresh", start: { date: "2027-01-20" }, end: { date: "2027-01-21" } }], "sA2"),
      calB: (request) => request.syncToken === "sB1" ? ok([], "sB2") : ok([], "sB2")
    }, calls);
    const result = await newSync(store, source).syncAll();

    assert.equal(result.fullResyncs, 1, "exactly one calendar was fully resynced");
    const document = await store.read();
    assert.equal(document.events.find((event) => event.eventId === "old-A"), undefined, "calA's stale event was cleared by the full resync");
    assert.ok(document.events.some((event) => event.eventId === "new-A"), "calA's fresh event is present");
    assert.ok(document.events.some((event) => event.eventId === "keep-B"), "calB kept its event (no full resync)");
    assert.ok(!calls.some((call) => call.id === "calB" && !call.request.syncToken), "calB was never fetched without a sync token");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("sync: read-only roles produce read-only calendars", async () => {
  const { store, dir } = await freshStore();
  try {
    const source = makeSource([cal("mine", "owner"), cal("holidays", "reader", { name: "Holidays" })], {
      mine: () => ok([], "tm"),
      holidays: () => ok([], "th")
    });
    await newSync(store, source).syncAll();

    const calendars = (await store.read()).calendars;
    assert.equal(calendars.find((calendar) => calendar.id === "mine")!.readOnly, false);
    assert.equal(calendars.find((calendar) => calendar.id === "holidays")!.readOnly, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("sync: a failing calendar does not stop the others", async () => {
  const { store, dir } = await freshStore();
  try {
    const source = makeSource([cal("bad", "owner", { name: "Broken" }), cal("good", "owner", { name: "Good" })], {
      bad: () => httpError,
      good: () => ok([{ id: "g1", status: "confirmed", summary: "Works", start: { date: "2027-01-12" }, end: { date: "2027-01-13" } }], "tg")
    });
    const result = await newSync(store, source).syncAll();

    assert.equal(result.synced, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]!.calendar, "Broken");
    assert.ok((await store.read()).events.some((event) => event.eventId === "g1"), "the good calendar still synced");
    assert.match(result.line, /Failed: Broken \(Google had a server error\)\./);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("sync: the result line matches the counts", async () => {
  const { store, dir } = await freshStore();
  try {
    const source = makeSource([cal("primary", "owner")], {
      primary: () => ok([
        { id: "x1", status: "confirmed", summary: "One", start: { date: "2027-01-11" }, end: { date: "2027-01-12" } },
        { id: "x2", status: "confirmed", summary: "Two", start: { date: "2027-01-12" }, end: { date: "2027-01-13" } }
      ], "t")
    });
    const result = await newSync(store, source).syncAll();
    assert.equal(result.line, "Synced 1 calendars: 2 events new or changed, 0 removed, 0 full resyncs.");
    assert.equal(result.reconnect, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("sync: a refused sign-in reports Reconnect Google and does not loop", async () => {
  const { store, dir } = await freshStore();
  try {
    const source: EventSource = {
      async listCalendars() { throw new ReconnectRequiredError("Reconnect Google: the saved sign-in is no longer valid."); },
      async fetchEvents() { throw new Error("must not be called"); }
    };
    const result = await newSync(store, source).syncAll();
    assert.equal(result.reconnect, true);
    assert.equal(result.line, "Reconnect Google.");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("sync: formatSyncLine renders counts and failures without raw bodies", () => {
  assert.equal(
    formatSyncLine({ synced: 3, changed: 5, removed: 2, fullResyncs: 1, failures: [], reconnect: false }),
    "Synced 3 calendars: 5 events new or changed, 2 removed, 1 full resyncs."
  );
  assert.equal(
    formatSyncLine({ synced: 1, changed: 0, removed: 0, fullResyncs: 0, failures: [{ calendar: "Work", reason: "could not be reached" }], reconnect: false }),
    "Synced 1 calendars: 0 events new or changed, 0 removed, 0 full resyncs. Failed: Work (could not be reached)."
  );
});
