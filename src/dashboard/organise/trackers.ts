// Trackers: a named measure with a unit, an optional target per period, and dated entries stored separately.
import { ValidationError } from "../errors.js";
import { addDays, addMonths, firstOfMonth, isIsoDate, lastOfMonth, mondayOf, type IsoDate } from "../shared/dates.js";
import { isObject, rejectUnknownFields, requireObject, type JsonObject } from "../validation.js";

export const trackerPeriods = ["weekly", "monthly", "yearly"] as const;
export type TrackerPeriod = typeof trackerPeriods[number];
export const historyPeriods = 8;

export interface Tracker {
  id: string;
  name: string;
  unit: string;
  target: number | null;
  period: TrackerPeriod;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackerEntry {
  id: string;
  tracker_id: string;
  date: IsoDate;
  value: number;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface TrackersDocument {
  schemaVersion: 1;
  trackers: Tracker[];
  entries: TrackerEntry[];
}

export interface PeriodRange {
  start: IsoDate;
  end: IsoDate;
}

export interface TrackerProgress extends PeriodRange {
  total: number;
  target: number | null;
  /** Percent of target reached (one decimal); null without a target. */
  percent: number | null;
  /** What is left to reach the target (never negative); null without a target. */
  remaining: number | null;
}

export interface TrackerView extends Tracker {
  progress: TrackerProgress;
  history: (PeriodRange & { total: number })[];
}

export function validateTrackersDocument(value: unknown): TrackersDocument {
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.trackers) || !Array.isArray(value.entries)) {
    throw new Error("organise trackers must be an object with schemaVersion 1, trackers and entries arrays");
  }
  return value as unknown as TrackersDocument;
}

/** Monday to Sunday, the calendar month, or the calendar year containing `date`. */
export function periodOf(period: TrackerPeriod, date: IsoDate): PeriodRange {
  if (period === "weekly") {
    const start = mondayOf(date);
    return { start, end: addDays(start, 6) };
  }
  if (period === "monthly") return { start: firstOfMonth(date.slice(0, 7)), end: lastOfMonth(date.slice(0, 7)) };
  return { start: `${date.slice(0, 4)}-01-01`, end: `${date.slice(0, 4)}-12-31` };
}

export function previousPeriod(period: TrackerPeriod, range: PeriodRange): PeriodRange {
  if (period === "weekly") return periodOf("weekly", addDays(range.start, -7));
  if (period === "monthly") return periodOf("monthly", firstOfMonth(addMonths(range.start.slice(0, 7), -1)));
  return periodOf("yearly", `${Number(range.start.slice(0, 4)) - 1}-01-01`);
}

/** Totals are rounded to 6 decimals so 0.1 + 0.2 reads 0.3. */
export function roundValue(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function totalIn(entries: readonly TrackerEntry[], trackerId: string, range: PeriodRange): number {
  return roundValue(entries.filter((entry) => entry.tracker_id === trackerId && entry.date >= range.start && entry.date <= range.end).reduce((sum, entry) => sum + entry.value, 0));
}

export function trackerView(tracker: Tracker, entries: readonly TrackerEntry[], today: IsoDate): TrackerView {
  const current = periodOf(tracker.period, today);
  const total = totalIn(entries, tracker.id, current);
  const progress: TrackerProgress = tracker.target === null
    ? { ...current, total, target: null, percent: null, remaining: null }
    : { ...current, total, target: tracker.target, percent: Math.round((total / tracker.target) * 1_000) / 10, remaining: roundValue(Math.max(0, tracker.target - total)) };
  const history: (PeriodRange & { total: number })[] = [];
  let range = current;
  for (let index = 0; index < historyPeriods; index += 1) {
    history.unshift({ ...range, total: totalIn(entries, tracker.id, range) });
    range = previousPeriod(tracker.period, range);
  }
  return { ...tracker, progress, history };
}

function trackerName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > 100) throw new ValidationError("name must be 1 to 100 characters");
  return value.trim();
}

function trackerUnit(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > 30) throw new ValidationError("unit must be text of at most 30 characters");
  return value.trim();
}

function trackerTarget(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new ValidationError("target must be a number greater than 0, or empty for no target");
  return value;
}

function trackerPeriod(value: unknown): TrackerPeriod {
  if (typeof value !== "string" || !(trackerPeriods as readonly string[]).includes(value)) throw new ValidationError("period must be one of: weekly, monthly, yearly");
  return value as TrackerPeriod;
}

/** Validated tracker fields from a create (all) or patch (some) body; project existence is checked by the caller. */
export function trackerFields(body: unknown, partial: boolean): Partial<Pick<Tracker, "name" | "unit" | "target" | "period" | "project_id">> {
  const input: JsonObject = requireObject(body);
  rejectUnknownFields(input, ["name", "unit", "target", "period", "project_id"]);
  const fields: Partial<Pick<Tracker, "name" | "unit" | "target" | "period" | "project_id">> = {};
  if (!partial || input.name !== undefined) fields.name = trackerName(input.name);
  if (!partial || input.unit !== undefined) fields.unit = trackerUnit(input.unit);
  if (!partial || input.target !== undefined) fields.target = trackerTarget(input.target);
  if (!partial || input.period !== undefined) fields.period = trackerPeriod(input.period);
  if (!partial || input.project_id !== undefined) {
    if (input.project_id !== undefined && input.project_id !== null && input.project_id !== "" && typeof input.project_id !== "string") throw new ValidationError("project_id must be a string");
    fields.project_id = typeof input.project_id === "string" && input.project_id !== "" ? input.project_id : null;
  }
  return fields;
}

export function entryFields(body: unknown, partial: boolean, today: IsoDate): Partial<Pick<TrackerEntry, "date" | "value" | "note">> {
  const input: JsonObject = requireObject(body);
  rejectUnknownFields(input, ["date", "value", "note"]);
  const fields: Partial<Pick<TrackerEntry, "date" | "value" | "note">> = {};
  if (!partial || input.date !== undefined) {
    const date = input.date === undefined ? today : input.date;
    if (!isIsoDate(date)) throw new ValidationError("date must be a valid date in YYYY-MM-DD format");
    fields.date = date;
  }
  if (!partial || input.value !== undefined) {
    if (typeof input.value !== "number" || !Number.isFinite(input.value) || input.value < 0) throw new ValidationError("value must be a number, 0 or more");
    fields.value = input.value;
  }
  if (!partial || input.note !== undefined) {
    const note = input.note === undefined || input.note === null ? "" : input.note;
    if (typeof note !== "string" || note.length > 500) throw new ValidationError("note must be text of at most 500 characters");
    fields.note = note.trim();
  }
  return fields;
}
