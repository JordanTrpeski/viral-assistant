// Month calendar: Monday-first grid, colour legend that hides/shows categories, "+N more" day expansion.
import type { CalendarDay, CalendarMonth } from "../calendar.js";
import type { ColourCategory } from "../shared/colours.js";
import { colourInfo } from "../shared/colours.js";
import { addMonths, monthOf } from "../shared/dates.js";
import { formatCents } from "../shared/money.js";
import type { TimelineItem } from "../timeline.js";
import { api, type AppContext } from "./api.js";
import { h } from "./dom.js";

const hiddenKey = "viral.calendar.hidden";
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const state: { month: string | null; expanded: string | null } = { month: null, expanded: null };

/** Legend choices are a per-viewer preference kept in the browser; the calendar works without storage. */
function loadHidden(): Set<ColourCategory> {
  try { return new Set(JSON.parse(localStorage.getItem(hiddenKey) ?? "[]") as ColourCategory[]); }
  catch { return new Set(); }
}

function saveHidden(hidden: Set<ColourCategory>): void {
  try { localStorage.setItem(hiddenKey, JSON.stringify([...hidden])); }
  catch { /* storage unavailable: the choice lasts for this page view only */ }
}

let hidden = loadHidden();

/** Opens the module that owns an entry, so anything on the calendar can be changed where it lives. */
export function openSource(context: AppContext, item: TimelineItem): void {
  if (item.origin === "organise") { context.navigate(`organise-reminders?item=${item.sourceId}`); return; }
  context.navigate(item.source === "transaction" ? "finance" : "reminders");
}

export function entryLabel(context: AppContext, item: TimelineItem): HTMLElement {
  const title = `${item.label}${item.amountCents === null ? "" : ` · ${formatCents(item.amountCents)}`} · ${colourInfo[item.colour].label}`;
  return h("button", { class: `entry entry-${item.colour}${item.status === "done" ? " done" : ""}`, title, onclick: () => openSource(context, item) }, item.label);
}

function dayCell(context: AppContext, day: CalendarDay): HTMLElement {
  const dayNumber = Number(day.date.slice(8));
  const expanded = state.expanded === day.date;
  return h("div", { class: `day${day.inMonth ? "" : " outside"}${day.isToday ? " today" : ""}${expanded ? " expanded" : ""}`, dataset: { date: day.date } },
    h("div", { class: "day-number" }, String(dayNumber)),
    ...(expanded ? day.items : day.visible).map((item) => entryLabel(context, item)),
    day.moreCount > 0 && !expanded ? h("button", { class: "more", onclick: () => { state.expanded = day.date; void context.refresh(); } }, `+${day.moreCount} more`) : null,
    expanded ? h("button", { class: "more", onclick: () => { state.expanded = null; void context.refresh(); } }, "Show less") : null);
}

export async function renderCalendar(context: AppContext): Promise<HTMLElement> {
  const month = state.month ?? monthOf(context.today);
  const calendar = await api<CalendarMonth>("GET", `/api/calendar?month=${month}${hidden.size ? `&hidden=${[...hidden].join(",")}` : ""}`);
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const go = (target: string | null): void => { state.month = target; state.expanded = null; void context.refresh(); };
  return h("section", { class: "panel calendar" },
    h("div", { class: "calendar-header" },
      h("div", { class: "calendar-title" },
        h("button", { "aria-label": "Previous month", onclick: () => go(addMonths(month, -1)) }, "‹"),
        h("h2", {}, `${monthNames[monthNumber - 1]} ${year}`),
        h("button", { "aria-label": "Next month", onclick: () => go(addMonths(month, 1)) }, "›"),
        h("button", { onclick: () => go(null) }, "Today")),
      h("div", { class: "legend" }, ...calendar.legend.map((entry) => h("button", {
        class: `legend-item${entry.hidden ? " off" : ""}`, "aria-pressed": String(!entry.hidden), title: `${entry.hidden ? "Show" : "Hide"} ${entry.label} (${entry.count} this month)`,
        onclick: () => {
          if (hidden.has(entry.category)) hidden.delete(entry.category); else hidden.add(entry.category);
          hidden = new Set(hidden);
          saveHidden(hidden);
          void context.refresh();
        }
      }, h("span", { class: "swatch", style: `background:${entry.colour}` }), entry.label)))),
    h("div", { class: "weekdays" }, ...["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => h("div", {}, day))),
    h("div", { class: "calendar-grid", style: `grid-template-rows: repeat(${calendar.weeks.length}, minmax(0, 1fr))` }, ...calendar.weeks.flat().map((day) => dayCell(context, day))));
}
