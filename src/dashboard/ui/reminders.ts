// Reminders module: add, edit (inline, live), tick done and delete; prepare-by shown alongside.
import type { ReminderPanelItem } from "../overview.js";
import type { Reminder } from "../reminders.js";
import { colourCategories, colourInfo, type ColourCategory } from "../shared/colours.js";
import { addDays } from "../shared/dates.js";
import { api, save, type AppContext } from "./api.js";
import { focusKey, h } from "./dom.js";

type Filter = "open" | "done" | "all";
const state: { filter: Filter } = { filter: "open" };

function categorySelect(value: ColourCategory, onChange: (category: ColourCategory) => void, key?: string): HTMLSelectElement {
  return h("select", { ...(key ? focusKey(key) : {}), class: `category-select entry-${value}`, value, onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value as ColourCategory) },
    ...colourCategories.map((category) => h("option", { value: category }, colourInfo[category].label)));
}

function row(context: AppContext, reminder: Reminder): HTMLElement {
  const patch = (body: Record<string, unknown>): Promise<void> => save(context, () => api("PATCH", `/api/reminders/${reminder.id}`, body));
  const overdue = !reminder.done && reminder.date < context.today;
  return h("tr", { class: reminder.done ? "done-row" : "" },
    h("td", {}, h("input", { type: "checkbox", checked: reminder.done, "aria-label": `Done: ${reminder.title}`, onchange: (event: Event) => patch({ done: (event.target as HTMLInputElement).checked }) })),
    h("td", {}, h("input", { ...focusKey(`${reminder.id}:title`), value: reminder.title, onchange: (event: Event) => patch({ title: (event.target as HTMLInputElement).value }) })),
    h("td", { class: overdue ? "overdue-cell" : "" }, h("input", { ...focusKey(`${reminder.id}:date`), type: "date", value: reminder.date, onchange: (event: Event) => patch({ date: (event.target as HTMLInputElement).value }) })),
    h("td", {}, categorySelect(reminder.category, (category) => patch({ category }), `${reminder.id}:category`)),
    h("td", {}, h("div", { class: "prepare-cell" },
      h("input", { ...focusKey(`${reminder.id}:prepare`), type: "date", value: reminder.prepareBy ?? "", max: reminder.date, onchange: (event: Event) => patch({ prepareBy: (event.target as HTMLInputElement).value || null }) }),
      reminder.prepareBy ? h("button", { title: "Remove prepare-by", "aria-label": "Remove prepare-by", onclick: () => patch({ prepareBy: null }) }, "✕") : null)),
    h("td", { class: "actions" }, h("button", { class: "danger", onclick: () => save(context, () => api("DELETE", `/api/reminders/${reminder.id}`)) }, "Delete")));
}

function addRow(context: AppContext): HTMLElement {
  const draft: { title: string; date: string; category: ColourCategory; prepareBy: string } = { title: "", date: addDays(context.today, 1), category: "reminder", prepareBy: "" };
  const add = (): Promise<void> => {
    if (!draft.title.trim()) {
      context.notify("Give the reminder a title");
      return Promise.resolve();
    }
    return save(context, () => api("POST", "/api/reminders", { title: draft.title, date: draft.date, category: draft.category, ...(draft.prepareBy ? { prepareBy: draft.prepareBy } : {}) }));
  };
  return h("tr", { class: "adding" },
    h("td", {}),
    h("td", {}, h("input", { ...focusKey("new-reminder"), placeholder: "New reminder, e.g. Anna's birthday", oninput: (event: Event) => { draft.title = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void add(); } })),
    h("td", {}, h("input", { type: "date", value: draft.date, onchange: (event: Event) => { draft.date = (event.target as HTMLInputElement).value; } })),
    h("td", {}, categorySelect(draft.category, (category) => { draft.category = category; })),
    h("td", {}, h("input", { type: "date", title: "Optional. Personal dates default to 14 days before.", onchange: (event: Event) => { draft.prepareBy = (event.target as HTMLInputElement).value; } })),
    h("td", { class: "actions" }, h("button", { class: "primary", onclick: add }, "Add")));
}

export async function renderReminders(container: HTMLElement, context: AppContext): Promise<void> {
  const [reminders, overview] = await Promise.all([
    api<Reminder[]>("GET", `/api/reminders?status=${state.filter}`),
    api<{ reminders: ReminderPanelItem[] }>("GET", "/api/overview")
  ]);
  const filters = (["open", "done", "all"] as const).map((filter) =>
    h("button", { class: `chip${state.filter === filter ? " active" : ""}`, onclick: () => { state.filter = filter; void context.refresh(); } }, filter === "open" ? "Open" : filter === "done" ? "Done" : "All"));
  container.replaceChildren(h("div", { class: "page reminders" },
    h("div", { class: "with-side" },
      h("section", { class: "panel" },
        h("div", { class: "toolbar" }, ...filters, h("span", { class: "spacer" }), h("span", { class: "muted small" }, "Personal dates get a prepare-by 14 days before unless you set one.")),
        h("table", { class: "grid-table" },
          h("thead", {}, h("tr", {}, ...["Done", "Title", "Date", "Category", "Prepare by", "Actions"].map((label) => h("th", {}, label)))),
          h("tbody", {}, addRow(context), ...reminders.map((reminder) => row(context, reminder)),
            reminders.length ? null : h("tr", {}, h("td", { colspan: 6, class: "empty" }, state.filter === "done" ? "Nothing done yet." : "No reminders here."))))),
      h("aside", { class: "panel side-column" },
        h("h3", {}, "Coming up (30 days)"),
        overview.reminders.length ? null : h("p", { class: "muted small" }, "Nothing open in the next 30 days."),
        ...overview.reminders.map((item) => h("div", { class: `upcoming${item.overdue ? " overdue" : ""}` },
          h("span", { class: "timeline-date" }, item.date),
          h("span", { class: `entry entry-${item.colour}` }, item.label)))))));
}
