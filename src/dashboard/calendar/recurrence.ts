// Pure recurrence expansion for calendar items. No I/O, no clock — the caller passes the range.
import { addDays, daysBetween, inRange, type IsoDate } from "../shared/dates.js";
import type { Item } from "./model.js";

function parts(iso: IsoDate): [number, number, number] {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return [year, month, day];
}

/** Days in a 1-based month of a year (handles leap February). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The occurrence date for month/year recurrences, clamping an anchor day of 29–31 to the last valid day of
 * the target month (so the 31st becomes the 30th or Feb 28/29, and 29 Feb becomes 28 Feb in a common year).
 * See assumptions.md "Calendar v2 data model".
 */
export function clampedDate(year: number, month: number, anchorDay: number): IsoDate {
  return iso(year, month, Math.min(anchorDay, daysInMonth(year, month)));
}

/**
 * All occurrence dates of `item` within [rangeStart, rangeEnd] inclusive, soonest first. A non-recurring item
 * yields its own date when it falls in range. Recurring items start at the anchor, stop after `until`, and
 * omit any date in `skips`. Weekly steps by 7 days; monthly and yearly keep the anchor day, clamped.
 */
export function occurrences(item: Item, rangeStart: IsoDate, rangeEnd: IsoDate): IsoDate[] {
  if (rangeEnd < rangeStart) return [];
  const recurrence = item.recurrence;
  if (!recurrence) return inRange(item.date, rangeStart, rangeEnd) ? [item.date] : [];

  const { freq, anchor, until, skips } = recurrence;
  const hardEnd = until && until < rangeEnd ? until : rangeEnd;
  if (hardEnd < anchor) return [];
  const skip = new Set(skips);
  const dates: IsoDate[] = [];

  if (freq === "weekly") {
    // Jump to the first occurrence on or after the range start, then step weekly.
    const gap = daysBetween(anchor, rangeStart);
    const steps = gap <= 0 ? 0 : Math.ceil(gap / 7);
    for (let date = addDays(anchor, steps * 7); date <= hardEnd; date = addDays(date, 7)) {
      if (date >= rangeStart && date >= anchor && !skip.has(date)) dates.push(date);
    }
    return dates;
  }

  const [, anchorMonth, anchorDay] = parts(anchor);
  const [startYear] = parts(rangeStart < anchor ? anchor : rangeStart);
  const [endYear, endMonth] = parts(hardEnd);

  if (freq === "monthly") {
    for (let year = startYear; year <= endYear; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        if (year === endYear && month > endMonth) break;
        const date = clampedDate(year, month, anchorDay);
        if (date >= anchor && date >= rangeStart && date <= hardEnd && !skip.has(date)) dates.push(date);
      }
    }
    return dates;
  }

  // yearly: keep the anchor's month and day, clamped per year.
  for (let year = startYear; year <= endYear; year += 1) {
    const date = clampedDate(year, anchorMonth, anchorDay);
    if (date >= anchor && date >= rangeStart && date <= hardEnd && !skip.has(date)) dates.push(date);
  }
  return dates;
}
