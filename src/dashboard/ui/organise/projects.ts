// Projects: the list, and each project's page with sections (Tasks, Reminders, Notes, Trackers, Lists), open items first.
import type { ProjectPage } from "../../organise/projects.js";
import { api, save, type AppContext } from "../api.js";
import { focusKey, h } from "../dom.js";
import { patchItem, statusLabel, type OrganiseItem } from "./common.js";
import { openItem, renderDetail, selectedItemId } from "./detail.js";

let draft = "";
const statusFilter = { value: "" };

function selectedProjectId(): string | null {
  const match = /[?&]project=([0-9a-f-]{36})/.exec(location.hash);
  return match ? match[1]! : null;
}

function itemLine(item: OrganiseItem, open: boolean): HTMLElement {
  return h("button", { class: `item-row${open ? "" : " done-item"}`, onclick: () => openItem(item.id) },
    h("span", { class: "item-title" }, item.title),
    h("span", { class: "muted small" }, [statusLabel(item.status), item.date ?? ""].filter(Boolean).join(" · ")));
}

function section(title: string, body: HTMLElement[], empty: string): HTMLElement {
  return h("section", { class: "panel" }, h("h3", {}, `${title} · ${body.length}`), body.length ? h("div", { class: "item-list" }, ...body) : h("p", { class: "muted small" }, empty));
}

async function projectView(context: AppContext, id: string, items: OrganiseItem[]): Promise<HTMLElement> {
  const page = await api<ProjectPage>("GET", `/api/organise/projects/${id}`);
  const project = page.project;
  const patch = (body: Record<string, unknown>): Promise<void> => patchItem(context, project.id, body);
  const selected = selectedItemId();
  const { tasks, reminders, notes, trackers, lists } = page.sections;
  return h("div", { class: `page organise${selected ? " with-detail" : ""}` },
    h("div", { class: "organise-main" },
      h("section", { class: "panel project-head" },
        h("a", { href: "#/organise-projects", class: "small" }, "← All projects"),
        h("input", { ...focusKey(`p:${project.id}:name`), class: "project-name", maxlength: 100, value: project.title, onchange: (event: Event) => patch({ title: (event.target as HTMLInputElement).value }) }),
        h("div", { class: "toolbar" },
          h("select", { ...focusKey(`p:${project.id}:status`), value: project.status ?? "active", onchange: (event: Event) => patch({ status: (event.target as HTMLSelectElement).value }) },
            ...["active", "paused", "done"].map((status) => h("option", { value: status }, status))),
          h("span", { class: "muted small" }, `${page.counts.open} open of ${page.counts.total}`),
          h("span", { class: "spacer" }),
          h("button", { class: "danger", onclick: () => save(context, async () => { await api("DELETE", `/api/organise/items/${project.id}`); context.navigate("organise-projects"); }) }, "Delete project")),
        h("textarea", { ...focusKey(`p:${project.id}:notes`), class: "organise-textarea", rows: 2, maxlength: 5000, placeholder: "Description", value: project.notes, onchange: (event: Event) => patch({ notes: (event.target as HTMLTextAreaElement).value }) })),
      section("Tasks", tasks.map((task) => itemLine(task, task.done_at === null)), "No tasks in this project."),
      section("Reminders", reminders.map((reminder) => itemLine(reminder, reminder.done_at === null)), "No reminders in this project."),
      section("Notes", notes.map((note) => itemLine(note, true)), "No notes in this project."),
      section("Trackers", trackers.map((tracker) => h("a", { class: "item-row", href: `#/organise-trackers?tracker=${tracker.id}` }, h("span", { class: "item-title" }, tracker.name))), "No trackers in this project."),
      section("Lists", lists.flatMap((entry) => entry.rows.map((row) => itemLine({ ...row, title: `${entry.list.name}: ${row.title}` }, row.status !== entry.list.statuses.at(-1)))), "No list rows in this project.")),
    selected ? await renderDetail(context, selected, items) : null);
}

export async function renderProjects(container: HTMLElement, context: AppContext): Promise<void> {
  const items = await api<OrganiseItem[]>("GET", "/api/organise/items");
  const id = selectedProjectId();
  if (id && items.some((item) => item.id === id && item.type === "project")) {
    container.replaceChildren(await projectView(context, id, items));
    return;
  }
  const projects = items.filter((item) => item.type === "project" && (!statusFilter.value || item.status === statusFilter.value));
  const add = (): Promise<void> => (draft.trim() ? save(context, async () => { await api("POST", "/api/organise/items", { type: "project", title: draft }); draft = ""; }) : Promise.resolve());
  const count = (project: OrganiseItem): number => items.filter((item) => item.project_id === project.id && item.done_at === null && item.type !== "note").length;
  container.replaceChildren(h("div", { class: "page organise" },
    h("div", { class: "organise-main" },
      h("section", { class: "panel" },
        h("div", { class: "inline-add" },
          h("input", { placeholder: "New project name", maxlength: 100, value: draft, oninput: (event: Event) => { draft = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void add(); } }),
          h("button", { class: "primary", onclick: add }, "Add")),
        h("div", { class: "chip-group" }, ...["", "active", "paused", "done"].map((status) => h("button", { class: `chip${statusFilter.value === status ? " active" : ""}`, onclick: () => { statusFilter.value = status; void context.refresh(); } }, status || "All")))),
      h("section", { class: "panel" }, h("h3", {}, `Projects · ${projects.length}`),
        projects.length ? h("div", { class: "item-list" }, ...projects.map((project) => h("a", { class: "item-row", href: `#/organise-projects?project=${project.id}` },
          h("span", { class: "item-title" }, project.title), h("span", { class: "muted small" }, `${project.status} · ${count(project)} open`))))
          : h("p", { class: "muted small" }, "No projects yet.")))));
}
