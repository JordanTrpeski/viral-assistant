// Reminder rules on top of the shared model: the Personal prepare_by default, prepare_days, and recurrence.
import { ValidationError } from "../errors.js";
import { addDays, daysBetween, isIsoDate, type IsoDate } from "../shared/dates.js";
import type { ColourCategory } from "../shared/colours.js";
import type { TimelineItem } from "../timeline.js";
import type { JsonObject } from "../validation.js";
import type { OrganiseItem } from "./model.js";

/** Personal reminders prepare this many days ahead unless told otherwise. */
export const personalPrepareDays = 14;

function isLeap(year: number): boolean {
  return isIsoDate(`${year}-02-29`);
}

/** Next yearly date for a series anchored on `anchor` (MM-DD); 29 February falls on the 28th in non-leap years. */
export function nextYearly(date: IsoDate, anchor: string | null): IsoDate {
  const year = Number(date.slice(0, 4)) + 1;
  const monthDay = anchor ?? date.slice(5);
  if (monthDay === "02-29" && !isLeap(year)) return `${year}-02-28`;
  return `${year}-${monthDay}`;
}

export function nextOccurrenceDate(item: OrganiseItem): IsoDate | null {
  if (item.date === null) return null;
  if (item.recurrence === "yearly") return nextYearly(item.date, item.recurrence_anchor);
  if (item.recurrence === "custom" && item.interval_days) return addDays(item.date, item.interval_days);
  return null;
}

/** The next occurrence: same fields, date advanced, prepare_by kept the same number of days ahead, status open. */
export function nextOccurrence(item: OrganiseItem): JsonObject | null {
  const date = nextOccurrenceDate(item);
  if (date === null) return null;
  const prepareBy = item.prepare_by !== null && item.date !== null ? addDays(date, -daysBetween(item.prepare_by, item.date)) : null;
  return {
    type: "reminder", title: item.title, date, prepare_by: prepareBy, category: item.category, project_id: item.project_id, recurrence: item.recurrence,
    interval_days: item.interval_days, notes: item.notes, links: item.links, recurrence_anchor: item.recurrence_anchor
  };
}

/**
 * Applies the prepare_by rules to a reminder candidate before validation:
 * - `prepare_days` (0 to 365) sets prepare_by that many days before the date; 0 means none;
 * - a new Personal reminder without prepare_by gets 14 days before its date;
 * - moving the date keeps a 14-day default in step; a custom prepare_by stays where it is;
 * - switching to Personal adds the default if there is no prepare_by.
 */
export function applyReminderRules(candidate: JsonObject, body: JsonObject, previous: OrganiseItem | null): JsonObject {
  const next = { ...candidate };
  delete next.prepare_days;
  if (next.type !== "reminder") {
    if (body.prepare_days !== undefined) throw new ValidationError("prepare_days only applies to reminders");
    return next;
  }
  const date = isIsoDate(next.date) ? next.date : null;
  if (body.prepare_days !== undefined) {
    if (body.prepare_by !== undefined) throw new ValidationError("Send prepare_by or prepare_days, not both");
    const days = body.prepare_days;
    if (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > 365) throw new ValidationError("prepare_days must be a whole number from 0 to 365");
    if (days > 0 && date === null) throw new ValidationError("prepare_days needs a date");
    next.prepare_by = days === 0 || date === null ? null : addDays(date, -days);
    return next;
  }
  if (body.prepare_by !== undefined || date === null) return next;
  const wasReminder = previous !== null && previous.type === "reminder";
  if (!wasReminder) {
    if (next.category === "Personal" && (next.prepare_by === undefined || next.prepare_by === null || next.prepare_by === "")) next.prepare_by = addDays(date, -personalPrepareDays);
    return next;
  }
  const followedDefault = previous.prepare_by !== null && previous.date !== null && previous.prepare_by === addDays(previous.date, -personalPrepareDays);
  if (body.date !== undefined && followedDefault && next.category === "Personal") next.prepare_by = addDays(date, -personalPrepareDays);
  if (body.category === "Personal" && previous.category !== "Personal" && next.prepare_by === null) next.prepare_by = addDays(date, -personalPrepareDays);
  return next;
}

export function reminderColour(item: OrganiseItem): ColourCategory {
  return item.category === "Personal" ? "personal" : item.category === "Bill" ? "bills" : "reminder";
}

/** Organise reminders as timeline entries (calendar, Next 7 days); prepare-by entries are derived from them. */
export function organiseReminderTimelineItems(items: readonly OrganiseItem[]): TimelineItem[] {
  return items.filter((item) => item.type === "reminder" && item.date !== null).map((item) => ({
    id: `organise:${item.id}`,
    date: item.date!,
    source: "reminder",
    sourceId: item.id,
    label: item.title,
    colour: reminderColour(item),
    status: item.status === "done" ? "done" : "scheduled",
    amountCents: null,
    prepareBy: item.prepare_by,
    origin: "organise"
  }));
}

export interface ReminderView extends OrganiseItem {
  overdue: boolean;
}

export interface ReminderGroups {
  overdue: ReminderView[];
  upcoming: ReminderView[];
  done: ReminderView[];
}

/** Overdue: open, date before today. Upcoming: open, today or later, soonest first. Done: newest done_at first. */
export function groupReminders(items: readonly OrganiseItem[], today: IsoDate): ReminderGroups {
  const reminders = items.filter((item) => item.type === "reminder").map((item) => ({ ...item, overdue: item.status !== "done" && item.date !== null && item.date < today }));
  const byDate = (left: ReminderView, right: ReminderView): number => (left.date ?? "").localeCompare(right.date ?? "") || left.title.localeCompare(right.title);
  return {
    overdue: reminders.filter((item) => item.overdue).sort(byDate),
    upcoming: reminders.filter((item) => item.status !== "done" && !item.overdue).sort(byDate),
    done: reminders.filter((item) => item.status === "done").sort((left, right) => (right.done_at ?? "").localeCompare(left.done_at ?? "") || byDate(left, right))
  };
}
