// Calendar v2 read-only sync engine (phase 3). Pulls events from every calendar in the account into
// .viral/calendar/events.json using Google sync tokens, with a full resync when a token expires (410 Gone).
// Pure orchestration over an injected EventSource, so tests never touch the real Google API. Nothing here
// writes to Google. See docs/design/calendar-v2.md and docs/build/phases.md.
import type { JsonDocumentStore } from "../store.js";
import { ReconnectRequiredError, type GoogleCalendar } from "./google.js";
import {
  parseGoogleEvent,
  type EventFetchRequest, type EventFetchResult, type EventsDocument, type StoredEvent, type SyncedCalendar
} from "./events.js";

/** What the sync engine needs from a calendar backend. GoogleCalendarConnection satisfies it structurally. */
export interface EventSource {
  listCalendars(): Promise<GoogleCalendar[]>;
  fetchEvents(calendarId: string, request: EventFetchRequest): Promise<EventFetchResult>;
}

export interface SyncFailure {
  calendar: string;
  reason: string;
}

export interface SyncResult {
  /** Calendars synced without failure. */
  synced: number;
  changed: number;
  removed: number;
  fullResyncs: number;
  failures: SyncFailure[];
  /** True when the sign-in could not be refreshed; the UI shows "Reconnect Google" and does not loop. */
  reconnect: boolean;
  lastSync: string | null;
  /** The human-readable result line. */
  line: string;
}

const DAYS_BACK = 30;
const DAYS_AHEAD = 365;
const dayMs = 86_400_000;

type Counts = Pick<SyncResult, "synced" | "changed" | "removed" | "fullResyncs" | "failures" | "reconnect">;

/** Builds the one-line result shown on the setup page. Never includes raw error bodies. */
export function formatSyncLine(counts: Counts): string {
  if (counts.reconnect) return "Reconnect Google.";
  let line = `Synced ${counts.synced} calendars: ${counts.changed} events new or changed, ${counts.removed} removed, ${counts.fullResyncs} full resyncs.`;
  if (counts.failures.length > 0) {
    line += ` Failed: ${counts.failures.map((failure) => `${failure.calendar} (${failure.reason})`).join("; ")}.`;
  }
  return line;
}

/** Keeps a short, body-free reason for a failed calendar. */
function friendlyReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 5\d\d/.test(message)) return "Google had a server error";
  if (/HTTP 4\d\d/.test(message)) return "Google refused the request";
  if (/resync/i.test(message)) return "Google kept asking for a resync";
  return "could not be reached";
}

export interface CalendarSyncOptions {
  clock?: () => Date;
  /** The IANA zone the local wall clock is computed in (the phase-2 settings default). */
  zone: () => string | Promise<string>;
}

export class CalendarSync {
  private readonly clock: () => Date;
  private readonly zone: () => string | Promise<string>;

  constructor(
    private readonly source: EventSource,
    private readonly store: JsonDocumentStore<EventsDocument>,
    options: CalendarSyncOptions
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.zone = options.zone;
  }

  async syncAll(): Promise<SyncResult> {
    const now = this.clock();
    const zone = await this.zone();
    const timeMin = new Date(now.getTime() - DAYS_BACK * dayMs).toISOString();
    const timeMax = new Date(now.getTime() + DAYS_AHEAD * dayMs).toISOString();

    let calendars: GoogleCalendar[];
    try { calendars = await this.source.listCalendars(); }
    catch (error) {
      if (error instanceof ReconnectRequiredError) return reconnectResult();
      throw error;
    }

    const document = await this.store.read();
    const previousTokens = new Map(document.calendars.map((calendar) => [calendar.id, calendar.syncToken]));
    const previousMeta = new Map(document.calendars.map((calendar) => [calendar.id, calendar]));
    let events = document.events.slice();
    const nextCalendars: SyncedCalendar[] = [];
    const failures: SyncFailure[] = [];
    let synced = 0, changed = 0, removed = 0, fullResyncs = 0;

    for (const calendar of calendars) {
      try {
        const storedToken = previousTokens.get(calendar.id) ?? null;
        let full = storedToken === null;
        let fetched = await this.fetchCalendar(calendar.id, storedToken, timeMin, timeMax);
        if (fetched.gone) {
          // Token expired: discard it and do a full fetch for this calendar only.
          full = true;
          fullResyncs += 1;
          fetched = await this.fetchCalendar(calendar.id, null, timeMin, timeMax);
          if (fetched.gone) throw new Error("Google asked for a resync twice");
        }

        const context = { calendarId: calendar.id, colour: calendar.colour, zone };
        const fresh: StoredEvent[] = [];
        const cancelled: string[] = [];
        for (const raw of fetched.items) {
          const parsed = parseGoogleEvent(raw, context);
          if (parsed.kind === "event") fresh.push(parsed.event);
          else if (parsed.kind === "cancelled") cancelled.push(parsed.eventId);
        }

        if (full) {
          events = events.filter((event) => event.calendarId !== calendar.id);
          events.push(...fresh);
          changed += fresh.length;
        } else {
          for (const event of fresh) {
            const index = events.findIndex((candidate) => candidate.calendarId === calendar.id && candidate.eventId === event.eventId);
            if (index >= 0) events[index] = event; else events.push(event);
          }
          changed += fresh.length;
          for (const id of cancelled) {
            const before = events.length;
            events = events.filter((event) => !(event.calendarId === calendar.id && event.eventId === id));
            if (events.length < before) removed += 1;
          }
        }

        nextCalendars.push({ id: calendar.id, name: calendar.name, colour: calendar.colour, readOnly: !calendar.writable, syncToken: fetched.nextSyncToken });
        synced += 1;
      } catch (error) {
        if (error instanceof ReconnectRequiredError) return reconnectResult();
        failures.push({ calendar: calendar.name, reason: friendlyReason(error) });
        // Keep this calendar's previous state so the next sync can carry on from where it was.
        nextCalendars.push(previousMeta.get(calendar.id) ?? { id: calendar.id, name: calendar.name, colour: calendar.colour, readOnly: !calendar.writable, syncToken: null });
      }
    }

    const lastSync = synced > 0 || calendars.length === 0 ? now.toISOString() : document.lastSync;
    await this.store.update((draft) => {
      draft.calendars = nextCalendars;
      draft.events = events;
      draft.lastSync = lastSync;
    });

    const counts: Counts = { synced, changed, removed, fullResyncs, failures, reconnect: false };
    return { ...counts, lastSync, line: formatSyncLine(counts) };
  }

  /** Fetches one calendar, following pagination. Returns { gone: true } on a 410 so the caller can full-resync. */
  private async fetchCalendar(
    calendarId: string, syncToken: string | null, timeMin: string, timeMax: string
  ): Promise<{ gone: boolean; items: unknown[]; nextSyncToken: string | null }> {
    const items: unknown[] = [];
    let pageToken: string | undefined;
    for (;;) {
      const request: EventFetchRequest = { timeMin, timeMax };
      if (syncToken) request.syncToken = syncToken;
      if (pageToken) request.pageToken = pageToken;
      const result = await this.source.fetchEvents(calendarId, request);
      if (result.status === "gone") return { gone: true, items: [], nextSyncToken: null };
      if (result.status === "reconnect") throw new ReconnectRequiredError("Reconnect Google: access was refused.");
      if (result.status === "error") throw new Error(result.error ?? "HTTP error");
      items.push(...result.items);
      if (result.nextPageToken) { pageToken = result.nextPageToken; continue; }
      return { gone: false, items, nextSyncToken: result.nextSyncToken };
    }
  }
}

function reconnectResult(): SyncResult {
  const counts: Counts = { synced: 0, changed: 0, removed: 0, fullResyncs: 0, failures: [], reconnect: true };
  return { ...counts, lastSync: null, line: formatSyncLine(counts) };
}
