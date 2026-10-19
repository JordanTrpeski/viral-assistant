// Reminders: Overdue / Upcoming / Done with category, recurrence and prepare-by; completing a recurring one schedules the next.
import type { ReminderGroups, ReminderView } from "../../organise/reminders.js";
import { api, save, type AppContext } from "../api.js";
import { h } from "../dom.js";
import { meta, patchItem, type OrganiseItem } from "./common.js";
import { openItem, renderDetail, selectedItemId } from "./detail.js";
import { emptyFilters, filterBar, filterQuery } from "./filters.js";

const filters = emptyFilters();
const draft = { title: "", date: "", category: "Other" };

function reminderRow(context: AppContext, reminder: ReminderView, projects: OrganiseItem[], selected: string | null): HTMLElement {
  const done = reminder.status === "done";
  const project = projects.find((candidate) => candidate.id === reminder.project_id);
  return h("div", { class: `task-row${reminder.id === selected ? " selected" : ""}${done ? " done" : ""}` },
    h("input", { type: "checkbox", checked: done, "aria-label": `${done ? "Reopen" : "Complete"} ${reminder.title}`, onchange: (event: Event) => patchItem(context, reminder.id, { status: (event.target as HTMLInputElement).checked ? "done" : "open" }) }),
    h("button", { class: "task-title", onclick: () => openItem(reminder.id) }, reminder.title),
    h("span", { class: `tag category-${(reminder.category ?? "Other").toLowerCase()}` }, reminder.category ?? "Other"),
    reminder.recurrence && reminder.recurrence !== "none" ? h("span", { class: "muted small", title: "Repeats" }, reminder.recurrence === "yearly" ? "↻ yearly" : `↻ every ${reminder.interval_days} days`) : null,
    project ? h("span", { class: "tag" }, project.title) : null,
    h("span", { class: "spacer" }),
    reminder.prepare_by && !done ? h("span", { class: "muted small" }, `prepare by ${reminder.prepare_by}`) : null,
    reminder.overdue ? h("span", { class: "overdue-flag" }, "overdue") : null,
    h("span", { class: "muted small" }, reminder.date ?? ""),
    done ? h("button", { onclick: () => patchItem(context, reminder.id, { status: "open" }) }, "Reopen") : null);
}

function group(context: AppContext, title: string, reminders: ReminderView[], projects: OrganiseItem[], selected: string | null): HTMLElement {
  return h("section", { class: "panel" }, h("h3", {}, `${title} · ${reminders.length}`),
    reminders.length ? h("div", { class: "item-list" }, ...reminders.map((reminder) => reminderRow(context, reminder, projects, selected))) : h("p", { class: "muted small" }, "Nothing here."));
}

export async function renderOrganiseReminders(container: HTMLElement, context: AppContext): Promise<void> {
  const [groups, items, vocab] = await Promise.all([api<ReminderGroups>("GET", `/api/organise/reminders${filterQuery(filters)}`), api<OrganiseItem[]>("GET", "/api/organise/items"), meta()]);
  const projects = items.filter((item) => item.type === "project");
  const selected = selectedItemId();
  if (!draft.date) draft.date = context.today;
  const add = (): Promise<void> => (draft.title.trim()
    ? save(context, async () => { await api("POST", "/api/organise/items", { type: "reminder", title: draft.title, date: draft.date, category: draft.category }); draft.title = ""; })
    : Promise.resolve());
  container.replaceChildren(h("div", { class: `page organise${selected ? " with-detail" : ""}` },
    h("div", { class: "organise-main" },
      h("section", { class: "panel" },
        h("div", { class: "inline-add" },
          h("input", { placeholder: "New reminder, e.g. Anna's birthday", maxlength: 200, value: draft.title, oninput: (event: Event) => { draft.title = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void add(); } }),
          h("input", { type: "date", "aria-label": "Date", value: draft.date, onchange: (event: Event) => { draft.date = (event.target as HTMLInputElement).value; } }),
          h("select", { "aria-label": "Category", value: draft.category, onchange: (event: Event) => { draft.category = (event.target as HTMLSelectElement).value; } }, ...vocab.reminderCategories.map((category) => h("option", { value: category }, category))),
          h("button", { class: "primary", onclick: add }, "Add")),
        h("p", { class: "muted small" }, "Personal reminders prepare 14 days ahead unless you change it. Completing a repeating reminder schedules the next one."),
        filterBar(context, filters, projects, ["open", "done"])),
      group(context, "Overdue", groups.overdue, projects, selected),
      group(context, "Upcoming", groups.upcoming, projects, selected),
      group(context, "Done", groups.done, projects, selected)),
    selected ? await renderDetail(context, selected, items) : null));
}
