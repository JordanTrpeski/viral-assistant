// Organise overview: inbox at the top, then every item by type with a quick-create row and the detail panel.
import type { AppContext } from "../api.js";
import { api, save } from "../api.js";
import { h } from "../dom.js";
import { meta, statusLabel, typeLabels, type ItemType, type OrganiseItem } from "./common.js";
import type { OrganiseList } from "../../organise/service.js";
import { openItem, renderDetail, selectedItemId } from "./detail.js";
import { renderInbox } from "./inbox.js";

const draft: { type: ItemType; title: string } = { type: "task", title: "" };

function itemRow(item: OrganiseItem, selected: string | null): HTMLElement {
  const detail = [statusLabel(item.status), item.date ?? ""].filter(Boolean).join(" · ");
  return h("button", { class: `item-row${item.id === selected ? " selected" : ""}`, onclick: () => openItem(item.id) },
    h("span", { class: "item-title" }, item.title),
    h("span", { class: "muted small" }, detail));
}

export async function renderOrganiseOverview(container: HTMLElement, context: AppContext): Promise<void> {
  const [items, lists, vocab] = await Promise.all([api<OrganiseItem[]>("GET", "/api/organise/items"), api<OrganiseList[]>("GET", "/api/organise/lists"), meta()]);
  const selected = selectedItemId();
  const create = (): Promise<void> => (draft.title.trim()
    ? save(context, async () => { const item = await api<OrganiseItem>("POST", "/api/organise/items", { type: draft.type, title: draft.title, ...(draft.type === "reminder" ? { date: context.today } : {}) }); draft.title = ""; openItem(item.id); })
    : Promise.resolve());
  const inbox = await renderInbox(context, items, lists);
  const groups = vocab.types.filter((type) => type !== "inbox").map((type) => ({ type, items: items.filter((item) => item.type === type) })).filter((group) => group.items.length);
  container.replaceChildren(h("div", { class: `page organise${selected ? " with-detail" : ""}` },
    h("div", { class: "organise-main" },
      inbox,
      h("a", { class: "panel review-link", href: "#/organise-review" }, "Weekly review — the last 7 days →"),
      h("section", { class: "panel" },
        h("div", { class: "inline-add" },
          h("select", { value: draft.type, onchange: (event: Event) => { draft.type = (event.target as HTMLSelectElement).value as ItemType; } },
            ...vocab.types.filter((type) => type !== "inbox" && type !== "list_item").map((type) => h("option", { value: type }, typeLabels[type]))),
          h("input", { placeholder: "New item title", oninput: (event: Event) => { draft.title = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void create(); } }),
          h("button", { class: "primary", onclick: create }, "Add"))),
      ...groups.map((group) => h("section", { class: "panel" },
        h("h3", {}, `${typeLabels[group.type]}s · ${group.items.length}`),
        h("div", { class: "item-list" }, ...group.items.map((item) => itemRow(item, selected))))),
      items.length ? null : h("p", { class: "muted" }, "Nothing here yet. Add an item above.")),
    selected ? await renderDetail(context, selected, items) : null));
}
