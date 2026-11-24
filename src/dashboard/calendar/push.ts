// Calendar v2 two-way sync (phase 5): the PURE mapping between app items and Google events for the user's own
// (writable) calendar. No I/O here — twoway.ts does the network and storage. Only timed, non-recurring items are
// pushed; all-day, recurring and untimed items stay in the app. See docs/design/calendar-v2.md.
//
// Google reminder limits, confirmed 2026-11 from
// https://developers.google.com/calendar/api/v3/reference/events (field reminders.overrides[]):
// - at most 5 override reminders per event;
// - each override's `minutes` is between 0 and 40320 (4 weeks);
// - method is "email" or "popup"; when overrides are used, reminders.useDefault must be false so only ours apply.
import { instantToWallClock, zonedToInstant } from "./timezone.js";
import type { Item } from "./model.js";

export const MAX_OVERRIDES = 5;
export const MAX_LEAD_MINUTES = 40_320;
export const DEFAULT_DURATION_MIN = 30;
const MIN_PER_DAY = 1_440;

/** The only items phase 5 pushes: timed (has a time, not all-day) and not recurring. */
export function isPushable(item: Item): boolean {
  return !item.allDay && item.time !== null && item.recurrence === null;
}

/** A raw Google event is pullable as a new app item when it is timed, not recurring and not cancelled. */
export function isGooglePullable(raw: Record<string, unknown>): boolean {
  const start = isObject(raw.start) ? raw.start : {};
  return typeof start.dateTime === "string" && raw.recurringEventId === undefined && raw.status !== "cancelled";
}

export interface ReminderOverride { method: "popup"; minutes: number; }

/**
 * Lead times in days → Google reminder overrides. Each is clamped to Google's 0–40320-minute range; if there are
 * more than 5, the first 5 are kept (see assumptions). popup method; the caller sets reminders.useDefault=false.
 */
export function reminderOverrides(leadDays: number[]): ReminderOverride[] {
  return leadDays
    .slice(0, MAX_OVERRIDES)
    .map((days) => ({ method: "popup", minutes: Math.min(Math.max(0, Math.round(days * MIN_PER_DAY)), MAX_LEAD_MINUTES) }));
}

export interface EventBodyContext {
  /** The category's Google colour id, or null for Google's default. */
  colorId: string | null;
  /** Resolved lead times (item override or category default), in whole days. */
  leadDays: number[];
  categoryId: string | null;
  /** Fallback zone when the item has none. */
  zone: string;
}

/**
 * Builds the Google event body for a timed item. Start and end are exact instants from the item's wall clock and
 * zone (end = start + 30 minutes; the app has no per-item end time yet). The item id and category id go into
 * private extended properties so the link can be rebuilt if links.json is lost. Colour is set per category.
 */
export function buildEventBody(item: Item, context: EventBodyContext): Record<string, unknown> {
  const zone = item.timeZone && item.timeZone.trim() !== "" ? item.timeZone : context.zone;
  const start = zonedToInstant(item.date, item.time!, zone);
  const endInstant = new Date(start.instantMs + DEFAULT_DURATION_MIN * 60_000).toISOString();
  const body: Record<string, unknown> = {
    summary: item.title,
    start: { dateTime: start.instant, timeZone: zone },
    end: { dateTime: endInstant, timeZone: zone },
    reminders: { useDefault: false, overrides: reminderOverrides(context.leadDays) },
    extendedProperties: { private: { viralItemId: item.id, viralCategoryId: context.categoryId ?? "" } }
  };
  if (context.colorId) body.colorId = context.colorId;
  return body;
}

export interface PulledFields {
  title: string;
  date: string;
  time: string;
  timeZone: string;
  categoryId: string | null;
}

/** The app-stored fields read back from a raw Google event, using `zone` for the local wall clock. */
export function parseEventForPull(raw: Record<string, unknown>, zone: string): PulledFields | null {
  const start = isObject(raw.start) ? raw.start : {};
  if (typeof start.dateTime !== "string") return null;
  const instantMs = Date.parse(start.dateTime);
  if (Number.isNaN(instantMs)) return null;
  const eventZone = typeof start.timeZone === "string" && start.timeZone.trim() !== "" ? start.timeZone : zone;
  const wall = instantToWallClock(instantMs, eventZone);
  const extended = isObject(raw.extendedProperties) && isObject(raw.extendedProperties.private) ? raw.extendedProperties.private : {};
  const categoryId = typeof extended.viralCategoryId === "string" && extended.viralCategoryId !== "" ? extended.viralCategoryId : null;
  return {
    title: typeof raw.summary === "string" && raw.summary.trim() !== "" ? raw.summary : "(no title)",
    date: wall.date,
    time: wall.time,
    timeZone: eventZone,
    categoryId
  };
}

/** The viral item id written into a Google event's private extended properties, if any. */
export function viralItemIdOf(raw: Record<string, unknown>): string | null {
  const extended = isObject(raw.extendedProperties) && isObject(raw.extendedProperties.private) ? raw.extendedProperties.private : {};
  return typeof extended.viralItemId === "string" && extended.viralItemId !== "" ? extended.viralItemId : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
