import { colourCategories, colourInfo, type ColourCategory } from "./shared/colours.js";
import { addDays, firstOfMonth, lastOfMonth, monthGrid, monthOf, type IsoDate, type IsoMonth } from "./shared/dates.js";
import { sortTimeline, type TimelineItem } from "./timeline.js";

/** Entries shown per day before collapsing the rest into "+N more". */
export const maxVisiblePerDay = 2;

export interface CalendarDay {
  date: IsoDate;
  inMonth: boolean;
  isToday: boolean;
  /** Up to two entries to show in the cell. */
  visible: TimelineItem[];
  /** N in "+N more": entries beyond the first two (hidden legend categories excluded). */
  moreCount: number;
  /** Every entry of the day that is not hidden by the legend, for the expanded day view. */
  items: TimelineItem[];
}

export interface LegendEntry {
  category: ColourCategory;
  label: string;
  colour: string;
  hidden: boolean;
  /** Entries of this category in the displayed month (counted even while hidden). */
  count: number;
}

export interface CalendarMonth {
  month: IsoMonth;
  today: IsoDate;
  weeks: CalendarDay[][];
  legend: LegendEntry[];
}

/** Splits a day's entries into what fits in the cell and the "+N more" count. */
export function collapseDay(items: TimelineItem[], limit = maxVisiblePerDay): { visible: TimelineItem[]; moreCount: number } {
  return { visible: items.slice(0, limit), moreCount: Math.max(0, items.length - limit) };
}

/** Month view, weeks starting Monday, including the leading and trailing days of neighbouring months. */
export function buildCalendar(allItems: TimelineItem[], month: IsoMonth, today: IsoDate, hidden: ReadonlySet<ColourCategory> = new Set()): CalendarMonth {
  const grid = monthGrid(month);
  const start = grid[0]![0]!;
  const end = grid.at(-1)![6]!;
  const byDate = new Map<IsoDate, TimelineItem[]>();
  for (const item of sortTimeline(allItems.filter((entry) => entry.date >= start && entry.date <= end))) {
    byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  }
  const weeks = grid.map((week) => week.map((date) => {
    const items = (byDate.get(date) ?? []).filter((item) => !hidden.has(item.colour));
    return { date, inMonth: monthOf(date) === month, isToday: date === today, items, ...collapseDay(items) };
  }));
  const first = firstOfMonth(month);
  const last = lastOfMonth(month);
  const inMonth = allItems.filter((item) => item.date >= first && item.date <= last);
  const legend = colourCategories.map((category) => ({
    category, ...colourInfo[category], hidden: hidden.has(category), count: inMonth.filter((item) => item.colour === category).length
  }));
  return { month, today, weeks, legend };
}

/** Items dated from `from` through `from + days - 1`, in display order. */
export function itemsInWindow(allItems: TimelineItem[], from: IsoDate, days: number): TimelineItem[] {
  const to = addDays(from, days - 1);
  return sortTimeline(allItems.filter((item) => item.date >= from && item.date <= to));
}
