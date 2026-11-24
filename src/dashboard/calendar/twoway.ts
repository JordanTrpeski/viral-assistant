// Calendar v2 two-way sync (phase 5): pushes timed app items to the chosen writable Google calendar, pulls
// Google changes back, and resolves conflicts newer-wins. Deletes are NOT pushed here (an app delete only marks
// the link pending; phase 6 does delete sync through trash). Orchestration over an injected writer, so tests
// never touch the real Google API. See docs/design/calendar-v2.md.
import type { JsonDocumentStore } from "../store.js";
import { isObject } from "../validation.js";
import { ReconnectRequiredError, type GoogleCalendar, type WriteResult } from "./google.js";
import type { CalendarService } from "./service.js";
import type { EventFetchRequest, EventFetchResult, EventsDocument } from "./events.js";
import { buildEventBody, isGooglePullable, isPushable, parseEventForPull, viralItemIdOf } from "./push.js";

// ---- Link and conflict stores -------------------------------------------------------------------------------

export interface EventLink {
  itemId: string;
  eventId: string;
  calendarId: string;
  /** Google's `updated` when we last saw the event; null until first known. */
  googleUpdated: string | null;
  /** The app item's `updated` when we last pushed/pulled it. */
  appUpdated: string;
  /** Set when the app item was deleted; the Google event is left alone until phase 6. */
  pendingDelete: boolean;
}

export interface LinksDocument { schemaVersion: 1; links: EventLink[]; }
export function emptyLinksDocument(): LinksDocument { return { schemaVersion: 1, links: [] }; }
export function validateLinksDocument(value: unknown): LinksDocument {
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error("links store must be an object with schemaVersion 1");
  const links = (Array.isArray(value.links) ? value.links : []).flatMap((raw) => {
    if (!isObject(raw) || typeof raw.itemId !== "string" || typeof raw.eventId !== "string" || typeof raw.calendarId !== "string") return [];
    return [{
      itemId: raw.itemId, eventId: raw.eventId, calendarId: raw.calendarId,
      googleUpdated: typeof raw.googleUpdated === "string" ? raw.googleUpdated : null,
      appUpdated: typeof raw.appUpdated === "string" ? raw.appUpdated : "",
      pendingDelete: raw.pendingDelete === true
    }];
  });
  return { schemaVersion: 1, links };
}

export interface ConflictEntry { at: string; itemId: string; loser: "app" | "google"; data: unknown; }
export interface ConflictsDocument { schemaVersion: 1; conflicts: ConflictEntry[]; }
export function emptyConflictsDocument(): ConflictsDocument { return { schemaVersion: 1, conflicts: [] }; }
export function validateConflictsDocument(value: unknown): ConflictsDocument {
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error("conflicts store must be an object with schemaVersion 1");
  const conflicts = (Array.isArray(value.conflicts) ? value.conflicts : []).flatMap((raw) =>
    isObject(raw) && typeof raw.itemId === "string" && (raw.loser === "app" || raw.loser === "google")
      ? [{ at: typeof raw.at === "string" ? raw.at : "", itemId: raw.itemId, loser: raw.loser as "app" | "google", data: raw.data }] : []);
  return { schemaVersion: 1, conflicts };
}

// ---- The writer the reconciler needs (GoogleCalendarConnection satisfies it) ---------------------------------

export interface GoogleWriter {
  hasWriteScope(): Promise<boolean>;
  fetchEvents(calendarId: string, request: EventFetchRequest): Promise<EventFetchResult>;
  insertEvent(calendarId: string, body: Record<string, unknown>): Promise<WriteResult>;
  patchEvent(calendarId: string, eventId: string, body: Record<string, unknown>): Promise<WriteResult>;
}

export interface PushResult {
  pushed: number;
  updated: number;
  pulled: number;
  conflicts: number;
  pendingDeletes: number;
  failures: { item: string; reason: string }[];
  /** True when the token lacks the write scope; the UI shows "Reconnect Google". */
  reconnect: boolean;
  /** The resolved target calendar name, or null when none is set/usable. */
  target: string | null;
  line: string;
}

const DAY_MS = 86_400_000;
const DAYS_BACK = 30;
const DAYS_AHEAD = 365;

export function formatPushLine(result: Pick<PushResult, "pushed" | "updated" | "pulled" | "conflicts" | "pendingDeletes" | "failures" | "reconnect" | "target">): string {
  if (result.reconnect) return "Reconnect Google to grant write access.";
  if (result.target === null) return "No writable target calendar is set; nothing was pushed.";
  let line = `Pushed ${result.pushed}, updated ${result.updated}, pulled ${result.pulled}, conflicts ${result.conflicts}, pending deletes ${result.pendingDeletes}.`;
  if (result.failures.length > 0) line += ` Failed: ${result.failures.map((failure) => `${failure.item} (${failure.reason})`).join("; ")}.`;
  return line;
}

/**
 * Resolves the target calendar: the explicitly chosen one if it is writable, otherwise a writable calendar named
 * exactly "Viral test". Never the primary by default. Returns null when none is usable (writes are then refused).
 */
export function resolveTarget(document: EventsDocument): GoogleCalendar | SyncedTarget | null {
  const byId = new Map(document.calendars.map((calendar) => [calendar.id, calendar]));
  if (document.writeCalendarId) {
    const chosen = byId.get(document.writeCalendarId);
    return chosen && !chosen.readOnly ? chosen : null; // refuse a non-writable or unknown chosen calendar
  }
  return document.calendars.find((calendar) => calendar.name === "Viral test" && !calendar.readOnly) ?? null;
}

type SyncedTarget = EventsDocument["calendars"][number];

function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 5\d\d/.test(message)) return "Google had a server error";
  if (/HTTP 4\d\d/.test(message)) return "Google refused the write";
  return "could not be reached";
}

export interface TwoWaySyncOptions {
  clock?: () => Date;
  zone: () => string | Promise<string>;
}

export class TwoWaySync {
  private readonly clock: () => Date;
  private readonly zone: () => string | Promise<string>;

  constructor(
    private readonly source: GoogleWriter,
    private readonly calendar: CalendarService,
    private readonly events: JsonDocumentStore<EventsDocument>,
    private readonly links: JsonDocumentStore<LinksDocument>,
    private readonly conflicts: JsonDocumentStore<ConflictsDocument>,
    options: TwoWaySyncOptions
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.zone = options.zone;
  }

  async reconcile(): Promise<PushResult> {
    const base = { pushed: 0, updated: 0, pulled: 0, conflicts: 0, pendingDeletes: 0, failures: [] as { item: string; reason: string }[] };
    const eventsDoc = await this.events.read();
    const target = resolveTarget(eventsDoc);
    if (!target) return { ...base, reconnect: false, target: null, line: formatPushLine({ ...base, reconnect: false, target: null }) };
    if (!(await this.source.hasWriteScope())) return { ...base, reconnect: true, target: target.name, line: formatPushLine({ ...base, reconnect: true, target: target.name }) };

    const now = this.clock();
    const zone = await this.zone();
    const raw = await this.fetchRaw(target.id, now);

    const items = await this.calendar.listItems();
    const categories = await this.calendar.listCategories();
    const linksDoc = await this.links.read();
    const links = linksDoc.links.slice();
    const newConflicts: ConflictEntry[] = [];

    const itemById = new Map(items.map((item) => [item.id, item]));
    const linkByItem = new Map(links.map((link) => [link.itemId, link]));
    const rawByEvent = new Map(raw.filter((event): event is Record<string, unknown> & { id: string } => typeof event.id === "string").map((event) => [event.id, event]));
    const rawByViralItem = new Map<string, Record<string, unknown>>();
    for (const event of raw) { const vid = viralItemIdOf(event); if (vid) rawByViralItem.set(vid, event); }

    let { pushed, updated, pulled } = base;
    let conflictCount = 0;
    const failures = base.failures;

    const bodyFor = (item: typeof items[number]): Record<string, unknown> => {
      const category = categories.find((candidate) => candidate.id === item.categoryId) ?? null;
      const leadDays = item.leadTimes ?? category?.defaultLeadTimes ?? [];
      return buildEventBody(item, { colorId: category?.colour ?? null, leadDays, categoryId: item.categoryId, zone });
    };
    const categoryExists = (id: string | null): string | null => (id !== null && categories.some((category) => category.id === id) ? id : null);

    // Pull a Google event's fields onto an existing app item; returns the item's new `updated`.
    const applyPull = async (itemId: string, event: Record<string, unknown>): Promise<string> => {
      const fields = parseEventForPull(event, zone);
      if (!fields) return this.clock().toISOString();
      const next = await this.calendar.updateItem(itemId, { title: fields.title, date: fields.date, allDay: false, time: fields.time, timeZone: fields.timeZone, categoryId: categoryExists(fields.categoryId) });
      return next.updated;
    };

    // 1. Pushable items: push new, update changed, resolve conflicts.
    for (const item of items.filter(isPushable)) {
      try {
        const link = linkByItem.get(item.id);
        if (!link) {
          const existing = rawByViralItem.get(item.id); // links lost but the event still carries our id → relink
          if (existing && typeof existing.id === "string") {
            const result = await this.applyWrite(() => this.source.patchEvent(target.id, existing.id as string, bodyFor(item)));
            links.push({ itemId: item.id, eventId: existing.id, calendarId: target.id, googleUpdated: updatedOf(result.event), appUpdated: item.updated, pendingDelete: false });
            updated += 1;
          } else {
            const result = await this.applyWrite(() => this.source.insertEvent(target.id, bodyFor(item)));
            const eventId = idOf(result.event);
            if (eventId) { links.push({ itemId: item.id, eventId, calendarId: target.id, googleUpdated: updatedOf(result.event), appUpdated: item.updated, pendingDelete: false }); pushed += 1; }
          }
          continue;
        }
        const event = rawByEvent.get(link.eventId);
        const appChanged = item.updated > link.appUpdated;
        const googleUpdated = event && typeof event.updated === "string" ? event.updated : null;
        const googleChanged = googleUpdated !== null && link.googleUpdated !== null && googleUpdated > link.googleUpdated;

        if (appChanged && googleChanged && event) {
          conflictCount += 1;
          if (item.updated >= (googleUpdated ?? "")) { // app newer → push, Google's version loses
            const result = await this.applyWrite(() => this.source.patchEvent(target.id, link.eventId, bodyFor(item)));
            newConflicts.push({ at: now.toISOString(), itemId: item.id, loser: "google", data: event });
            link.googleUpdated = updatedOf(result.event); link.appUpdated = item.updated;
            updated += 1;
          } else { // Google newer → pull, the app version loses
            newConflicts.push({ at: now.toISOString(), itemId: item.id, loser: "app", data: structuredClone(item) });
            link.appUpdated = await applyPull(item.id, event); link.googleUpdated = googleUpdated;
            pulled += 1;
          }
        } else if (appChanged) {
          const result = await this.applyWrite(() => this.source.patchEvent(target.id, link.eventId, bodyFor(item)));
          link.googleUpdated = updatedOf(result.event); link.appUpdated = item.updated;
          updated += 1;
        } else if (googleChanged && event) {
          link.appUpdated = await applyPull(item.id, event); link.googleUpdated = googleUpdated;
          pulled += 1;
        }
      } catch (error) {
        if (error instanceof ReconnectRequiredError) return { ...base, reconnect: true, target: target.name, line: formatPushLine({ ...base, reconnect: true, target: target.name }) };
        failures.push({ item: item.title, reason: reason(error) });
      }
    }

    // 2. Pending deletes: a link whose app item is gone (delete is not pushed in phase 5).
    for (const link of links) {
      if (!itemById.has(link.itemId)) link.pendingDelete = true;
    }
    const pendingDeletes = links.filter((link) => link.pendingDelete).length;

    // 3. Google-created events on the target with no link: pull in only timed, non-recurring ones.
    const linkedEventIds = new Set(links.map((link) => link.eventId));
    for (const event of raw) {
      if (typeof event.id !== "string" || linkedEventIds.has(event.id) || viralItemIdOf(event)) continue;
      if (!isGooglePullable(event)) continue;
      try {
        const fields = parseEventForPull(event, zone);
        if (!fields) continue;
        const created = await this.calendar.createItem({ kind: "reminder", title: fields.title, date: fields.date, time: fields.time, timeZone: fields.timeZone, categoryId: categoryExists(fields.categoryId) });
        links.push({ itemId: created.id, eventId: event.id, calendarId: target.id, googleUpdated: typeof event.updated === "string" ? event.updated : null, appUpdated: created.updated, pendingDelete: false });
        pulled += 1;
      } catch (error) {
        failures.push({ item: typeof event.summary === "string" ? event.summary : event.id, reason: reason(error) });
      }
    }

    await this.links.update((draft) => { draft.links = links; });
    if (newConflicts.length) await this.conflicts.update((draft) => { draft.conflicts.push(...newConflicts); });

    const result = { pushed, updated, pulled, conflicts: conflictCount, pendingDeletes, failures, reconnect: false, target: target.name };
    return { ...result, line: formatPushLine(result) };
  }

  /** Runs a write and turns reconnect/error into thrown errors the caller handles. */
  private async applyWrite(write: () => Promise<WriteResult>): Promise<{ event: Record<string, unknown> }> {
    const result = await write();
    if (result.status === "reconnect") throw new ReconnectRequiredError("Reconnect Google to grant write access.");
    if (result.status === "error") throw new Error(result.error);
    return { event: result.event };
  }

  /** Full-window raw events on the target calendar (no sync token), following pagination. */
  private async fetchRaw(calendarId: string, now: Date): Promise<Record<string, unknown>[]> {
    const timeMin = new Date(now.getTime() - DAYS_BACK * DAY_MS).toISOString();
    const timeMax = new Date(now.getTime() + DAYS_AHEAD * DAY_MS).toISOString();
    const out: Record<string, unknown>[] = [];
    let pageToken: string | undefined;
    for (;;) {
      const request: EventFetchRequest = { timeMin, timeMax };
      if (pageToken) request.pageToken = pageToken;
      const result = await this.source.fetchEvents(calendarId, request);
      if (result.status === "reconnect") throw new ReconnectRequiredError("Reconnect Google to grant write access.");
      if (result.status === "error") throw new Error(result.error ?? "HTTP error");
      if (result.status === "gone") return out; // no sync token in use, so treat as nothing more
      for (const event of result.items) if (isObject(event)) out.push(event);
      if (result.nextPageToken) { pageToken = result.nextPageToken; continue; }
      return out;
    }
  }
}

function idOf(event: Record<string, unknown>): string | null {
  return typeof event.id === "string" ? event.id : null;
}
function updatedOf(event: Record<string, unknown>): string | null {
  return typeof event.updated === "string" ? event.updated : null;
}
