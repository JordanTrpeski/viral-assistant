// Organise Tasks (phase 4): list, add and complete tasks. Fields: title, category (optional), due date,
// planned date, priority, recurrence. No writes to Google.
import { api, save, type AppContext } from "./api.js";
import { h } from "./dom.js";
import { loadCategories } from "./cal-common.js";

interface Task {
  id: string; title: string; date: string; dueDate: string | null; plannedDate: string | null;
  priority: "low" | "normal" | "high"; status: "open" | "done"; categoryId: string | null;
  recurrence: { freq: string } | null;
}

export async function renderCalendarTasks(container: HTMLElement, context: AppContext): Promise<void> {
  const [tasks, categories] = await Promise.all([
    api<Task[]>("GET", "/api/calendar/items?kind=task"),
    loadCategories()
  ]);

  const title = h("input", { type: "text", placeholder: "New task", class: "grow" });
  const category = h("select", {}, h("option", { value: "" }, "No category"), ...categories.map((cat) => h("option", { value: cat.id }, cat.name)));
  const due = h("input", { type: "date", title: "Due date" });
  const planned = h("input", { type: "date", title: "Planned day" });
  const priority = h("select", {}, ...["low", "normal", "high"].map((value) => h("option", { value }, value)));
  (priority as HTMLSelectElement).value = "normal";
  const recurrence = h("select", {}, ...["none", "weekly", "monthly", "yearly"].map((value) => h("option", { value }, value)));

  const add = async (): Promise<void> => {
    const text = (title as HTMLInputElement).value.trim();
    if (text === "") return;
    const dueValue = (due as HTMLInputElement).value || null;
    const plannedValue = (planned as HTMLInputElement).value || null;
    const date = plannedValue ?? dueValue ?? context.today;
    const freq = (recurrence as HTMLSelectElement).value;
    await save(context, () => api("POST", "/api/calendar/items", {
      kind: "task", title: text, date,
      categoryId: (category as HTMLSelectElement).value || null,
      dueDate: dueValue, plannedDate: plannedValue,
      priority: (priority as HTMLSelectElement).value,
      recurrence: freq === "none" ? null : { freq }
    }));
  };

  const open = tasks.filter((task) => task.status === "open");
  const done = tasks.filter((task) => task.status === "done");

  const row = (task: Task): HTMLElement => h("div", { class: `cal-row item${task.status === "done" ? " done" : ""}` },
    h("button", { class: "check", title: "Complete", disabled: task.status === "done", onclick: () => save(context, () => api("POST", `/api/calendar/items/${task.id}/complete`)) }, task.status === "done" ? "✓" : "○"),
    h("span", { class: "cal-title" }, task.title),
    h("span", { class: "cal-when" }, task.dueDate ? `due ${task.dueDate}` : task.plannedDate ? `plan ${task.plannedDate}` : task.date),
    h("span", { class: `pri ${task.priority}` }, task.priority),
    task.recurrence ? h("span", { class: "cal-tag" }, task.recurrence.freq) : h("span", {}),
    task.categoryId ? h("span", { class: "cal-cat" }, categories.find((category) => category.id === task.categoryId)?.name ?? "") : h("span", {}));

  container.replaceChildren(h("div", { class: "page cal-tasks" },
    h("h2", {}, "Tasks"),
    h("div", { class: "panel addbar" }, title, category, due, planned, priority, recurrence, h("button", { class: "primary", onclick: add }, "Add")),
    h("div", { class: "panel" }, h("h3", {}, `Open (${open.length})`), ...(open.length ? open.map(row) : [h("p", { class: "muted small" }, "No open tasks.")])),
    done.length ? h("div", { class: "panel" }, h("h3", {}, `Done (${done.length})`), ...done.map(row)) : h("div", {})));
}
