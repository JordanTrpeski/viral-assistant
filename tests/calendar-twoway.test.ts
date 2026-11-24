import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Item } from "../src/dashboard/calendar/model.js";
import type { WriteResult } from "../src/dashboard/calendar/google.js";
import { emptyEventsDocument, validateEventsDocument, type EventFetchRequest, type EventFetchResult, type EventsDocument } from "../src/dashboard/calendar/events.js";
import { buildEventBody, isPushable, MAX_LEAD_MINUTES, MAX_OVERRIDES, parseEventForPull, reminderOverrides } from "../src/dashboard/calendar/push.js";
import { CalendarService } from "../src/dashboard/calendar/service.js";
import { JsonDocumentStore } from "../src/dashboard/store.js";
import {
  TwoWaySync, emptyConflictsDocument, emptyLinksDocument, resolveTarget, validateConflictsDocument, validateLinksDocument,
  type ConflictsDocument, type GoogleWriter, type LinksDocument
} from "../src/dashboard/calendar/twoway.js";

const ZONE = "Europe/Ljubljana";

function timedItem(date: string, time: string, over: Partial<Item> = {}): Item {
  return {
    id: over.id ?? "item-1", kind: over.kind ?? "task", title: over.title ?? "Thing",
    categoryId: over.categoryId ?? null, subcategoryId: null, allDay: over.allDay ?? false, date, time: over.time !== undefined ? over.time : time, timeZone: ZONE,
    dueDate: null, plannedDate: null, priority: "normal", status: over.status ?? "open", recurrence: over.recurrence ?? null,
    leadTimes: over.leadTimes ?? null, snoozedUntil: null, created: "x", updated: over.updated ?? "2027-01-01T00:00:00Z"
  };
}

// ---- pure mapping -------------------------------------------------------------------------------------------

test("two-way: the write target refuses a read-only or unknown calendar and never auto-picks the primary", () => {
  const base: EventsDocument = { ...emptyEventsDocument(), calendars: [
    { id: "ro", name: "Holidays", colour: null, readOnly: true, syncToken: null },
    { id: "work", name: "Work", colour: null, readOnly: false, syncToken: null }
  ] };
  assert.equal(resolveTarget({ ...base, writeCalendarId: "ro" }), null, "a read-only chosen calendar is refused");
  assert.equal(resolveTarget({ ...base, writeCalendarId: "missing" }), null, "an unknown chosen calendar is refused");
  assert.equal(resolveTarget({ ...base, writeCalendarId: "work" })?.id, "work", "a writable chosen calendar is used");
  assert.equal(resolveTarget({ ...base, writeCalendarId: null }), null, "no default without a 'Viral test' calendar");
  const withViral: EventsDocument = { ...base, calendars: [...base.calendars, { id: "v", name: "Viral test", colour: null, readOnly: false, syncToken: null }], writeCalendarId: null };
  assert.equal(resolveTarget(withViral)?.id, "v", "the default is a writable 'Viral test' only");
});

test("two-way: a timed item pushes the correct instant and time zone across the clock changes", () => {
  const ctx = { colorId: null, leadDays: [], categoryId: null, zone: ZONE };
  const winter = buildEventBody(timedItem("2027-01-15", "09:00"), ctx);
  assert.deepEqual(winter.start, { dateTime: "2027-01-15T08:00:00.000Z", timeZone: ZONE });
  assert.deepEqual(winter.end, { dateTime: "2027-01-15T08:30:00.000Z", timeZone: ZONE }, "end is start + 30 minutes");
  assert.equal((buildEventBody(timedItem("2027-07-15", "09:00"), ctx).start as { dateTime: string }).dateTime, "2027-07-15T07:00:00.000Z", "summer is CEST (+02:00)");
  assert.equal((buildEventBody(timedItem("2027-03-28", "03:30"), ctx).start as { dateTime: string }).dateTime, "2027-03-28T01:30:00.000Z", "after the March spring-forward");
  assert.equal((buildEventBody(timedItem("2027-10-31", "01:30"), ctx).start as { dateTime: string }).dateTime, "2027-10-30T23:30:00.000Z", "before the October fall-back");
});

test("two-way: colour maps to the category, item/category ids go to private props, and reminders obey the limits", () => {
  const body = buildEventBody(timedItem("2027-01-15", "09:00", { id: "it1", categoryId: "cat1" }), { colorId: "5", leadDays: [0, 1, 2], categoryId: "cat1", zone: ZONE });
  assert.equal(body.colorId, "5");
  assert.deepEqual(body.reminders, { useDefault: false, overrides: [{ method: "popup", minutes: 0 }, { method: "popup", minutes: 1440 }, { method: "popup", minutes: 2880 }] });
  assert.deepEqual((body.extendedProperties as { private: unknown }).private, { viralItemId: "it1", viralCategoryId: "cat1" });

  const plain = buildEventBody(timedItem("2027-01-15", "09:00"), { colorId: null, leadDays: [], categoryId: null, zone: ZONE });
  assert.equal(plain.colorId, undefined, "uncategorised items get Google's default colour");
  assert.deepEqual((plain.extendedProperties as { private: { viralCategoryId: string } }).private.viralCategoryId, "");
});

test("two-way: reminder overrides keep the first 5 and clamp to Google's 40320-minute maximum", () => {
  assert.equal(reminderOverrides([1, 2, 3, 4, 5, 6, 7]).length, MAX_OVERRIDES);
  assert.deepEqual(reminderOverrides([100]), [{ method: "popup", minutes: MAX_LEAD_MINUTES }]);
});

const recurrence = { freq: "weekly" as const, anchor: "2027-02-10", until: null, skips: [] };

test("5b: a deadline with a time is a timed event; without a time it is an all-day event on its due date", () => {
  const ctx = { colorId: null, leadDays: [], categoryId: null, zone: ZONE };
  const timed = buildEventBody(timedItem("2027-02-10", "09:00", { kind: "task" }), ctx);
  assert.deepEqual(timed.start, { dateTime: "2027-02-10T08:00:00.000Z", timeZone: ZONE });

  const allDay = buildEventBody(timedItem("2027-02-10", "09:00", { kind: "task", allDay: true, time: null }), ctx);
  assert.deepEqual(allDay.start, { date: "2027-02-10" });
  assert.deepEqual(allDay.end, { date: "2027-02-11" }, "Google's end date is the day after (exclusive)");
});

test("5b: a deadline pushes whether timed or all-day; an all-day event stays in the app; recurring never pushes", () => {
  assert.equal(isPushable(timedItem("2027-02-10", "09:00", { kind: "task" })), true);
  assert.equal(isPushable(timedItem("2027-02-10", "09:00", { kind: "task", allDay: true, time: null })), true, "all-day deadline pushes");
  assert.equal(isPushable(timedItem("2027-02-10", "09:00", { kind: "reminder", allDay: true, time: null })), false, "all-day event stays in the app");
  assert.equal(isPushable(timedItem("2027-02-10", "09:00", { kind: "reminder" })), true, "timed event pushes");
  assert.equal(isPushable(timedItem("2027-02-10", "09:00", { kind: "task", recurrence })), false, "recurring never pushes");
});

test("5b: an all-day Google event parses to an all-day app item on its date", () => {
  const fields = parseEventForPull({ summary: "Holiday", start: { date: "2027-02-10" }, end: { date: "2027-02-11" } }, ZONE)!;
  assert.deepEqual([fields.date, fields.time, fields.allDay], ["2027-02-10", null, true]);
});

test("5b: a completed deadline gets the ✓ prefix; un-ticking removes it; renaming keeps it; events never get it", () => {
  const ctx = { colorId: null, leadDays: [], categoryId: null, zone: ZONE };
  const titleOf = (over: Partial<Item>): unknown => buildEventBody(timedItem("2027-02-10", "09:00", { kind: "task", ...over }), ctx).summary;
  assert.equal(titleOf({ title: "Essay", status: "open" }), "Essay");
  assert.equal(titleOf({ title: "Essay", status: "done" }), "✓ Done: Essay", "ticking adds the prefix");
  assert.equal(titleOf({ title: "Essay final", status: "done" }), "✓ Done: Essay final", "renaming while done keeps the prefix");
  assert.equal(titleOf({ title: "✓ Done: Essay", status: "done" }), "✓ Done: Essay", "no double prefix");
  assert.equal(buildEventBody(timedItem("2027-02-10", "09:00", { kind: "reminder", title: "Birthday", status: "done" }), ctx).summary, "Birthday", "events are never prefixed");
});

test("5b: completing a deadline pushes the ✓ Done title on the next sync", async () => {
  const h = await harness();
  try {
    const item = await h.service.createItem({ kind: "task", title: "Pay tax", date: "2027-02-10", time: "09:00" });
    await h.two.reconcile();
    const eventId = (await h.links.read()).links[0]!.eventId;
    h.setNow("2027-01-02T00:00:00.000Z");
    await h.service.completeItem(item.id);
    await h.two.reconcile();
    assert.equal((h.google.events.get(eventId) as { summary: string }).summary, "✓ Done: Pay tax");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

// ---- reconciler over a simulated calendar -------------------------------------------------------------------

class FakeGoogle implements GoogleWriter {
  events = new Map<string, Record<string, unknown>>();
  writeScope = true;
  calls = { insert: 0, patch: 0 };
  private tick = 0;
  private stamp(): string { this.tick += 1; return new Date(Date.UTC(2027, 0, 1, 0, 0, 0, this.tick)).toISOString(); }
  async hasWriteScope(): Promise<boolean> { return this.writeScope; }
  async fetchEvents(_calendarId: string, request: EventFetchRequest): Promise<EventFetchResult> {
    if (request.pageToken) return { status: "ok", items: [], nextSyncToken: null, nextPageToken: null };
    return { status: "ok", items: [...this.events.values()], nextSyncToken: "tok", nextPageToken: null };
  }
  async insertEvent(_calendarId: string, body: Record<string, unknown>): Promise<WriteResult> {
    this.calls.insert += 1; const id = `g${this.calls.insert}`;
    const event = { ...body, id, updated: this.stamp() }; this.events.set(id, event);
    return { status: "ok", event };
  }
  async patchEvent(_calendarId: string, eventId: string, body: Record<string, unknown>): Promise<WriteResult> {
    this.calls.patch += 1; const current = this.events.get(eventId) ?? { id: eventId };
    const event = { ...current, ...body, id: eventId, updated: this.stamp() }; this.events.set(eventId, event);
    return { status: "ok", event };
  }
  editEvent(id: string, patch: Record<string, unknown>): void {
    const current = this.events.get(id)!;
    const updated = typeof patch.updated === "string" ? patch.updated : this.stamp();
    this.events.set(id, { ...current, ...patch, updated });
  }
  injectEvent(event: Record<string, unknown>): void { this.events.set(event.id as string, event); }
}

interface Harness {
  dir: string;
  service: CalendarService;
  links: JsonDocumentStore<LinksDocument>;
  conflicts: JsonDocumentStore<ConflictsDocument>;
  google: FakeGoogle;
  two: TwoWaySync;
  setNow(date: string): void;
}

async function harness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "viral-twoway-"));
  let now = new Date("2027-01-01T00:00:00.000Z");
  const clock = (): Date => now;
  const service = new CalendarService(join(dir, "store.json"), { clock });
  const events = new JsonDocumentStore<EventsDocument>(join(dir, "events.json"), validateEventsDocument, emptyEventsDocument);
  await events.update((draft) => {
    draft.calendars = [
      { id: "viral", name: "Viral test", colour: null, readOnly: false, syncToken: null },
      { id: "ro", name: "Holidays", colour: null, readOnly: true, syncToken: null }
    ];
    draft.writeCalendarId = "viral";
  });
  const links = new JsonDocumentStore<LinksDocument>(join(dir, "links.json"), validateLinksDocument, emptyLinksDocument);
  const conflicts = new JsonDocumentStore<ConflictsDocument>(join(dir, "conflicts.json"), validateConflictsDocument, emptyConflictsDocument);
  const google = new FakeGoogle();
  const two = new TwoWaySync(google, service, events, links, conflicts, { clock, zone: () => ZONE });
  return { dir, service, links, conflicts, google, two, setNow: (date) => { now = new Date(date); } };
}

test("two-way: a timed item is pushed to the chosen calendar, then updated (not duplicated)", async () => {
  const h = await harness();
  try {
    const item = await h.service.createItem({ kind: "task", title: "Dentist", date: "2027-02-10", time: "09:00" });
    const first = await h.two.reconcile();
    assert.equal(first.pushed, 1);
    assert.equal(h.google.calls.insert, 1);
    assert.equal((await h.links.read()).links.length, 1);

    h.setNow("2027-01-01T01:00:00.000Z");
    await h.service.updateItem(item.id, { title: "Dentist appointment" });
    const second = await h.two.reconcile();
    assert.deepEqual([second.pushed, second.updated], [0, 1]);
    assert.equal(h.google.calls.insert, 1, "no duplicate insert");
    assert.equal(h.google.calls.patch, 1);
    assert.equal((await h.links.read()).links.length, 1, "still a single link");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("two-way: both sides changed — the newer app edit wins and the Google version goes to conflicts", async () => {
  const h = await harness();
  try {
    const item = await h.service.createItem({ kind: "task", title: "Call", date: "2027-02-10", time: "09:00" });
    await h.two.reconcile();
    const eventId = (await h.links.read()).links[0]!.eventId;
    h.google.editEvent(eventId, { summary: "Call (edited in Google)" });
    h.setNow("2030-01-01T00:00:00.000Z");
    await h.service.updateItem(item.id, { title: "Call mum" });

    const result = await h.two.reconcile();
    assert.equal(result.conflicts, 1);
    assert.equal(result.updated, 1, "the newer app edit is pushed");
    const conflicts = (await h.conflicts.read()).conflicts;
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.loser, "google");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("two-way: both sides changed — the newer Google edit wins and the app version goes to conflicts", async () => {
  const h = await harness();
  try {
    const item = await h.service.createItem({ kind: "task", title: "Gym", date: "2027-02-10", time: "09:00" });
    await h.two.reconcile();
    const eventId = (await h.links.read()).links[0]!.eventId;
    h.setNow("2027-01-01T00:10:00.000Z");
    await h.service.updateItem(item.id, { title: "Gym morning" });
    h.google.editEvent(eventId, { summary: "Gym PM", updated: "2031-01-01T00:00:00.000Z" });

    const result = await h.two.reconcile();
    assert.equal(result.conflicts, 1);
    assert.equal(result.pulled, 1, "the newer Google edit is pulled");
    assert.equal((await h.service.getItem(item.id)).title, "Gym PM");
    assert.ok((await h.conflicts.read()).conflicts.some((entry) => entry.loser === "app"));
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("two-way: an app delete is not pushed; the link is marked pending delete", async () => {
  const h = await harness();
  try {
    const item = await h.service.createItem({ kind: "task", title: "Temp", date: "2027-02-10", time: "09:00" });
    await h.two.reconcile();
    const before = { insert: h.google.calls.insert, patch: h.google.calls.patch };
    await h.service.deleteItem(item.id);

    const result = await h.two.reconcile();
    assert.equal(result.pendingDeletes, 1);
    assert.equal(h.google.calls.insert, before.insert, "the delete causes no insert");
    assert.equal(h.google.calls.patch, before.patch, "the delete is not pushed as a patch");
    assert.equal((await h.links.read()).links[0]!.pendingDelete, true);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("two-way: a timed event created in Google is pulled in as an app item", async () => {
  const h = await harness();
  try {
    h.google.injectEvent({
      id: "ext1", status: "confirmed", summary: "External meeting",
      start: { dateTime: "2027-02-10T09:00:00+01:00", timeZone: ZONE }, end: { dateTime: "2027-02-10T10:00:00+01:00" },
      updated: "2027-02-01T00:00:00.000Z"
    });
    const result = await h.two.reconcile();
    assert.equal(result.pulled, 1);
    assert.ok((await h.service.listItems()).some((item) => item.title === "External meeting"));
    assert.ok((await h.links.read()).links.some((link) => link.eventId === "ext1"));
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("two-way: without the write scope nothing is pushed and it reports Reconnect Google", async () => {
  const h = await harness();
  try {
    h.google.writeScope = false;
    await h.service.createItem({ kind: "task", title: "Blocked", date: "2027-02-10", time: "09:00" });
    const result = await h.two.reconcile();
    assert.equal(result.reconnect, true);
    assert.equal(result.pushed, 0);
    assert.equal(h.google.calls.insert, 0);
    assert.match(result.line, /Reconnect Google/);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("two-way: an all-day or recurring item is never pushed", async () => {
  const h = await harness();
  try {
    await h.service.createItem({ kind: "reminder", title: "Birthday", date: "2027-02-10", allDay: true });
    await h.service.createItem({ kind: "task", title: "Weekly", date: "2027-02-10", time: "09:00", recurrence: { freq: "weekly" } });
    const result = await h.two.reconcile();
    assert.equal(result.pushed, 0, "all-day and recurring items stay in the app");
    assert.equal(h.google.calls.insert, 0);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});
