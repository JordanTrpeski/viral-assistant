// Organise overview: inbox (with suggestions and the unsorted badge), Today strip, search, then the registered panels.
import type { SearchResult } from "../../organise/overview.js";
import type { OrganiseList } from "../../organise/service.js";
import type { AppContext } from "../api.js";
import { api } from "../api.js";
import { focusKey, h } from "../dom.js";
import { typeLabels, type ItemType, type OrganiseItem } from "./common.js";
import { openItem, renderDetail, selectedItemId } from "./detail.js";
import { renderInbox } from "./inbox.js";
import type { OverviewData } from "./panel-types.js";
import { overviewPanels } from "./panels.js";
import { suggestionChips, type InboxItem } from "./suggest.js";

const search = { q: "" };

function todayStrip(data: OverviewData): HTMLElement {
  const strip = data.today;
  const entries = [
    ...strip.tasks.map((task) => ({ item: task, label: task.title, detail: task.overdue ? `overdue · ${task.date}` : "due today", tone: task.overdue ? "overdue" : "", kind: "Task" })),
    ...strip.reminders.map((reminder) => ({ item: reminder, label: reminder.title, detail: reminder.overdue ? `overdue · ${reminder.date}` : "today", tone: reminder.overdue ? "overdue" : "", kind: "Reminder" })),
    ...strip.prepare.map((reminder) => ({ item: reminder, label: `Prepare: ${reminder.title}`, detail: `for ${reminder.date}`, tone: "", kind: "Prepare" }))
  ];
  return h("section", { class: "panel today-strip" },
    h("h3", {}, `Today · ${entries.length}`),
    entries.length ? h("div", { class: "today-items" }, ...entries.map((entry) => h("button", { class: `today-item ${entry.tone}`, onclick: () => openItem(entry.item.id) },
      h("span", { class: "tag" }, entry.kind), h("span", {}, entry.label), h("span", { class: "muted small" }, entry.detail))))
      : h("p", { class: "muted small" }, "Nothing due today."));
}

async function searchPanel(context: AppContext): Promise<HTMLElement> {
  const result = search.q.trim() ? await api<SearchResult>("GET", `/api/organise/search?q=${encodeURIComponent(search.q)}`) : null;
  return h("section", { class: "panel" },
    h("input", {
      ...focusKey("organise-search"), type: "search", class: "inbox-capture", placeholder: "Search titles, notes, checklists and project names", maxlength: 200, value: search.q,
      oninput: (event: Event) => { search.q = (event.target as HTMLInputElement).value; },
      onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void context.refresh(); },
      onsearch: () => { void context.refresh(); }
    }),
    result ? (result.total
      ? h("div", { class: "search-results" }, ...Object.entries(result.groups).map(([type, items]) => h("div", { class: "review-block" },
        h("h4", {}, `${typeLabels[type as ItemType]} · ${items!.length}`),
        h("div", { class: "item-list" }, ...items!.map((item) => h("button", { class: "item-row", onclick: () => openItem(item.id) }, h("span", { class: "item-title" }, item.title), h("span", { class: "muted small" }, item.date ?? "")))))))
      : h("p", { class: "muted small" }, `No matches for "${result.q}".`)) : null);
}

export async function renderOrganiseOverview(container: HTMLElement, context: AppContext): Promise<void> {
  const [items, lists, inboxView, data] = await Promise.all([
    api<OrganiseItem[]>("GET", "/api/organise/items"), api<OrganiseList[]>("GET", "/api/organise/lists"),
    api<{ items: InboxItem[] }>("GET", "/api/organise/inbox"), api<OverviewData>("GET", "/api/organise/overview")
  ]);
  const selected = selectedItemId();
  const inbox = await renderInbox(context, items, lists, (item) => suggestionChips(context, inboxView.items.find((candidate) => candidate.id === item.id)));
  container.replaceChildren(h("div", { class: `page organise${selected ? " with-detail" : ""}` },
    h("div", { class: "organise-main" },
      inbox,
      todayStrip(data),
      await searchPanel(context),
      h("div", { class: "overview-panels" }, ...overviewPanels.map((panel) => h("section", { class: "panel", dataset: { panel: panel.id } },
        h("div", { class: "panel-head" }, h("h3", {}, h("a", { href: `#/${panel.route}`, class: "panel-link" }, panel.title))),
        panel.render(data, context))))),
    selected ? await renderDetail(context, selected, items) : null));
}
