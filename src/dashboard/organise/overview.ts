// Organise overview data: search, the Today strip, panel summaries and the CSV export. Plain data, no model.
import { addDays, type IsoDate } from "../shared/dates.js";
import { itemTypes, type ItemType, type OrganiseItem } from "./model.js";
import type { OrganiseList } from "./service.js";
import type { TrackerView } from "./trackers.js";

export const maxQueryLength = 200;
/** How far ahead the Reminders panel looks. */
export const reminderPanelDays = 30;

export interface SearchResult {
  q: string;
  total: number;
  groups: Partial<Record<ItemType, OrganiseItem[]>>;
}

/** Case-insensitive match on title, notes, checklist text, and the name of the item's project. */
export function searchItems(items: readonly OrganiseItem[], query: string): SearchResult {
  const q = query.trim();
  const needle = q.toLowerCase();
  const projects = new Map(items.filter((item) => item.type === "project").map((project) => [project.id, project.title.toLowerCase()]));
  const matches = needle ? items.filter((item) => item.title.toLowerCase().includes(needle)
    || item.notes.toLowerCase().includes(needle)
    || (item.checklist ?? []).some((entry) => entry.text.toLowerCase().includes(needle))
    || (item.project_id !== null && (projects.get(item.project_id) ?? "").includes(needle))) : [];
  const groups: Partial<Record<ItemType, OrganiseItem[]>> = {};
  for (const type of itemTypes) {
    const found = matches.filter((item) => item.type === type).sort((left, right) => left.title.localeCompare(right.title));
    if (found.length) groups[type] = found;
  }
  return { q, total: matches.length, groups };
}

export interface TodayStrip {
  today: IsoDate;
  tasks: (OrganiseItem & { overdue: boolean })[];
  reminders: (OrganiseItem & { overdue: boolean })[];
  /** Open reminders still to come whose prepare_by is today or earlier. */
  prepare: OrganiseItem[];
}

/** Today strip: open tasks due today or overdue; open reminders dated today or overdue; reminders to prepare for now. */
export function todayStrip(items: readonly OrganiseItem[], today: IsoDate): TodayStrip {
  const due = (type: ItemType): (OrganiseItem & { overdue: boolean })[] => items
    .filter((item) => item.type === type && item.status !== "done" && item.date !== null && item.date <= today)
    .sort((left, right) => left.date!.localeCompare(right.date!) || left.title.localeCompare(right.title))
    .map((item) => ({ ...item, overdue: item.date! < today }));
  return {
    today,
    tasks: due("task"),
    reminders: due("reminder"),
    prepare: items.filter((item) => item.type === "reminder" && item.status !== "done" && item.prepare_by !== null && item.prepare_by <= today && item.date !== null && item.date > today)
      .sort((left, right) => left.date!.localeCompare(right.date!))
  };
}

export interface OverviewPanels {
  tasks: { open: number; dueThisWeek: number; overdue: number };
  reminders: { date: IsoDate; label: string; item_id: string; prepare: boolean }[];
  notesAndLists: { notes: number; lists: number; rows: number; openRows: number };
  trackers: Pick<TrackerView, "id" | "name" | "unit" | "period" | "progress">[];
}

export function overviewPanels(items: readonly OrganiseItem[], lists: readonly OrganiseList[], trackers: readonly TrackerView[], today: IsoDate): OverviewPanels {
  const weekEnd = addDays(today, 6);
  const horizon = addDays(today, reminderPanelDays);
  const openTasks = items.filter((item) => item.type === "task" && item.status !== "done");
  const openReminders = items.filter((item) => item.type === "reminder" && item.status !== "done" && item.date !== null);
  const reminders = [
    ...openReminders.filter((item) => item.date! >= today && item.date! <= horizon).map((item) => ({ date: item.date!, label: item.title, item_id: item.id, prepare: false })),
    ...openReminders.filter((item) => item.prepare_by !== null && item.prepare_by >= today && item.prepare_by <= horizon).map((item) => ({ date: item.prepare_by!, label: `Prepare: ${item.title}`, item_id: item.id, prepare: true }))
  ].sort((left, right) => left.date.localeCompare(right.date) || Number(left.prepare) - Number(right.prepare) || left.label.localeCompare(right.label));
  const rows = items.filter((item) => item.type === "list_item");
  return {
    tasks: {
      open: openTasks.length,
      dueThisWeek: openTasks.filter((task) => task.date !== null && task.date >= today && task.date <= weekEnd).length,
      overdue: openTasks.filter((task) => task.date !== null && task.date < today).length
    },
    reminders,
    notesAndLists: {
      notes: items.filter((item) => item.type === "note").length,
      lists: lists.length,
      rows: rows.length,
      openRows: rows.filter((row) => row.status !== lists.find((list) => list.id === row.list_id)?.statuses.at(-1)).length
    },
    trackers: trackers.map(({ id, name, unit, period, progress }) => ({ id, name, unit, period, progress }))
  };
}

export const exportColumns = ["id", "type", "title", "status", "date", "prepare_by", "category", "recurrence", "interval_days", "priority", "project", "list", "notes", "links", "checklist", "created_at", "updated_at", "done_at"] as const;

/** Text a spreadsheet might run as a formula gets a leading apostrophe. */
function neutralise(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

/** CSV export: UTF-8 byte-order mark, a header row, every field quoted (quotes doubled), CRLF line ends. */
export function exportCsv(items: readonly OrganiseItem[], lists: readonly OrganiseList[]): string {
  const titles = new Map(items.map((item) => [item.id, item.title]));
  const listNames = new Map(lists.map((list) => [list.id, list.name]));
  const rows = [...items].sort((left, right) => left.type.localeCompare(right.type) || left.created_at.localeCompare(right.created_at)).map((item) => [
    item.id, item.type, neutralise(item.title), item.status ?? "", item.date ?? "", item.prepare_by ?? "", item.category ?? "", item.recurrence ?? "",
    item.interval_days === null ? "" : String(item.interval_days), item.priority ?? "",
    neutralise(item.project_id ? titles.get(item.project_id) ?? "" : ""), neutralise(item.list_id ? listNames.get(item.list_id) ?? "" : ""),
    neutralise(item.notes), item.links.join(" "),
    neutralise((item.checklist ?? []).map((entry) => `${entry.done ? "[x]" : "[ ]"} ${entry.text}`).join("; ")),
    item.created_at, item.updated_at, item.done_at ?? ""
  ]);
  return `﻿${[[...exportColumns], ...rows].map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`;
}
