// Notes and lists: notes with links to any item; lists with their own statuses (presets are just status names).
import type { OrganiseList } from "../../organise/service.js";
import { api, save, type AppContext } from "../api.js";
import { focusKey, h } from "../dom.js";
import { patchItem, statusLabel, type OrganiseItem } from "./common.js";
import { openItem, renderDetail, selectedItemId } from "./detail.js";
import { emptyFilters, filterBar, filterQuery } from "./filters.js";

const state: { tab: "notes" | "lists"; listId: string | null } = { tab: "notes", listId: null };
const noteDraft = { title: "", text: "" };
const listDraft = { name: "", preset: "default" };
let rowDraft = "";
const filters = emptyFilters();

function notesTab(context: AppContext, notes: OrganiseItem[], projects: OrganiseItem[], selected: string | null): HTMLElement[] {
  const add = (): Promise<void> => (noteDraft.title.trim() || noteDraft.text.trim()
    ? save(context, async () => {
      const note = await api<OrganiseItem>("POST", "/api/organise/items", { type: "note", ...(noteDraft.title.trim() ? { title: noteDraft.title } : {}), notes: noteDraft.text });
      noteDraft.title = ""; noteDraft.text = ""; openItem(note.id);
    })
    : Promise.resolve());
  return [
    h("section", { class: "panel" },
      h("div", { class: "note-compose" },
        h("input", { placeholder: "Title (optional)", maxlength: 200, value: noteDraft.title, oninput: (event: Event) => { noteDraft.title = (event.target as HTMLInputElement).value; } }),
        h("textarea", { class: "organise-textarea", rows: 3, maxlength: 5000, placeholder: "Write a note", value: noteDraft.text, oninput: (event: Event) => { noteDraft.text = (event.target as HTMLTextAreaElement).value; } }),
        h("button", { class: "primary", onclick: add }, "Add note")),
      filterBar(context, filters, projects, null)),
    h("section", { class: "panel" }, h("h3", {}, `Notes · ${notes.length}`),
      notes.length ? h("div", { class: "item-list" }, ...notes.map((note) => h("button", { class: `item-row${note.id === selected ? " selected" : ""}`, onclick: () => openItem(note.id) },
        h("span", { class: "item-title" }, note.title, note.notes && note.notes.split("\n")[0] !== note.title ? h("span", { class: "muted small" }, ` — ${note.notes.slice(0, 80)}`) : null),
        h("span", { class: "muted small" }, [note.date ?? "", note.links.length ? `${note.links.length} link${note.links.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")))))
        : h("p", { class: "muted small" }, "No notes yet."))
  ];
}

function listRows(context: AppContext, list: OrganiseList, rows: OrganiseItem[], selected: string | null): HTMLElement {
  const add = (): Promise<void> => (rowDraft.trim() ? save(context, async () => { await api("POST", "/api/organise/items", { type: "list_item", list_id: list.id, title: rowDraft }); rowDraft = ""; }) : Promise.resolve());
  return h("section", { class: "panel" },
    h("div", { class: "toolbar" },
      h("input", { ...focusKey(`list:${list.id}:name`), class: "template-name", value: list.name, maxlength: 100, onchange: (event: Event) => save(context, () => api("PATCH", `/api/organise/lists/${list.id}`, { name: (event.target as HTMLInputElement).value })) }),
      h("button", { class: "danger", onclick: () => save(context, async () => { await api("DELETE", `/api/organise/lists/${list.id}`); state.listId = null; }) }, "Delete list")),
    h("label", { class: "organise-field" }, h("span", {}, "Statuses"),
      h("input", { ...focusKey(`list:${list.id}:statuses`), value: list.statuses.join(", "), title: "Comma-separated, in order; the last one counts as done",
        onchange: (event: Event) => save(context, () => api("PATCH", `/api/organise/lists/${list.id}`, { statuses: (event.target as HTMLInputElement).value.split(",").map((part) => part.trim()).filter(Boolean) })) })),
    h("div", { class: "inline-add" },
      h("input", { ...focusKey(`list:${list.id}:new`), placeholder: "Add a row and press Enter", maxlength: 200, value: rowDraft, oninput: (event: Event) => { rowDraft = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void add(); } }),
      h("button", { onclick: add }, "Add")),
    rows.length ? h("table", { class: "grid-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Title"), h("th", {}, "Status"), h("th", {}, "Notes"), h("th", {}, "Done"), h("th", {}, ""))),
      h("tbody", {}, ...rows.map((row) => h("tr", { class: row.id === selected ? "editing" : "" },
        h("td", {}, h("input", { ...focusKey(`row:${row.id}:title`), value: row.title, maxlength: 200, onchange: (event: Event) => patchItem(context, row.id, { title: (event.target as HTMLInputElement).value }) })),
        h("td", {}, h("select", { ...focusKey(`row:${row.id}:status`), value: row.status ?? "", onchange: (event: Event) => patchItem(context, row.id, { status: (event.target as HTMLSelectElement).value }) },
          ...list.statuses.map((status) => h("option", { value: status }, statusLabel(status))))),
        h("td", {}, h("input", { ...focusKey(`row:${row.id}:notes`), value: row.notes, placeholder: "Notes", onchange: (event: Event) => patchItem(context, row.id, { notes: (event.target as HTMLInputElement).value }) })),
        h("td", { class: "muted small" }, row.done_at ? row.done_at.slice(0, 10) : ""),
        h("td", { class: "actions" }, h("button", { onclick: () => openItem(row.id) }, "Open"), h("button", { class: "danger", onclick: () => save(context, () => api("DELETE", `/api/organise/items/${row.id}`)) }, "Delete"))))))
      : h("p", { class: "muted small" }, "No rows yet."));
}

async function listsTab(context: AppContext, lists: OrganiseList[], rows: OrganiseItem[], selected: string | null): Promise<HTMLElement[]> {
  const presets = (await api<{ listPresets: Record<string, string[]> }>("GET", "/api/organise/meta")).listPresets;
  if (state.listId && !lists.some((list) => list.id === state.listId)) state.listId = null;
  state.listId ??= lists[0]?.id ?? null;
  const create = (): Promise<void> => (listDraft.name.trim()
    ? save(context, async () => { const list = await api<OrganiseList>("POST", "/api/organise/lists", { name: listDraft.name, preset: listDraft.preset }); listDraft.name = ""; state.listId = list.id; })
    : Promise.resolve());
  const current = lists.find((list) => list.id === state.listId);
  return [
    h("div", { class: "lists-layout" },
      h("section", { class: "panel" },
        h("h3", {}, `Lists · ${lists.length}`),
        h("div", { class: "item-list" }, ...lists.map((list) => h("button", { class: `item-row${list.id === state.listId ? " selected" : ""}`, onclick: () => { state.listId = list.id; void context.refresh(); } },
          h("span", { class: "item-title" }, list.name), h("span", { class: "muted small" }, String(rows.filter((row) => row.list_id === list.id).length))))),
        h("div", { class: "new-list" },
          h("input", { placeholder: "New list name", maxlength: 100, value: listDraft.name, oninput: (event: Event) => { listDraft.name = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void create(); } }),
          h("select", { "aria-label": "Preset", value: listDraft.preset, onchange: (event: Event) => { listDraft.preset = (event.target as HTMLSelectElement).value; } },
            ...Object.entries(presets).map(([key, statuses]) => h("option", { value: key }, `${key}: ${statuses.join(", ")}`))),
          h("button", { class: "primary", onclick: create }, "Create list"))),
      current ? listRows(context, current, rows.filter((row) => row.list_id === current.id), selected) : h("section", { class: "panel" }, h("p", { class: "muted" }, "Create a list to start.")))
  ];
}

export async function renderNotesAndLists(container: HTMLElement, context: AppContext): Promise<void> {
  const [notes, items, lists] = await Promise.all([
    api<OrganiseItem[]>("GET", `/api/organise/items${filterQuery(filters, { type: "note" })}`),
    api<OrganiseItem[]>("GET", "/api/organise/items"),
    api<OrganiseList[]>("GET", "/api/organise/lists")
  ]);
  const projects = items.filter((item) => item.type === "project");
  const selected = selectedItemId();
  const tabs = (["notes", "lists"] as const).map((tab) => h("button", { class: `tab${state.tab === tab ? " active" : ""}`, onclick: () => { state.tab = tab; void context.refresh(); } }, tab === "notes" ? "Notes" : "Lists"));
  const body = state.tab === "notes" ? notesTab(context, notes, projects, selected) : await listsTab(context, lists, items.filter((item) => item.type === "list_item"), selected);
  container.replaceChildren(h("div", { class: `page organise${selected ? " with-detail" : ""}` },
    h("div", { class: "organise-main" }, h("div", { class: "tabs" }, ...tabs), ...body),
    selected ? await renderDetail(context, selected, items) : null));
}
