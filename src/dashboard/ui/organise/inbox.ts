// Inbox: one input to capture; sort each item later into a task, reminder, note or list item.
import type { OrganiseList } from "../../organise/service.js";
import { api, save, type AppContext } from "../api.js";
import { focusKey, h } from "../dom.js";
import { meta, typeLabels, type OrganiseItem } from "./common.js";

type Target = "task" | "reminder" | "note" | "list_item";
const state: { capture: string; sortingId: string | null; target: Target; form: Record<string, unknown> } = { capture: "", sortingId: null, target: "task", form: {} };

/** Opens the sort form for an item, optionally pre-filled with a suggested type (used by auto-suggest). */
export function startSort(item: OrganiseItem, target: Target, today: string): void {
  state.sortingId = item.id;
  state.target = target;
  state.form = defaults(item, target, today);
}

function defaults(item: OrganiseItem, target: Target, today: string): Record<string, unknown> {
  switch (target) {
    case "task": return { title: item.title, date: "", priority: "normal", project_id: "", checklist: "" };
    case "reminder": return { title: item.title, date: today, category: "Other", project_id: "", recurrence: "none", interval_days: 30, prepare_by: "", notes: "" };
    case "note": return { text: item.title, project_id: "", date: "", link: "" };
    case "list_item": return { list_id: "", status: "", notes: "" };
  }
}

/** Turns the form into the sort request: empty optional fields are left out, the checklist is one entry per line. */
function payload(target: Target, form: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { type: target };
  for (const [key, value] of Object.entries(form)) {
    if (value === "" || value === undefined) continue;
    if (key === "checklist") body.checklist = String(value).split("\n").map((line) => line.trim()).filter(Boolean).map((text) => ({ text }));
    else if (key === "interval_days") { if (form.recurrence === "custom") body.interval_days = Number(value); }
    else body[key] = value;
  }
  return body;
}

function input(key: string, type = "text", placeholder = ""): HTMLElement {
  return h("input", { type, placeholder, value: String(state.form[key] ?? ""), oninput: (event: Event) => { state.form[key] = (event.target as HTMLInputElement).value; } });
}

function select(key: string, options: { value: string; label: string }[], none?: string, onChange?: () => void): HTMLElement {
  return h("select", { value: String(state.form[key] ?? ""), onchange: (event: Event) => { state.form[key] = (event.target as HTMLSelectElement).value; onChange?.(); } },
    none !== undefined ? h("option", { value: "" }, none) : null,
    ...options.map((option) => h("option", { value: option.value }, option.label)));
}

function row(label: string, control: HTMLElement): HTMLElement {
  return h("label", { class: "organise-field" }, h("span", {}, label), control);
}

async function sortForm(context: AppContext, item: OrganiseItem, all: OrganiseItem[], lists: OrganiseList[]): Promise<HTMLElement> {
  const vocab = await meta();
  const projects = all.filter((candidate) => candidate.type === "project").map((project) => ({ value: project.id, label: project.title }));
  const others = all.filter((candidate) => candidate.type !== "inbox" && candidate.id !== item.id).map((candidate) => ({ value: candidate.id, label: `${typeLabels[candidate.type]}: ${candidate.title}` }));
  const opt = (values: readonly string[]): { value: string; label: string }[] => values.map((value) => ({ value, label: value.replace("_", " ") }));
  const rerender = (): void => { void context.refresh(); };
  const fields: HTMLElement[] = [];
  if (state.target === "task") {
    fields.push(row("Title", input("title")), row("Due", input("date", "date")), row("Priority", select("priority", opt(vocab.priorities))), row("Project", select("project_id", projects, "None")),
      row("Checklist", h("textarea", { class: "organise-textarea", rows: 3, placeholder: "One step per line", value: String(state.form.checklist ?? ""), oninput: (event: Event) => { state.form.checklist = (event.target as HTMLTextAreaElement).value; } })));
  } else if (state.target === "reminder") {
    fields.push(row("Title", input("title")), row("Date", input("date", "date")), row("Category", select("category", opt(vocab.reminderCategories))), row("Project", select("project_id", projects, "None")),
      row("Repeats", select("recurrence", opt(vocab.recurrences), undefined, rerender)));
    if (state.form.recurrence === "custom") fields.push(row("Every (days)", input("interval_days", "number")));
    fields.push(row("Prepare by", input("prepare_by", "date")),
      row("Notes", h("textarea", { class: "organise-textarea", rows: 2, value: String(state.form.notes ?? ""), oninput: (event: Event) => { state.form.notes = (event.target as HTMLTextAreaElement).value; } })));
  } else if (state.target === "note") {
    fields.push(row("Text", h("textarea", { class: "organise-textarea", rows: 3, value: String(state.form.text ?? ""), oninput: (event: Event) => { state.form.text = (event.target as HTMLTextAreaElement).value; } })),
      row("Project", select("project_id", projects, "None")), row("Date", input("date", "date")), row("Link", select("link", others, "None")));
  } else {
    const list = lists.find((candidate) => candidate.id === state.form.list_id);
    fields.push(lists.length
      ? row("List", select("list_id", lists.map((candidate) => ({ value: candidate.id, label: candidate.name })), "Choose a list", () => { state.form.status = ""; rerender(); }))
      : h("p", { class: "muted small" }, "No lists yet. Create one under Notes and lists first."));
    if (list) fields.push(row("Status", select("status", opt(list.statuses))));
    fields.push(row("Notes", h("textarea", { class: "organise-textarea", rows: 2, value: String(state.form.notes ?? ""), oninput: (event: Event) => { state.form.notes = (event.target as HTMLTextAreaElement).value; } })));
  }
  const targets: Target[] = ["task", "reminder", "note", "list_item"];
  return h("div", { class: "sort-form" },
    h("div", { class: "chip-group" }, ...targets.map((target) => h("button", {
      class: `chip${state.target === target ? " active" : ""}`, onclick: () => { startSort(item, target, context.today); rerender(); }
    }, typeLabels[target]))),
    ...fields,
    h("div", { class: "toolbar" },
      h("button", { class: "primary", onclick: () => save(context, async () => { await api("POST", `/api/organise/inbox/${item.id}/sort`, payload(state.target, state.form)); state.sortingId = null; }) }, "Save"),
      h("button", { onclick: () => { state.sortingId = null; rerender(); } }, "Cancel")));
}

/** Extra controls an inbox row may show (auto-suggest chips arrive in a later step). */
export type InboxRowExtras = (item: OrganiseItem) => HTMLElement | null;

export async function renderInbox(context: AppContext, items: OrganiseItem[], lists: OrganiseList[], extras: InboxRowExtras = () => null): Promise<HTMLElement> {
  const inbox = items.filter((item) => item.type === "inbox");
  const capture = (): Promise<void> => {
    const text = state.capture.trim();
    if (!text) return Promise.resolve();
    return save(context, async () => { await api("POST", "/api/organise/inbox", { text }); state.capture = ""; });
  };
  const rows = await Promise.all(inbox.map(async (item) => h("li", { class: "inbox-row" },
    h("div", { class: "inbox-line" },
      h("span", { class: "item-title" }, item.title),
      extras(item),
      h("span", { class: "spacer" }),
      h("button", { onclick: () => { startSort(item, "task", context.today); void context.refresh(); } }, "Sort"),
      h("button", { class: "danger", onclick: () => save(context, () => api("DELETE", `/api/organise/items/${item.id}`)) }, "Delete")),
    state.sortingId === item.id ? await sortForm(context, item, items, lists) : null)));
  return h("section", { class: "panel inbox" },
    h("div", { class: "panel-head" }, h("h3", {}, "Inbox"), h("span", { class: "nav-badge", title: "Unsorted items" }, String(inbox.length))),
    h("input", {
      ...focusKey("inbox-capture"), class: "inbox-capture", placeholder: "Capture anything and press Enter", maxlength: 200, value: state.capture,
      oninput: (event: Event) => { state.capture = (event.target as HTMLInputElement).value; },
      onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void capture(); }
    }),
    inbox.length ? h("ul", { class: "inbox-list" }, ...rows) : h("p", { class: "muted small" }, "Inbox is empty."));
}
