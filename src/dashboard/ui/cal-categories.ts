// Organise Categories (phase 7): create, rename and delete categories and subcategories, edit default lead
// times, and move items before deleting a category/subcategory that still has items. No writes to Google.
import { api, save, type AppContext } from "./api.js";
import { h } from "./dom.js";

interface Sub { id: string; name: string; itemCount: number; }
interface Cat { id: string; name: string; colour: string | null; defaultLeadTimes: number[]; itemCount: number; subcategories: Sub[]; }

type Pending = { kind: "category"; catId: string } | { kind: "subcategory"; catId: string; subId: string } | null;

function targetOptions(cats: Cat[], exclude: Pending): { label: string; value: string }[] {
  const out = [{ label: "Unfiled (no category)", value: "|" }];
  for (const cat of cats) {
    if (exclude?.kind === "category" && exclude.catId === cat.id) continue; // can't move into the category being deleted
    out.push({ label: `${cat.name} — no subcategory`, value: `${cat.id}|` });
    for (const sub of cat.subcategories) {
      if (exclude?.kind === "subcategory" && exclude.catId === cat.id && exclude.subId === sub.id) continue;
      out.push({ label: `${cat.name} › ${sub.name}`, value: `${cat.id}|${sub.id}` });
    }
  }
  return out;
}

function parseTarget(value: string): { categoryId: string | null; subcategoryId: string | null } {
  const [cat, sub] = value.split("|");
  return { categoryId: cat ? cat : null, subcategoryId: sub ? sub : null };
}

export async function renderCalendarCategories(container: HTMLElement, context: AppContext): Promise<void> {
  let pending: Pending = null;

  const draw = async (): Promise<void> => {
    const cats = await api<Cat[]>("GET", "/api/calendar/categories");
    const children: HTMLElement[] = [h("h2", {}, "Categories")];

    // Move-before-delete dialog.
    if (pending) {
      const subject = pending.kind === "category"
        ? cats.find((cat) => cat.id === pending!.catId)?.name ?? "category"
        : `${cats.find((cat) => cat.id === pending!.catId)?.name ?? ""} › ${cats.find((cat) => cat.id === pending!.catId)?.subcategories.find((sub) => sub.id === (pending as { subId: string }).subId)?.name ?? ""}`;
      const select = h("select", {}, ...targetOptions(cats, pending).map((option) => h("option", { value: option.value }, option.label)));
      const confirm = h("button", { class: "primary", onclick: async () => {
        const move = parseTarget((select as HTMLSelectElement).value);
        const url = pending!.kind === "category" ? `/api/calendar/categories/${pending!.catId}` : `/api/calendar/categories/${pending!.catId}/subcategories/${(pending as { subId: string }).subId}`;
        try { await api("DELETE", url, { move }); context.notify("Items moved and deleted."); pending = null; await draw(); }
        catch (error) { context.notify((error as Error).message); }
      } }, "Move items and delete");
      const cancel = h("button", { onclick: () => { pending = null; void draw(); } }, "Cancel");
      children.push(h("div", { class: "panel", style: "border-color: var(--bills)" },
        h("h3", {}, "Move items first"),
        h("p", { class: "muted small" }, `"${subject}" still has items. Choose where they go, then delete. Items keep their Google link.`),
        h("div", { class: "addbar" }, h("span", {}, "Move items to:"), select, confirm, cancel)));
    }

    // Add a category.
    const newName = h("input", { type: "text", placeholder: "New category", class: "grow" });
    children.push(h("div", { class: "panel addbar" }, newName,
      h("button", { class: "primary", onclick: () => save(context, async () => { const name = (newName as HTMLInputElement).value.trim(); if (name) await api("POST", "/api/calendar/categories", { name }); }).then(draw) }, "Add category")));

    // One panel per category.
    for (const cat of cats) {
      const renameCat = h("button", { title: "Rename", onclick: () => { const name = window.prompt("Rename category", cat.name); if (name && name.trim()) void save(context, () => api("PATCH", `/api/calendar/categories/${cat.id}`, { name: name.trim() })).then(draw); } }, "Rename");
      const editLeads = h("button", { title: "Default lead times (days)", onclick: () => {
        const input = window.prompt("Default reminder lead times in days (comma-separated; applied to Events)", cat.defaultLeadTimes.join(", "));
        if (input === null) return;
        const leadTimes = input.split(",").map((part) => Number(part.trim())).filter((n) => Number.isInteger(n) && n >= 0);
        void save(context, () => api("PATCH", `/api/calendar/categories/${cat.id}`, { defaultLeadTimes: leadTimes })).then(draw);
      } }, `Lead times: ${cat.defaultLeadTimes.join(", ") || "none"}`);
      const delCat = h("button", { class: "danger", onclick: () => {
        if (cat.itemCount > 0) { pending = { kind: "category", catId: cat.id }; void draw(); return; }
        void save(context, () => api("DELETE", `/api/calendar/categories/${cat.id}`)).then(draw);
      } }, "Delete");

      const subRows = cat.subcategories.map((sub) => h("div", { class: "cal-row item" },
        h("span", { class: "cal-title" }, sub.name),
        h("span", { class: "cal-when" }, `${sub.itemCount} item(s)`),
        h("button", { onclick: () => { const name = window.prompt("Rename subcategory", sub.name); if (name && name.trim()) void save(context, () => api("PATCH", `/api/calendar/categories/${cat.id}/subcategories/${sub.id}`, { name: name.trim() })).then(draw); } }, "Rename"),
        h("button", { class: "danger", onclick: () => {
          if (sub.itemCount > 0) { pending = { kind: "subcategory", catId: cat.id, subId: sub.id }; void draw(); return; }
          void save(context, () => api("DELETE", `/api/calendar/categories/${cat.id}/subcategories/${sub.id}`)).then(draw);
        } }, "Delete")));

      const newSub = h("input", { type: "text", placeholder: "New subcategory", class: "grow" });
      const addSub = h("button", { class: "primary", onclick: () => save(context, async () => { const name = (newSub as HTMLInputElement).value.trim(); if (name) await api("POST", `/api/calendar/categories/${cat.id}/subcategories`, { name }); }).then(draw) }, "Add");

      children.push(h("div", { class: "panel" },
        h("div", { class: "panel-head" }, h("h3", {}, `${cat.name} (${cat.itemCount})`), h("div", { class: "actions" }, renameCat, editLeads, delCat)),
        ...(subRows.length ? subRows : [h("p", { class: "muted small" }, "No subcategories.")]),
        h("div", { class: "addbar" }, newSub, addSub)));
    }

    container.replaceChildren(h("div", { class: "page cal-categories" }, ...children));
  };

  await draw();
}
