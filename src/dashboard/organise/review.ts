// Weekly review: plain data over a rolling 7-day window ending on `end`, inclusive. No model.
import { addDays, localIsoDate, type IsoDate } from "../shared/dates.js";
import type { OrganiseItem } from "./model.js";
import type { OrganiseList } from "./service.js";
import { roundValue, type Tracker, type TrackerEntry } from "./trackers.js";

export const reviewDays = 7;
/** Scaling a period target to 7 days, exactly as the spec states. */
export const sevenDayFactor = { weekly: 1, monthly: 7 / 30.4375, yearly: 7 / 365.25 } as const;

export interface ReviewTracker {
  id: string;
  name: string;
  unit: string;
  period: Tracker["period"];
  total: number;
  /** The tracker's target scaled to 7 days (rounded to 2 decimals); null without a target. */
  target7: number | null;
  /** "x of y (7-day equivalent)", or the total alone. */
  summary: string;
}

export interface WeeklyReview {
  start: IsoDate;
  end: IsoDate;
  done: { tasks: OrganiseItem[]; listItems: OrganiseItem[]; entries: (TrackerEntry & { tracker: string })[] };
  slipped: { tasks: OrganiseItem[]; reminders: OrganiseItem[] };
  trackers: ReviewTracker[];
}

/** done_at is a timestamp; the review compares its local calendar date. */
export function doneDate(item: OrganiseItem): IsoDate | null {
  return item.done_at ? localIsoDate(new Date(item.done_at)) : null;
}

function inWindow(date: IsoDate | null, start: IsoDate, end: IsoDate): boolean {
  return date !== null && date >= start && date <= end;
}

function amount(value: number, unit: string): string {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
  return unit ? `${text} ${unit}` : text;
}

export function weeklyReview(input: { items: readonly OrganiseItem[]; lists: readonly OrganiseList[]; trackers: readonly Tracker[]; entries: readonly TrackerEntry[]; end: IsoDate; today: IsoDate }): WeeklyReview {
  const { items, lists, trackers, entries, end, today } = input;
  const start = addDays(end, -(reviewDays - 1));
  const lastStatus = (item: OrganiseItem): string | undefined => lists.find((list) => list.id === item.list_id)?.statuses.at(-1);
  const byDone = (left: OrganiseItem, right: OrganiseItem): number => (left.done_at ?? "").localeCompare(right.done_at ?? "");
  const byDate = (left: OrganiseItem, right: OrganiseItem): number => (left.date ?? "").localeCompare(right.date ?? "") || left.title.localeCompare(right.title);
  const names = new Map(trackers.map((tracker) => [tracker.id, tracker.name]));
  return {
    start,
    end,
    done: {
      tasks: items.filter((item) => item.type === "task" && item.status === "done" && inWindow(doneDate(item), start, end)).sort(byDone),
      listItems: items.filter((item) => item.type === "list_item" && item.status === lastStatus(item) && inWindow(doneDate(item), start, end)).sort(byDone),
      entries: entries.filter((entry) => inWindow(entry.date, start, end) && names.has(entry.tracker_id)).sort((left, right) => left.date.localeCompare(right.date))
        .map((entry) => ({ ...entry, tracker: names.get(entry.tracker_id)! }))
    },
    slipped: {
      tasks: items.filter((item) => item.type === "task" && item.status !== "done" && inWindow(item.date, start, end) && item.date! < today).sort(byDate),
      reminders: items.filter((item) => item.type === "reminder" && item.status !== "done" && inWindow(item.date, start, end)).sort(byDate)
    },
    trackers: trackers.map((tracker) => {
      const total = roundValue(entries.filter((entry) => entry.tracker_id === tracker.id && inWindow(entry.date, start, end)).reduce((sum, entry) => sum + entry.value, 0));
      const target7 = tracker.target === null ? null : Math.round(tracker.target * sevenDayFactor[tracker.period] * 100) / 100;
      return {
        id: tracker.id, name: tracker.name, unit: tracker.unit, period: tracker.period, total, target7,
        summary: target7 === null ? amount(total, tracker.unit) : `${amount(total, tracker.unit)} of ${amount(target7, tracker.unit)} (7-day equivalent)`
      };
    })
  };
}
