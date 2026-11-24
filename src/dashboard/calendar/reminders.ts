// Pure reminder-time computation. It only computes when an alert would fire (wall-clock date and time); it
// sends nothing. Absolute instants need the item's time zone and are left to a later phase.
import { addDays, type IsoDate } from "../shared/dates.js";
import type { Category, Item } from "./model.js";

export interface ReminderTime {
  itemId: string;
  occurrenceDate: IsoDate;
  leadDays: number;
  /** The day the alert fires (occurrence date minus the lead days). */
  date: IsoDate;
  /** Wall-clock time on that day: the item's own time when timed, otherwise the all-day reminder time. */
  time: string;
}

/**
 * The lead times that apply to an item: its own list wins when set (even when empty — an override replaces
 * the default and never adds to it), otherwise the category default, otherwise none.
 */
export function effectiveLeadTimes(item: Item, category: Category | null): number[] {
  if (item.leadTimes !== null) return item.leadTimes;
  if (category) return category.defaultLeadTimes;
  return [];
}

/**
 * The reminder times for one occurrence of an item: one per lead day. A timed item fires at its own time on
 * (occurrence − lead) days; an all-day item fires at `allDayReminderTime`.
 */
export function reminderTimes(item: Item, category: Category | null, occurrenceDate: IsoDate, allDayReminderTime: string): ReminderTime[] {
  const time = item.allDay ? allDayReminderTime : item.time ?? allDayReminderTime;
  return effectiveLeadTimes(item, category).map((leadDays) => ({
    itemId: item.id,
    occurrenceDate,
    leadDays,
    date: addDays(occurrenceDate, -leadDays),
    time
  }));
}
