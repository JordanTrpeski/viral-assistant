// Calendar v2 read-only sync (phase 3): the stored shape of Google events, the pure Google-event parser, and
// the types the event fetcher speaks. No Google API calls live here (google.ts makes them); this module is pure
// so tests can check the mapping directly. See docs/design/calendar-v2.md and docs/build/phases.md.
//
// Nothing in phase 3 writes to Google. Events are pulled in and stored for display only.
import { addDays, isIsoDate, type IsoDate } from "../shared/dates.js";
import { isObject } from "../validation.js";
import { instantToWallClock } from "./timezone.js";

/** One Google event as we keep it in .viral/calendar/events.json. */
export interface StoredEvent {
  calendarId: string;
  /** Google's event id (a recurring instance has its own id because we fetch with singleEvents=true). */
  eventId: string;
  title: string;
  allDay: boolean;
  /** Timed only: the RFC3339 instant with offset exactly as Google gave it (e.g. "2027-03-28T03:30:00+02:00"). */
  start: string | null;
  end: string | null;
  /** Local start date: the settings-zone wall-clock date for timed events, the event's own date for all-day. */
  date: IsoDate;
  /** Local HH:MM start/end for timed events; null for all-day. */
  time: string | null;
  endTime: string | null;
  /** All-day inclusive last day (Google's exclusive end date minus one); null for timed events. */
  endDate: IsoDate | null;
  /** The IANA zone used to derive the local wall clock (the phase-2 settings zone). */
  timeZone: string;
  /** Google status, e.g. "confirmed" or "tentative". Cancelled events are removed, never stored. */
  status: string;
  /** The owning calendar's colour, for dimmed display in the week view. */
  colour: string | null;
  /** True when the event carries our viralItemId (phase 5b push). It is shown as its app item, never as a
   *  separate Google event, so a pushed deadline/event is not duplicated in the views. */
  appOwned: boolean;
}

/** Per-calendar sync state plus the display metadata the 7-day list needs. */
export interface SyncedCalendar {
  id: string;
  name: string;
  colour: string | null;
  /** Derived from the access role: holidays and shared calendars without owner/writer are read-only. */
  readOnly: boolean;
  /** Google's nextSyncToken for incremental syncs; null forces a full fetch. */
  syncToken: string | null;
}

/** Per-calendar display preferences, owned by the app (never sent to Google) and kept across syncs. */
export interface CalendarPref {
  /** Emphasise this calendar's events in the views. Display-only. */
  highlight: boolean;
  /** Hide this calendar's events from the views without deleting them. */
  hidden: boolean;
}

export interface EventsDocument {
  schemaVersion: 1;
  calendars: SyncedCalendar[];
  events: StoredEvent[];
  /** calendarId → display preference. */
  prefs: Record<string, CalendarPref>;
  /** The writable calendar that receives pushed items (phase 5). null = push nowhere. Never the primary by default. */
  writeCalendarId: string | null;
  /** ISO time of the last successful sync, or null if none has run. */
  lastSync: string | null;
}

export function emptyEventsDocument(): EventsDocument {
  return { schemaVersion: 1, calendars: [], events: [], prefs: {}, writeCalendarId: null, lastSync: null };
}

// ---- The fetcher's vocabulary (implemented for real in google.ts, faked in tests) ---------------------------

export interface EventFetchRequest {
  /** Present on an incremental sync; Google then ignores the time window. */
  syncToken?: string;
  pageToken?: string;
  timeMin: string;
  timeMax: string;
}

export interface EventFetchResult {
  status: "ok" | "gone" | "reconnect" | "error";
  items: unknown[];
  /** Set on the final page of a successful fetch. */
  nextSyncToken: string | null;
  nextPageToken: string | null;
  /** A short, body-free reason when status is "error" (e.g. "HTTP 500"). */
  error?: string;
}

// ---- Parsing ------------------------------------------------------------------------------------------------

export type ParsedEvent =
  | { kind: "event"; event: StoredEvent }
  | { kind: "cancelled"; eventId: string }
  | { kind: "skip" };

export interface ParseContext {
  calendarId: string;
  colour: string | null;
  /** The zone the local wall clock is computed in (the phase-2 settings default). */
  zone: string;
}

/**
 * Maps one raw Google event to our stored shape. Pure. Cancelled events return a removal signal; events without a
 * usable start are skipped. Timed events keep Google's instant/offset and gain a local wall clock; all-day events
 * keep dates only, and Google's exclusive end date becomes the inclusive last day.
 */
export function parseGoogleEvent(raw: unknown, context: ParseContext): ParsedEvent {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id === "") return { kind: "skip" };
  const eventId = raw.id;
  const status = typeof raw.status === "string" ? raw.status : "confirmed";
  if (status === "cancelled") return { kind: "cancelled", eventId };

  const title = typeof raw.summary === "string" && raw.summary.trim() !== "" ? raw.summary : "(no title)";
  const start = isObject(raw.start) ? raw.start : {};
  const end = isObject(raw.end) ? raw.end : {};
  const extended = isObject(raw.extendedProperties) && isObject(raw.extendedProperties.private) ? raw.extendedProperties.private : {};
  const appOwned = typeof extended.viralItemId === "string" && extended.viralItemId !== "";
  const base = { calendarId: context.calendarId, eventId, title, status, colour: context.colour, timeZone: context.zone, appOwned };

  if (typeof start.date === "string" && isIsoDate(start.date)) {
    const endExclusive = typeof end.date === "string" && isIsoDate(end.date) ? end.date : addDays(start.date, 1);
    const lastDay = addDays(endExclusive, -1);
    const endDate = lastDay < start.date ? start.date : lastDay; // never before the start
    return { kind: "event", event: { ...base, allDay: true, start: null, end: null, date: start.date, time: null, endTime: null, endDate } };
  }

  if (typeof start.dateTime === "string") {
    const startMs = Date.parse(start.dateTime);
    if (Number.isNaN(startMs)) return { kind: "skip" };
    const wall = instantToWallClock(startMs, context.zone);
    const endGiven = typeof end.dateTime === "string" ? end.dateTime : null;
    const endTime = endGiven !== null && !Number.isNaN(Date.parse(endGiven)) ? instantToWallClock(Date.parse(endGiven), context.zone).time : null;
    return { kind: "event", event: { ...base, allDay: false, start: start.dateTime, end: endGiven, date: wall.date, time: wall.time, endTime, endDate: null } };
  }

  return { kind: "skip" };
}

// ---- Validation (lenient: a malformed file should not crash the dashboard) ----------------------------------

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function validateStoredEvent(value: unknown): StoredEvent | null {
  if (!isObject(value) || typeof value.calendarId !== "string" || typeof value.eventId !== "string") return null;
  return {
    calendarId: value.calendarId,
    eventId: value.eventId,
    title: str(value.title, "(no title)"),
    allDay: value.allDay === true,
    start: strOrNull(value.start),
    end: strOrNull(value.end),
    date: isIsoDate(value.date) ? value.date : "1970-01-01",
    time: strOrNull(value.time),
    endTime: strOrNull(value.endTime),
    endDate: isIsoDate(value.endDate) ? value.endDate : null,
    timeZone: str(value.timeZone, "UTC"),
    status: str(value.status, "confirmed"),
    colour: strOrNull(value.colour),
    appOwned: value.appOwned === true
  };
}

function validateSyncedCalendar(value: unknown): SyncedCalendar | null {
  if (!isObject(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    name: str(value.name, value.id),
    colour: strOrNull(value.colour),
    readOnly: value.readOnly !== false,
    syncToken: strOrNull(value.syncToken)
  };
}

function validatePrefs(value: unknown): Record<string, CalendarPref> {
  if (!isObject(value)) return {};
  const prefs: Record<string, CalendarPref> = {};
  for (const [id, pref] of Object.entries(value)) {
    if (!isObject(pref)) continue;
    prefs[id] = { highlight: pref.highlight === true, hidden: pref.hidden === true };
  }
  return prefs;
}

export function validateEventsDocument(value: unknown): EventsDocument {
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error("events store must be an object with schemaVersion 1");
  return {
    schemaVersion: 1,
    calendars: (Array.isArray(value.calendars) ? value.calendars : []).map(validateSyncedCalendar).filter((calendar): calendar is SyncedCalendar => calendar !== null),
    events: (Array.isArray(value.events) ? value.events : []).map(validateStoredEvent).filter((event): event is StoredEvent => event !== null),
    prefs: validatePrefs(value.prefs),
    writeCalendarId: strOrNull(value.writeCalendarId),
    lastSync: strOrNull(value.lastSync)
  };
}

// ---- Display helper -----------------------------------------------------------------------------------------

export interface UpcomingEvent {
  title: string;
  calendarName: string;
  date: IsoDate;
  time: string | null;
  allDay: boolean;
}

/** Events overlapping [today, today + days). Temporary 7-day list for the setup page; phase 4 replaces it. */
export function upcomingEvents(document: EventsDocument, today: IsoDate, days: number): UpcomingEvent[] {
  const windowEnd = addDays(today, days - 1);
  const names = new Map(document.calendars.map((calendar) => [calendar.id, calendar.name]));
  return document.events
    .filter((event) => {
      if (event.appOwned) return false; // app-owned events show as their app item, not a separate Google event
      const lastDay = event.allDay ? event.endDate ?? event.date : event.date;
      return event.date <= windowEnd && lastDay >= today;
    })
    .sort((a, b) => (a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") : a.date.localeCompare(b.date)))
    .map((event) => ({ title: event.title, calendarName: names.get(event.calendarId) ?? event.calendarId, date: event.date, time: event.time, allDay: event.allDay }));
}
