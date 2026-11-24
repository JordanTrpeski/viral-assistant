// Organise Deadlines (renamed from Tasks in phase 5b; stored kind stays "task"): list, add and complete
// deadlines. Fields: title, category (optional), one due date, an optional time, priority, recurrence. A
// deadline with a time is timed; without a time it is all-day on its due date. Deadlines push to Google.
import { api, save, type AppContext } from "./api.js";
import { h } from "./dom.js";
import { loadCategories } from "./cal-common.js";

interface Deadline {
  id: string; title: string; date: string; dueDate: string | null; time: string | null; allDay: boolean;
  priority: "low" | "normal" | "high"; status: "open" | "done"; categoryId: string | null;
  recurrence: { freq: string } | null;
}

export async function renderCalendarTasks(container: HTMLElement, context: AppContext): Promise<void> {
  const [deadlines, categories] = await Promise.all([
    api<Deadline[]>("GET", "/api/calendar/items?kind=task"),
    loadCategories()
  ]);

  const title = h("input", { type: "text", placeholder: "New deadline", class: "grow" });
  const category = h("select", {}, h("option", { value: "" }, "No category"), ...categories.map((cat) => h("option", { value: cat.id }, cat.name)));
  const due = h("input", { type: "date", title: "Due date" });
  const time = h("input", { type: "time", title: "Time (leave empty for all-day)" });
  const priority = h("select", {}, ...["low", "normal", "high"].map((value) => h("option", { value }, value)));
  (priority as HTMLSelectElement).value = "normal";
  const recurrence = h("select", {}, ...["none", "weekly", "monthly", "yearly"].map((value) => h("option", { value }, value)));

  const add = async (): Promise<void> => {
    const text = (title as HTMLInputElement).value.trim();
    const day = (due as HTMLInputElement).value;
    if (text === "" || day === "") { context.notify("A deadline needs a title and a due date."); return; }
    const timeValue = (time as HTMLInputElement).value;
    const freq = (recurrence as HTMLSelectElement).value;
    await save(context, () => api("POST", "/api/calendar/items", {
      kind: "task", title: text, date: day, dueDate: day,
      categoryId: (category as HTMLSelectElement).value || null,
      allDay: timeValue === "", time: timeValue === "" ? null : timeValue,
      priority: (priority as HTMLSelectElement).value,
      recurrence: freq === "none" ? null : { freq }
    }));
  };

  const open = deadlines.filter((deadline) => deadline.status === "open");
  const done = deadlines.filter((deadline) => deadline.status === "done");

  const row = (deadline: Deadline): HTMLElement => h("div", { class: `cal-row item${deadline.status === "done" ? " done" : ""}` },
    h("button", { class: "check", title: "Complete", disabled: deadline.status === "done", onclick: () => save(context, () => api("POST", `/api/calendar/items/${deadline.id}/complete`)) }, deadline.status === "done" ? "✓" : "○"),
    h("span", { class: "cal-title" }, deadline.title),
    h("span", { class: "cal-when" }, `due ${deadline.dueDate ?? deadline.date}${deadline.allDay ? "" : ` ${deadline.time ?? ""}`}`),
    h("span", { class: `pri ${deadline.priority}` }, deadline.priority),
    deadline.recurrence ? h("span", { class: "cal-tag" }, deadline.recurrence.freq) : h("span", {}),
    deadline.categoryId ? h("span", { class: "cal-cat" }, categories.find((category) => category.id === deadline.categoryId)?.name ?? "") : h("span", {}));

  container.replaceChildren(h("div", { class: "page cal-tasks" },
    h("h2", {}, "Deadlines"),
    h("div", { class: "panel addbar" }, title, category, due, time, priority, recurrence, h("button", { class: "primary", onclick: add }, "Add")),
    h("div", { class: "panel" }, h("h3", {}, `Open (${open.length})`), ...(open.length ? open.map(row) : [h("p", { class: "muted small" }, "No open deadlines.")])),
    done.length ? h("div", { class: "panel" }, h("h3", {}, `Done (${done.length})`), ...done.map(row)) : h("div", {})));
}
