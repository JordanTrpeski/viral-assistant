// Pure calendar-date helpers on ISO "YYYY-MM-DD" strings, shared by the server and the browser UI.
// Arithmetic uses UTC so daylight-saving changes never shift a date.

export type IsoDate = string;
export type IsoMonth = string;

const dayMs = 86_400_000;

function utc(iso: IsoDate): number {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function fromUtc(milliseconds: number): IsoDate {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return fromUtc(utc(value)) === value;
}

export function isIsoMonth(value: unknown): value is IsoMonth {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** The person's local calendar date for an instant. */
export function localIsoDate(now: Date): IsoDate {
  const pad = (value: number): string => value.toString().padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromUtc(utc(iso) + days * dayMs);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((utc(to) - utc(from)) / dayMs);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayMondayFirst(iso: IsoDate): number {
  return (new Date(utc(iso)).getUTCDay() + 6) % 7;
}

export function mondayOf(iso: IsoDate): IsoDate {
  return addDays(iso, -weekdayMondayFirst(iso));
}

export function monthOf(iso: IsoDate): IsoMonth {
  return iso.slice(0, 7);
}

export function firstOfMonth(month: IsoMonth): IsoDate {
  return `${month}-01`;
}

export function lastOfMonth(month: IsoMonth): IsoDate {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return fromUtc(Date.UTC(year, monthNumber, 0));
}

export function addMonths(month: IsoMonth, count: number): IsoMonth {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return fromUtc(Date.UTC(year, monthNumber - 1 + count, 1)).slice(0, 7);
}

export function inRange(iso: IsoDate, start: IsoDate, end: IsoDate): boolean {
  return iso >= start && iso <= end;
}

export interface WeekSegment {
  start: IsoDate;
  end: IsoDate;
  days: number;
}

/** The Monday-to-Sunday week containing `iso`, cut at the edges of its calendar month (weeks reset on the 1st). */
export function budgetWeekOf(iso: IsoDate): WeekSegment {
  const month = monthOf(iso);
  const monday = mondayOf(iso);
  const sunday = addDays(monday, 6);
  const first = firstOfMonth(month);
  const last = lastOfMonth(month);
  const start = monday < first ? first : monday;
  const end = sunday > last ? last : sunday;
  return { start, end, days: daysBetween(start, end) + 1 };
}

/** Every budget week of a month, in order; the first and last may be shorter than seven days. */
export function budgetWeeksOfMonth(month: IsoMonth): WeekSegment[] {
  const weeks: WeekSegment[] = [];
  let cursor = firstOfMonth(month);
  const last = lastOfMonth(month);
  while (cursor <= last) {
    const week = budgetWeekOf(cursor);
    weeks.push(week);
    cursor = addDays(week.end, 1);
  }
  return weeks;
}

/** Calendar grid rows for a month view: whole Monday-first weeks covering the month. */
export function monthGrid(month: IsoMonth): IsoDate[][] {
  const rows: IsoDate[][] = [];
  let cursor = mondayOf(firstOfMonth(month));
  const last = lastOfMonth(month);
  while (cursor <= last) {
    rows.push(Array.from({ length: 7 }, (_, index) => addDays(cursor, index)));
    cursor = addDays(cursor, 7);
  }
  return rows;
}
