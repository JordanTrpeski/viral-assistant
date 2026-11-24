// Organise Calendar (phase 4): day, week and month views of items and Google events from all calendars.
// Subscribed / holiday events are dimmed and labelled with their calendar name. View mode and the focused date
// are kept in module state and re-fetched on navigation.
import { api } from "./api.js";
import { h } from "./dom.js";
import { eventRow, itemRow, type DayCell } from "./cal-common.js";

type Mode = "day" | "week" | "month";
interface DayView { mode: "day"; date: string; day: DayCell; }
interface WeekView { mode: "week"; start: string; end: string; days: DayCell[]; }
interface MonthView { mode: "month"; month: string; weeks: DayCell[][]; }

let mode: Mode = "week";
let focus = "";

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

function dayCell(cell: DayCell): HTMLElement {
  return h("div", { class: "cal-day" }, h("div", { class: "cal-day-head" }, cell.date),
    ...cell.items.map(itemRow), ...cell.events.map(eventRow),
    cell.items.length === 0 && cell.events.length === 0 ? h("span", { class: "muted small" }, "—") : h("span", {}));
}

async function draw(container: HTMLElement): Promise<void> {
  if (focus === "") {
    const today = await api<{ today: string }>("GET", "/api/status").then((status) => status.today).catch(() => new Date().toISOString().slice(0, 10));
    focus = today;
  }
  const query = mode === "month" ? `mode=month&month=${focus.slice(0, 7)}` : `mode=${mode}&date=${focus}`;
  const view = await api<DayView | WeekView | MonthView>("GET", `/api/calendar/view?${query}`);

  const tab = (label: string, value: Mode): HTMLElement => h("button", { class: `tab${mode === value ? " active" : ""}`, onclick: () => { mode = value; void draw(container); } }, label);
  const step = (delta: number): void => { focus = mode === "month" ? addMonths(focus, delta) : addDays(focus, mode === "week" ? delta * 7 : delta); void draw(container); };

  let body: HTMLElement;
  if (view.mode === "day") body = h("div", { class: "cal-week one" }, dayCell(view.day));
  else if (view.mode === "week") body = h("div", { class: "cal-week" }, ...view.days.map(dayCell));
  else body = h("table", { class: "cal-month" }, h("tbody", {}, ...view.weeks.map((week) => h("tr", {}, ...week.map((cell) => {
    const inMonth = cell.date.slice(0, 7) === view.month;
    return h("td", { class: inMonth ? "cal-cell" : "cal-cell out" },
      h("div", { class: "cal-cell-date" }, cell.date.slice(8)),
      ...cell.items.slice(0, 3).map((item) => h("div", { class: "cal-dot item", title: item.title }, item.title)),
      ...cell.events.slice(0, 3).map((event) => h("div", { class: `cal-dot event${event.dimmed ? " dimmed" : ""}`, title: `${event.title} — ${event.calendarName}` }, event.title)));
  })))));

  const heading = view.mode === "month" ? view.month : view.mode === "week" ? `${view.start} – ${view.end}` : view.date;
  container.replaceChildren(h("div", { class: "page cal-views" },
    h("h2", {}, "Calendar"),
    h("div", { class: "cal-toolbar" },
      h("div", { class: "tabs" }, tab("Day", "day"), tab("Week", "week"), tab("Month", "month")),
      h("div", { class: "cal-nav" },
        h("button", { onclick: () => step(-1) }, "‹"),
        h("strong", {}, heading),
        h("button", { onclick: () => step(1) }, "›"),
        h("button", { class: "ghost", onclick: () => { focus = ""; void draw(container); } }, "Today"))),
    h("p", { class: "muted small" }, "Subscribed and holiday calendars are shown dimmed and labelled."),
    body));
}

export async function renderCalendarViews(container: HTMLElement): Promise<void> {
  await draw(container);
}
