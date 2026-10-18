// Overview: month calendar in the centre; right column with Next 7 days, Reminders, Budget and the chat pane.
import type { ReminderPanelItem } from "../overview.js";
import { colourInfo } from "../shared/colours.js";
import { daysBetween } from "../shared/dates.js";
import { formatCents } from "../shared/money.js";
import type { TimelineItem } from "../timeline.js";
import { api, type AppContext } from "./api.js";
import { monthView, weekView, type BudgetViewData } from "./budget-view.js";
import { openSource, renderCalendar } from "./calendar.js";
import { isChatExpanded, renderChat } from "./chat.js";
import { h } from "./dom.js";

interface OverviewResponse {
  today: string;
  nextSevenDays: TimelineItem[];
  reminders: ReminderPanelItem[];
  budget: BudgetViewData;
}

const state: { budget: "week" | "month" } = { budget: "week" };
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayLabel(date: string, today: string): string {
  const offset = daysBetween(today, date);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const weekday = weekdays[(new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7];
  return `${weekday} ${day}`;
}

function timelineRow(context: AppContext, item: TimelineItem, today: string, extraClass = ""): HTMLElement {
  return h("button", { class: `timeline-row${extraClass}`, title: `${colourInfo[item.colour].label}: open in its module`, onclick: () => openSource(context, item) },
    h("span", { class: "timeline-date" }, dayLabel(item.date, today)),
    h("span", { class: `entry entry-${item.colour}` }, item.label),
    h("span", { class: "timeline-amount" }, item.amountCents === null ? "" : formatCents(item.amountCents)));
}

function nextSevenPanel(context: AppContext, data: OverviewResponse): HTMLElement {
  return h("section", { class: "panel" },
    h("h3", {}, "Next 7 days"),
    data.nextSevenDays.length
      ? h("div", { class: "timeline-list" }, ...data.nextSevenDays.map((item) => timelineRow(context, item, data.today)))
      : h("p", { class: "muted small" }, "Nothing scheduled in the next seven days."));
}

function remindersPanel(context: AppContext, data: OverviewResponse): HTMLElement {
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h3", {}, "Reminders"), h("a", { class: "small", href: "#/reminders" }, "Open")),
    data.reminders.length
      ? h("div", { class: "timeline-list" }, ...data.reminders.map((item) => timelineRow(context, item, data.today, item.overdue ? " overdue" : "")))
      : h("p", { class: "muted small" }, "No open reminders in the next 30 days."));
}

function budgetPanel(context: AppContext, data: OverviewResponse): HTMLElement {
  const toggle = (mode: "week" | "month", label: string): HTMLElement =>
    h("button", { class: `chip${state.budget === mode ? " active" : ""}`, onclick: () => { state.budget = mode; void context.refresh(); } }, label);
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" },
      h("h3", {}, "Budget"),
      h("div", { class: "chip-group" }, toggle("week", "This week"), toggle("month", "This month")),
      h("a", { class: "small", href: "#/finance" }, "Open Finance")),
    state.budget === "week" ? weekView(context, data.budget, false) : monthView(context, data.budget, false));
}

export async function renderOverview(container: HTMLElement, context: AppContext): Promise<void> {
  const [calendar, data, chat] = await Promise.all([renderCalendar(context), api<OverviewResponse>("GET", "/api/overview"), renderChat(context)]);
  // Expanded chat takes the Overview area; the calendar and the other right-column panels collapse out of the way.
  const expanded = isChatExpanded();
  container.replaceChildren(h("div", { class: `overview${expanded ? " chat-expanded" : ""}` },
    expanded ? null : calendar,
    h("div", { class: "right-column" },
      expanded ? null : nextSevenPanel(context, data),
      expanded ? null : remindersPanel(context, data),
      expanded ? null : budgetPanel(context, data),
      chat)));
}
