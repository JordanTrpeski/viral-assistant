// Shared pieces for the rebuilt Organise screens (phase 4): display types mirroring the server JSON, row
// renderers, and the Today strip. Browser-only; no server imports.
import { api } from "./api.js";
import { h } from "./dom.js";
import { kindLabel } from "../shared/kind-labels.js";

export interface DisplayItem {
  id: string;
  kind: "task" | "reminder";
  title: string;
  date: string;
  time: string | null;
  allDay: boolean;
  priority: "low" | "normal" | "high";
  status: "open" | "done";
  categoryId: string | null;
  overdue: boolean;
}

export interface DisplayEvent {
  calendarId: string;
  calendarName: string;
  title: string;
  date: string;
  time: string | null;
  endTime: string | null;
  endDate: string | null;
  allDay: boolean;
  dimmed: boolean;
  highlight: boolean;
  colour: string | null;
}

export interface DayCell { date: string; items: DisplayItem[]; events: DisplayEvent[]; }
export interface TodayStrip { date: string; items: DisplayItem[]; events: DisplayEvent[]; overdue: DisplayItem[]; }

export function itemRow(item: DisplayItem): HTMLElement {
  const when = item.allDay ? "all day" : item.time ?? "";
  return h("div", { class: `cal-row item${item.overdue ? " overdue" : ""}${item.status === "done" ? " done" : ""}` },
    h("span", { class: "cal-when" }, when),
    h("span", { class: "cal-title" }, item.title),
    h("span", { class: "cal-tag" }, kindLabel(item.kind)));
}

export function eventRow(event: DisplayEvent): HTMLElement {
  const when = event.allDay ? "all day" : event.time ?? "";
  return h("div", { class: `cal-row event${event.dimmed ? " dimmed" : ""}${event.highlight ? " highlight" : ""}` },
    h("span", { class: "cal-when" }, when),
    h("span", { class: "cal-title" }, event.title),
    h("span", { class: "cal-cal" }, `from ${event.calendarName}`));
}

export function renderTodayStrip(strip: TodayStrip): HTMLElement {
  const children: (HTMLElement | null)[] = [h("h3", {}, `Today — ${strip.date}`)];
  if (strip.overdue.length) {
    children.push(h("div", { class: "cal-overdue" }, h("strong", {}, `Overdue (${strip.overdue.length})`), ...strip.overdue.map(itemRow)));
  }
  children.push(...strip.items.map(itemRow), ...strip.events.map(eventRow));
  if (!strip.items.length && !strip.events.length && !strip.overdue.length) children.push(h("p", { class: "muted small" }, "Nothing scheduled today."));
  return h("div", { class: "panel cal-today" }, ...children.filter((child): child is HTMLElement => child !== null));
}

export async function loadTodayStrip(): Promise<TodayStrip> {
  return api<TodayStrip>("GET", "/api/calendar/today");
}

export async function loadCategories(): Promise<{ id: string; name: string }[]> {
  try { return await api<{ id: string; name: string }[]>("GET", "/api/calendar/categories"); }
  catch { return []; }
}
