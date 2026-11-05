// Tasks: Today / This week / Later / Done, with checklist progress, priority, complete and reopen.
import type { TaskGroups, TaskView } from "../../organise/tasks.js";
import { api, save, type AppContext } from "../api.js";
import { h } from "../dom.js";
import { patchItem, statusLabel, type OrganiseItem } from "./common.js";
import { openItem, renderDetail, selectedItemId } from "./detail.js";
import { emptyFilters, filterBar, filterQuery } from "./filters.js";

const filters = emptyFilters();
let draft = "";

function taskRow(context: AppContext, task: TaskView, projects: OrganiseItem[], selected: string | null): HTMLElement {
  const done = task.status === "done";
  const project = projects.find((candidate) => candidate.id === task.project_id);
  return h("div", { class: `task-row${task.id === selected ? " selected" : ""}${done ? " done" : ""}` },
    h("input", {
      type: "checkbox", checked: done, "aria-label": `${done ? "Reopen" : "Complete"} ${task.title}`,
      onchange: (event: Event) => patchItem(context, task.id, { status: (event.target as HTMLInputElement).checked ? "done" : "open" })
    }),
    h("button", { class: "task-title", onclick: () => openItem(task.id) }, task.title),
    task.progress.total ? h("span", { class: "muted small", title: "Checklist" }, `${task.progress.done} of ${task.progress.total}`) : null,
    task.priority === "high" ? h("span", { class: "priority-high" }, "high") : task.priority === "low" ? h("span", { class: "muted small" }, "low") : null,
    project ? h("span", { class: "tag" }, project.title) : null,
    task.status === "in_progress" ? h("span", { class: "tag" }, statusLabel(task.status)) : null,
    h("span", { class: "spacer" }),
    task.overdue ? h("span", { class: "overdue-flag" }, "overdue") : null,
    h("span", { class: "muted small" }, done ? `done ${task.done_at?.slice(0, 10) ?? ""}` : task.date ?? ""),
    done ? h("button", { onclick: () => patchItem(context, task.id, { status: "open" }) }, "Reopen") : null);
}

function group(context: AppContext, title: string, tasks: TaskView[], projects: OrganiseItem[], selected: string | null): HTMLElement {
  return h("section", { class: "panel" },
    h("h3", {}, `${title} · ${tasks.length}`),
    tasks.length ? h("div", { class: "item-list" }, ...tasks.map((task) => taskRow(context, task, projects, selected))) : h("p", { class: "muted small" }, "Nothing here."));
}

export async function renderTasks(container: HTMLElement, context: AppContext): Promise<void> {
  const [groups, items] = await Promise.all([api<TaskGroups>("GET", `/api/organise/tasks${filterQuery(filters)}`), api<OrganiseItem[]>("GET", "/api/organise/items")]);
  const projects = items.filter((item) => item.type === "project");
  const selected = selectedItemId();
  const add = (): Promise<void> => (draft.trim() ? save(context, async () => { await api("POST", "/api/organise/items", { type: "task", title: draft }); draft = ""; }) : Promise.resolve());
  container.replaceChildren(h("div", { class: `page organise${selected ? " with-detail" : ""}` },
    h("div", { class: "organise-main" },
      h("section", { class: "panel" },
        h("div", { class: "inline-add" },
          h("input", { placeholder: "New task and press Enter", maxlength: 200, value: draft, oninput: (event: Event) => { draft = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void add(); } }),
          h("button", { class: "primary", onclick: add }, "Add")),
        filterBar(context, filters, projects, ["open", "in_progress", "done"], "Due")),
      group(context, "Today", groups.today, projects, selected),
      group(context, "This week", groups.thisWeek, projects, selected),
      group(context, "Later", groups.later, projects, selected),
      group(context, "Done", groups.done, projects, selected)),
    selected ? await renderDetail(context, selected, items) : null));
}
