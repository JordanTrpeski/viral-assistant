// Organise Overview (phase 4): the Today strip, a weekly view and a monthly view of items and Google events.
import { api } from "./api.js";
import { h } from "./dom.js";
import { eventRow, itemRow, renderTodayStrip, type DayCell, type TodayStrip } from "./cal-common.js";

interface WeekView { mode: "week"; start: string; end: string; days: DayCell[]; }
interface MonthView { mode: "month"; month: string; weeks: DayCell[][]; }
interface Overview { date: string; week: WeekView; month: MonthView; today: TodayStrip; }

function weekPanel(week: WeekView): HTMLElement {
  return h("div", { class: "panel" }, h("h3", {}, `This week (${week.start} – ${week.end})`),
    h("div", { class: "cal-week" }, ...week.days.map((cell) => h("div", { class: "cal-day" },
      h("div", { class: "cal-day-head" }, cell.date),
      ...cell.items.map(itemRow),
      ...cell.events.map(eventRow),
      cell.items.length === 0 && cell.events.length === 0 ? h("span", { class: "muted small" }, "—") : h("span", {})))));
}

function monthPanel(month: MonthView): HTMLElement {
  return h("div", { class: "panel" }, h("h3", {}, `This month (${month.month})`),
    h("table", { class: "cal-month" }, h("tbody", {}, ...month.weeks.map((week) => h("tr", {}, ...week.map((cell) => {
      const dots = [
        ...cell.items.slice(0, 3).map((item) => h("div", { class: "cal-dot item", title: item.title }, item.title)),
        ...cell.events.slice(0, 3).map((event) => h("div", { class: `cal-dot event${event.dimmed ? " dimmed" : ""}`, title: `${event.title} — ${event.calendarName}` }, event.title))
      ];
      const inMonth = cell.date.slice(0, 7) === month.month;
      return h("td", { class: inMonth ? "cal-cell" : "cal-cell out" }, h("div", { class: "cal-cell-date" }, cell.date.slice(8)), ...dots);
    }))))));
}

export async function renderCalendarOverview(container: HTMLElement): Promise<void> {
  const data = await api<Overview>("GET", "/api/calendar/overview");
  container.replaceChildren(h("div", { class: "page cal-overview" },
    h("h2", {}, "Overview"),
    renderTodayStrip(data.today),
    weekPanel(data.week),
    monthPanel(data.month)));
}
