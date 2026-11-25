// Calendar v2 views (phase 4). Pure merge of the app's items (CalendarService) and the synced Google events
// (events store) into day / week / month / today / overview shapes, plus search and CSV export. No I/O and no
// clock — the caller passes the date range and today. Read-only calendars (subscribed, holidays) are flagged
// "dimmed" and carry their calendar name. Nothing here writes to Google. See docs/design/calendar-v2.md.
import { addDays, mondayOf, monthGrid, type IsoDate, type IsoMonth } from "../shared/dates.js";
import { kindLabel } from "../shared/kind-labels.js";
import type { Item } from "./model.js";
import { occurrences } from "./recurrence.js";
import type { EventsDocument, StoredEvent } from "./events.js";

/** One Google event as shown in a view. */
export interface DisplayEvent {
  calendarId: string;
  calendarName: string;
  title: string;
  date: IsoDate;
  time: string | null;
  endTime: string | null;
  endDate: IsoDate | null;
  allDay: boolean;
  /** Read-only calendar (subscribed / holiday): shown dimmed and labelled with the calendar name. */
  dimmed: boolean;
  /** Per-calendar display emphasis; stored locally, never changes the event. */
  highlight: boolean;
  colour: string | null;
}

/** One item occurrence as shown in a view (a recurring item appears once per occurrence date). */
export interface DisplayItem {
  id: string;
  kind: Item["kind"];
  title: string;
  date: IsoDate;
  time: string | null;
  allDay: boolean;
  priority: Item["priority"];
  status: Item["status"];
  categoryId: string | null;
  /** Open task whose effective date is before today. */
  overdue: boolean;
}

export interface DayCell {
  date: IsoDate;
  items: DisplayItem[];
  events: DisplayEvent[];
}

/** The effective date used for ordering and overdue checks. */
function effectiveDate(item: Item): IsoDate {
  return item.dueDate ?? item.plannedDate ?? item.date;
}

function toDisplayItem(item: Item, onDate: IsoDate, today: IsoDate): DisplayItem {
  const overdue = item.kind === "task" && item.status === "open" && onDate < today;
  return {
    id: item.id, kind: item.kind, title: item.title, date: onDate, time: item.time, allDay: item.allDay,
    priority: item.priority, status: item.status, categoryId: item.categoryId, overdue
  };
}

/** Item occurrences that fall within [from, to] inclusive, each as a DisplayItem on its occurrence date. */
export function itemsForRange(items: Item[], from: IsoDate, to: IsoDate, today: IsoDate): DisplayItem[] {
  const out: DisplayItem[] = [];
  for (const item of items) {
    for (const date of occurrences(item, from, to)) out.push(toDisplayItem(item, date, today));
  }
  return out.sort(compareByDateTime);
}

/**
 * Google events overlapping [from, to], honouring the hidden preference and tagging dimmed / highlight.
 * App-owned events (those the app pushed — carrying our viralItemId, or linked in `ownedEventIds`) are left out:
 * they are already shown as their app item, so including them here would duplicate a pushed deadline/event.
 */
export function eventsForRange(document: EventsDocument, from: IsoDate, to: IsoDate, ownedEventIds: Set<string> = new Set()): DisplayEvent[] {
  const byId = new Map(document.calendars.map((calendar) => [calendar.id, calendar]));
  const out: DisplayEvent[] = [];
  for (const event of document.events) {
    if (event.appOwned || ownedEventIds.has(event.eventId)) continue; // shown as its app item, not twice
    const calendar = byId.get(event.calendarId);
    const pref = document.prefs[event.calendarId];
    if (pref?.hidden) continue;
    const lastDay = event.allDay ? event.endDate ?? event.date : event.date;
    if (event.date > to || lastDay < from) continue;
    out.push({
      calendarId: event.calendarId,
      calendarName: calendar?.name ?? event.calendarId,
      title: event.title,
      date: event.date,
      time: event.time,
      endTime: event.endTime,
      endDate: event.endDate,
      allDay: event.allDay,
      dimmed: calendar ? calendar.readOnly : true,
      highlight: pref?.highlight ?? false,
      colour: event.colour
    });
  }
  return out.sort(compareByDateTime);
}

function compareByDateTime(a: { date: IsoDate; time: string | null }, b: { date: IsoDate; time: string | null }): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return (a.time ?? "").localeCompare(b.time ?? "");
}

function cellsFor(dates: IsoDate[], items: Item[], document: EventsDocument, today: IsoDate, ownedEventIds: Set<string>): DayCell[] {
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const items_ = itemsForRange(items, first, last, today);
  const events_ = eventsForRange(document, first, last, ownedEventIds);
  return dates.map((date) => ({
    date,
    items: items_.filter((item) => item.date === date),
    events: events_.filter((event) => (event.allDay ? date >= event.date && date <= (event.endDate ?? event.date) : event.date === date))
  }));
}

export interface DayView { mode: "day"; date: IsoDate; day: DayCell; }
export function dayView(date: IsoDate, items: Item[], document: EventsDocument, today: IsoDate, ownedEventIds: Set<string> = new Set()): DayView {
  return { mode: "day", date, day: cellsFor([date], items, document, today, ownedEventIds)[0]! };
}

export interface WeekView { mode: "week"; start: IsoDate; end: IsoDate; days: DayCell[]; }
export function weekView(date: IsoDate, items: Item[], document: EventsDocument, today: IsoDate, ownedEventIds: Set<string> = new Set()): WeekView {
  const start = mondayOf(date);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return { mode: "week", start, end: dates[6]!, days: cellsFor(dates, items, document, today, ownedEventIds) };
}

export interface MonthView { mode: "month"; month: IsoMonth; weeks: DayCell[][]; }
export function monthView(month: IsoMonth, items: Item[], document: EventsDocument, today: IsoDate, ownedEventIds: Set<string> = new Set()): MonthView {
  const grid = monthGrid(month);
  const flat = cellsFor(grid.flat(), items, document, today, ownedEventIds);
  const byDate = new Map(flat.map((cell) => [cell.date, cell]));
  return { mode: "month", month, weeks: grid.map((week) => week.map((date) => byDate.get(date)!)) };
}

export interface TodayStrip {
  date: IsoDate;
  items: DisplayItem[];
  events: DisplayEvent[];
  /** Open tasks whose effective date is before today, carried over to today. */
  overdue: DisplayItem[];
}

/** Today's items and Google events, plus overdue open tasks carried over from earlier days. */
export function todayStrip(today: IsoDate, items: Item[], document: EventsDocument, ownedEventIds: Set<string> = new Set()): TodayStrip {
  const todays = cellsFor([today], items, document, today, ownedEventIds)[0]!;
  // Overdue open tasks: their soonest occurrence up to yesterday still open.
  const overdue: DisplayItem[] = [];
  const yesterday = addDays(today, -1);
  for (const item of items) {
    if (item.kind !== "task" || item.status !== "open") continue;
    const effective = effectiveDate(item);
    if (effective <= yesterday && occurrences(item, effective, yesterday).length > 0) {
      overdue.push(toDisplayItem(item, effective, today));
    }
  }
  return { date: today, items: todays.items, events: todays.events, overdue: overdue.sort(compareByDateTime) };
}

export interface Overview {
  date: IsoDate;
  week: WeekView;
  month: MonthView;
  today: TodayStrip;
}
export function overview(date: IsoDate, month: IsoMonth, items: Item[], document: EventsDocument, today: IsoDate, ownedEventIds: Set<string> = new Set()): Overview {
  return { date, week: weekView(date, items, document, today, ownedEventIds), month: monthView(month, items, document, today, ownedEventIds), today: todayStrip(today, items, document, ownedEventIds) };
}

/** Case-insensitive title search over items (keeps the old Organise search behaviour, pointed at the new store). */
export function searchItems(items: Item[], query: string): Item[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return items.filter((item) => item.title.toLowerCase().includes(needle));
}

const CSV_COLUMNS = ["kind", "title", "date", "time", "allDay", "dueDate", "plannedDate", "priority", "status", "categoryId"] as const;
// The export header uses the display names (phase 5b): the "kind" column is shown as "type" with Deadline/Event.
const CSV_HEADERS = ["type", "title", "date", "time", "allDay", "dueDate", "plannedDate", "priority", "status", "categoryId"];

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV of every item, one row each (keeps the old Organise export behaviour, pointed at the new store). */
export function itemsToCsv(items: Item[]): string {
  const rows = [CSV_HEADERS.join(",")];
  for (const item of items) {
    rows.push(CSV_COLUMNS.map((column) => csvCell(column === "kind" ? kindLabel(item.kind) : (item as unknown as Record<string, unknown>)[column])).join(","));
  }
  return `${rows.join("\n")}\n`;
}
