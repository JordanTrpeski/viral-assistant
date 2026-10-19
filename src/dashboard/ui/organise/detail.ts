// Detail panel for any Organise item: live edits of the fields its type has, delete, and the Ask Viral slot.
import type { AppContext } from "../api.js";
import { api, save } from "../api.js";
import { focusKey, h } from "../dom.js";
import type { ChecklistEntry } from "../../organise/model.js";
import { dateField, field, meta, patchItem, selectField, statusLabel, textField, typeLabels, type OrganiseItem } from "./common.js";

/** Item ids are opened in the detail panel through `?item=<id>` on the hash, so any page can open any item. */
export function selectedItemId(): string | null {
  const match = /[?&]item=([0-9a-f-]{36})/.exec(location.hash);
  return match ? match[1]! : null;
}

export function openItem(id: string | null): void {
  const base = location.hash.replace(/[?&]item=[0-9a-f-]{36}/, "");
  location.hash = id ? `${base}${base.includes("?") ? "&" : "?"}item=${id}` : base;
}

/** Checklist entries live inside the task (not separate items); every change saves the whole list. */
function checklistEditor(id: string, entries: ChecklistEntry[], patch: (body: Record<string, unknown>) => Promise<void>): HTMLElement {
  // New entries are sent without an id; the server assigns one.
  const put = (next: (ChecklistEntry | { text: string; done: boolean })[]): Promise<void> => patch({ checklist: next });
  let draft = "";
  const add = (): Promise<void> => (draft.trim() ? put([...entries, { text: draft.trim(), done: false }]) : Promise.resolve());
  const done = entries.filter((entry) => entry.done).length;
  return h("div", { class: "checklist-editor" },
    entries.length ? h("div", { class: "muted small" }, `${done} of ${entries.length} done`) : null,
    ...entries.map((entry) => h("div", { class: "checklist-entry" },
      h("input", { type: "checkbox", checked: entry.done, "aria-label": `Done: ${entry.text}`, onchange: (event: Event) => put(entries.map((other) => (other.id === entry.id ? { ...other, done: (event.target as HTMLInputElement).checked } : other))) }),
      h("input", { ...focusKey(`d:${id}:cl:${entry.id}`), value: entry.text, maxlength: 200, onchange: (event: Event) => put(entries.map((other) => (other.id === entry.id ? { ...other, text: (event.target as HTMLInputElement).value } : other))) }),
      h("button", { "aria-label": `Remove ${entry.text}`, onclick: () => put(entries.filter((other) => other.id !== entry.id)) }, "✕"))),
    h("input", { ...focusKey(`d:${id}:cl:new`), placeholder: "Add a step and press Enter", maxlength: 200, oninput: (event: Event) => { draft = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void add(); } }));
}

export async function renderDetail(context: AppContext, id: string, items: OrganiseItem[]): Promise<HTMLElement> {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) return h("aside", { class: "panel organise-detail" }, h("p", { class: "muted small" }, "This item no longer exists."));
  const vocab = await meta();
  const patch = (body: Record<string, unknown>): Promise<void> => patchItem(context, item.id, body);
  const projects = items.filter((candidate) => candidate.type === "project" && candidate.id !== item.id);
  const statuses = item.type === "list_item" ? null : vocab.statuses[item.type] ?? null;
  const linkable = items.filter((candidate) => candidate.id !== item.id && !item.links.includes(candidate.id));
  const fields: (HTMLElement | null)[] = [
    field(item.type === "project" ? "Name" : "Title", textField(context, item.title, `d:${item.id}:title`, (value) => patch({ title: value ?? "" }), { maxlength: item.type === "project" ? 100 : 200 })),
    statuses ? field("Status", selectField(item.status, statuses.map((status) => ({ value: status, label: statusLabel(status) })), `d:${item.id}:status`, (value) => patch({ status: value }))) : null,
    item.type !== "project" && item.type !== "inbox" ? field(item.type === "task" ? "Due" : "Date", dateField(context, item.date, `d:${item.id}:date`, (value) => patch({ date: value }))) : null,
    item.type === "reminder" ? field("Prepare by", dateField(context, item.prepare_by, `d:${item.id}:prepare`, (value) => patch({ prepare_by: value }))) : null,
    item.type === "task" ? field("Priority", selectField(item.priority, vocab.priorities.map((value) => ({ value, label: value })), `d:${item.id}:priority`, (value) => patch({ priority: value }))) : null,
    item.type === "reminder" ? field("Category", selectField(item.category, vocab.reminderCategories.map((value) => ({ value, label: value })), `d:${item.id}:category`, (value) => patch({ category: value }))) : null,
    item.type === "reminder" ? field("Repeats", selectField(item.recurrence, vocab.recurrences.map((value) => ({ value, label: value })), `d:${item.id}:recurrence`, (value) => patch(value === "custom" ? { recurrence: value, interval_days: item.interval_days ?? 30 } : { recurrence: value, interval_days: null }))) : null,
    item.type === "reminder" && item.recurrence === "custom" ? field("Every (days)", h("input", { type: "number", min: 1, max: 365, value: item.interval_days ?? 30, onchange: (event: Event) => patch({ interval_days: Number((event.target as HTMLInputElement).value) }) })) : null,
    item.type !== "project" && item.type !== "inbox" ? field("Project", selectField(item.project_id, projects.map((project) => ({ value: project.id, label: project.title })), `d:${item.id}:project`, (value) => patch({ project_id: value }), true)) : null,
    item.type === "task" ? field("Checklist", checklistEditor(item.id, item.checklist ?? [], patch)) : null,
    field(item.type === "project" ? "Description" : "Notes", textField(context, item.notes, `d:${item.id}:notes`, (value) => patch({ notes: value ?? "" }), { multiline: true, maxlength: 5000 })),
    field("Links", h("div", { class: "links" },
      ...item.links.map((link) => {
        const target = items.find((candidate) => candidate.id === link);
        return h("span", { class: "link-chip" }, target ? `${typeLabels[target.type]}: ${target.title}` : link,
          h("button", { "aria-label": "Remove link", onclick: () => patch({ links: item.links.filter((other) => other !== link) }) }, "✕"));
      }),
      linkable.length ? selectField(null, linkable.map((candidate) => ({ value: candidate.id, label: `${typeLabels[candidate.type]}: ${candidate.title}` })), `d:${item.id}:addlink`, (value) => (value ? patch({ links: [...item.links, value] }) : Promise.resolve()), true) : null))
  ];
  return h("aside", { class: "panel organise-detail" },
    h("div", { class: "panel-head" },
      h("h3", {}, typeLabels[item.type]),
      h("div", {},
        h("button", { onclick: () => openItem(null) }, "Close"),
        h("button", { class: "danger", onclick: () => save(context, async () => { await api("DELETE", `/api/organise/items/${item.id}`); openItem(null); }) }, "Delete"))),
    ...fields,
    item.done_at ? h("p", { class: "muted small" }, `Done ${item.done_at.slice(0, 10)}`) : null,
    h("div", { class: "ask-viral", "aria-disabled": "true" }, "Ask Viral (connect a model later)"));
}
