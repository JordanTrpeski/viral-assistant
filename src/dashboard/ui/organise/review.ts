// Weekly review: the last 7 days ending today (or a chosen end date). Plain data, no model.
import type { WeeklyReview } from "../../organise/review.js";
import { api, type AppContext } from "../api.js";
import { h } from "../dom.js";

const state: { end: string } = { end: "" };

function line(title: string, detail: string, onclick?: () => void): HTMLElement {
  return h("button", { class: "item-row", ...(onclick ? { onclick } : { disabled: true }) }, h("span", { class: "item-title" }, title), h("span", { class: "muted small" }, detail));
}

function block(title: string, rows: HTMLElement[], empty: string): HTMLElement {
  return h("div", { class: "review-block" }, h("h4", {}, `${title} · ${rows.length}`), rows.length ? h("div", { class: "item-list" }, ...rows) : h("p", { class: "muted small" }, empty));
}

export async function renderReview(container: HTMLElement, context: AppContext): Promise<void> {
  const review = await api<WeeklyReview>("GET", `/api/organise/review${state.end ? `?end=${state.end}` : ""}`);
  const goToItem = (id: string, route: string) => () => context.navigate(`${route}?item=${id}`);
  container.replaceChildren(h("div", { class: "page organise" },
    h("div", { class: "organise-main" },
      h("section", { class: "panel" },
        h("div", { class: "toolbar" },
          h("h3", {}, `Weekly review · ${review.start} to ${review.end}`),
          h("span", { class: "spacer" }),
          h("span", { class: "muted small" }, "Ending"),
          h("input", { type: "date", "aria-label": "Review end date", value: state.end || review.end, onchange: (event: Event) => { state.end = (event.target as HTMLInputElement).value; void context.refresh(); } }),
          state.end ? h("button", { onclick: () => { state.end = ""; void context.refresh(); } }, "Today") : null),
        h("p", { class: "muted small" }, "The last 7 days, inclusive. Rolling, not a calendar week.")),
      h("section", { class: "panel" }, h("h3", {}, "Done"),
        block("Tasks", review.done.tasks.map((task) => line(task.title, `done ${task.done_at?.slice(0, 10) ?? ""}`, goToItem(task.id, "organise-tasks"))), "No tasks finished."),
        block("List items", review.done.listItems.map((row) => line(row.title, `${row.status ?? ""} · ${row.done_at?.slice(0, 10) ?? ""}`, goToItem(row.id, "organise-notes"))), "No list items finished."),
        block("Tracker entries", review.done.entries.map((entry) => line(`${entry.tracker}: ${entry.value}`, entry.date)), "No tracker entries.")),
      h("section", { class: "panel" }, h("h3", {}, "Slipped"),
        block("Tasks", review.slipped.tasks.map((task) => line(task.title, `was due ${task.date ?? ""}`, goToItem(task.id, "organise-tasks"))), "Nothing slipped."),
        block("Reminders", review.slipped.reminders.map((reminder) => line(reminder.title, reminder.date ?? "", goToItem(reminder.id, "organise-reminders"))), "No open reminders in the window.")),
      h("section", { class: "panel" }, h("h3", {}, "Trackers"),
        review.trackers.length ? h("div", { class: "item-list" }, ...review.trackers.map((tracker) => h("div", { class: "item-row" }, h("span", { class: "item-title" }, tracker.name), h("span", {}, tracker.summary))))
          : h("p", { class: "muted small" }, "No trackers.")))));
}
