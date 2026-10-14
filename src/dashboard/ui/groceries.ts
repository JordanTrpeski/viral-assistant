// Groceries module: Shopping list (with templates column), Templates, Prices, Trips.
import type { ListItem, PriceHistory, Template, TemplateItem, Trip, TripItem } from "../groceries.js";
import { formatCents, parseEuroToCents } from "../shared/money.js";
import { api, save, type AppContext } from "./api.js";
import { focusKey, h } from "./dom.js";

type Tab = "list" | "templates" | "prices" | "trips";

const state: { tab: Tab; tripDate: string | null; tripStore: string; openTripId: string | null } = { tab: "list", tripDate: null, tripStore: "", openTripId: null };
const tabLabels: Record<Tab, string> = { list: "Shopping list", templates: "Templates", prices: "Prices", trips: "Trips" };

function euros(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

/** A euro input that saves on change; `allowEmpty` lets a price be cleared (null). */
function priceInput(context: AppContext, cents: number | null, key: string, onSave: (cents: number | null) => Promise<void>, allowEmpty = false): HTMLInputElement {
  return h("input", {
    ...focusKey(key), class: "amount-input", inputmode: "decimal", placeholder: "price", value: euros(cents),
    onchange: (event: Event) => {
      const input = event.target as HTMLInputElement;
      if (allowEmpty && input.value.trim() === "") return onSave(null);
      const parsed = parseEuroToCents(input.value);
      if (parsed === null || parsed <= 0) {
        context.notify("Enter a price above zero, e.g. 2.49");
        input.value = euros(cents);
        return;
      }
      return onSave(parsed);
    }
  });
}

function quantityInput(context: AppContext, quantity: number, key: string, onSave: (quantity: number) => Promise<void>): HTMLInputElement {
  return h("input", {
    ...focusKey(key), class: "qty-input", type: "number", min: 1, step: 1, value: quantity,
    onchange: (event: Event) => {
      const input = event.target as HTMLInputElement;
      const value = Number(input.value);
      if (!Number.isSafeInteger(value) || value < 1) {
        context.notify("Quantity must be a whole number of at least 1");
        input.value = String(quantity);
        return;
      }
      return onSave(value);
    }
  });
}

function templatesColumn(context: AppContext, templates: Template[]): HTMLElement {
  return h("aside", { class: "panel side-column" },
    h("h3", {}, "Templates"),
    templates.length ? null : h("p", { class: "muted small" }, "No templates yet. Create one in the Templates tab."),
    ...templates.map((template) => h("div", { class: "template-card" },
      h("div", {}, h("div", {}, template.name), h("div", { class: "muted small" }, `${template.items.length} item${template.items.length === 1 ? "" : "s"}`)),
      h("button", {
        class: "primary",
        onclick: () => save(context, async () => {
          const result = await api<{ added: ListItem[]; skipped: string[] }>("POST", `/api/groceries/templates/${template.id}/start`);
          if (result.skipped.length) context.notify(`Already on the list: ${result.skipped.join(", ")}`);
        })
      }, "Start"))));
}

function listTab(context: AppContext, items: ListItem[], templates: Template[]): HTMLElement {
  const draft = { name: "", quantity: 1 };
  const add = (): Promise<void> => {
    if (!draft.name.trim()) return Promise.resolve();
    return save(context, () => api("POST", "/api/groceries/items", draft));
  };
  const patch = (item: ListItem, body: Record<string, unknown>): Promise<void> => save(context, () => api("PATCH", `/api/groceries/items/${item.id}`, body));
  const ordered = [...items.filter((item) => !item.bought), ...items.filter((item) => item.bought)];
  const bought = items.filter((item) => item.bought);
  const boughtTotal = bought.reduce((total, item) => total + (item.unitPriceCents ?? 0) * item.quantity, 0);
  const missingPrices = bought.filter((item) => item.unitPriceCents === null).length;
  const tripDate = state.tripDate ?? context.today;
  return h("div", { class: "with-side" },
    h("section", { class: "panel" },
      h("div", { class: "inline-add" },
        h("input", { ...focusKey("new-item"), placeholder: "Add an item and press Enter", oninput: (event: Event) => { draft.name = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void add(); } }),
        h("input", { class: "qty-input", type: "number", min: 1, step: 1, value: 1, "aria-label": "Quantity", oninput: (event: Event) => { draft.quantity = Math.max(1, Math.floor(Number((event.target as HTMLInputElement).value) || 1)); } }),
        h("button", { onclick: add }, "Add")),
      h("ul", { class: "checklist" },
        ...ordered.map((item) => h("li", { class: item.bought ? "bought" : "" },
          h("input", { type: "checkbox", checked: item.bought, "aria-label": `Bought ${item.name}`, onchange: (event: Event) => patch(item, { bought: (event.target as HTMLInputElement).checked }) }),
          h("input", { ...focusKey(`${item.id}:name`), class: "item-name", value: item.name, onchange: (event: Event) => patch(item, { name: (event.target as HTMLInputElement).value }) }),
          quantityInput(context, item.quantity, `${item.id}:qty`, (quantity) => patch(item, { quantity })),
          h("span", { class: "muted small" }, "×"),
          priceInput(context, item.unitPriceCents, `${item.id}:price`, (cents) => patch(item, { unitPriceCents: cents }), true),
          h("span", { class: "line-total" }, item.unitPriceCents === null ? "—" : formatCents(item.unitPriceCents * item.quantity)),
          h("button", { class: "danger", "aria-label": `Delete ${item.name}`, onclick: () => save(context, () => api("DELETE", `/api/groceries/items/${item.id}`)) }, "✕"))),
        items.length ? null : h("li", { class: "empty" }, "The list is empty. Add items above or start a template.")),
      h("div", { class: "trip-bar" },
        h("span", {}, `${bought.length} bought · ${formatCents(boughtTotal)}${missingPrices ? ` · ${missingPrices} without price` : ""}`),
        h("span", { class: "spacer" }),
        h("input", { type: "date", value: tripDate, "aria-label": "Trip date", onchange: (event: Event) => { state.tripDate = (event.target as HTMLInputElement).value || null; } }),
        h("input", { placeholder: "Store (optional)", value: state.tripStore, oninput: (event: Event) => { state.tripStore = (event.target as HTMLInputElement).value; } }),
        h("button", {
          class: "primary", disabled: bought.length === 0,
          onclick: () => save(context, async () => {
            await api<Trip>("POST", "/api/groceries/trips", { date: state.tripDate ?? context.today, store: state.tripStore });
            state.tripStore = "";
            state.tripDate = null;
          })
        }, "Complete trip"))),
    templatesColumn(context, templates));
}

function templateEditor(context: AppContext, template: Template): HTMLElement {
  const putItems = (items: TemplateItem[]): Promise<void> => save(context, () => api("PATCH", `/api/groceries/templates/${template.id}`, { items }));
  const draft = { name: "", quantity: 1 };
  const addItem = (): Promise<void> => (draft.name.trim() ? putItems([...template.items, { ...draft }]) : Promise.resolve());
  return h("section", { class: "panel template-editor" },
    h("div", { class: "toolbar" },
      h("input", { ...focusKey(`${template.id}:name`), class: "template-name", value: template.name, onchange: (event: Event) => save(context, () => api("PATCH", `/api/groceries/templates/${template.id}`, { name: (event.target as HTMLInputElement).value })) }),
      h("span", { class: "spacer" }),
      h("button", { class: "primary", onclick: () => save(context, () => api("POST", `/api/groceries/templates/${template.id}/start`)) }, "Start"),
      h("button", { class: "danger", onclick: () => save(context, () => api("DELETE", `/api/groceries/templates/${template.id}`)) }, "Delete")),
    h("ul", { class: "checklist compact" },
      ...template.items.map((item, index) => h("li", {},
        h("input", { ...focusKey(`${template.id}:${index}:name`), class: "item-name", value: item.name, onchange: (event: Event) => putItems(template.items.map((entry, position) => (position === index ? { ...entry, name: (event.target as HTMLInputElement).value } : entry))) }),
        quantityInput(context, item.quantity, `${template.id}:${index}:qty`, (quantity) => putItems(template.items.map((entry, position) => (position === index ? { ...entry, quantity } : entry)))),
        h("button", { class: "danger", "aria-label": `Remove ${item.name}`, onclick: () => putItems(template.items.filter((_entry, position) => position !== index)) }, "✕"))),
      h("li", {},
        h("input", { class: "item-name", placeholder: "Add item", oninput: (event: Event) => { draft.name = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void addItem(); } }),
        h("input", { class: "qty-input", type: "number", min: 1, value: 1, oninput: (event: Event) => { draft.quantity = Math.max(1, Math.floor(Number((event.target as HTMLInputElement).value) || 1)); } }),
        h("button", { onclick: addItem }, "Add"))));
}

function templatesTab(context: AppContext, templates: Template[]): HTMLElement {
  let name = "";
  const create = (): Promise<void> => (name.trim() ? save(context, () => api("POST", "/api/groceries/templates", { name, items: [] })) : Promise.resolve());
  return h("div", { class: "template-grid" },
    ...templates.map((template) => templateEditor(context, template)),
    h("section", { class: "panel" },
      h("h3", {}, "New template"),
      h("div", { class: "inline-add" },
        h("input", { placeholder: "Template name, e.g. Weekly basics", oninput: (event: Event) => { name = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void create(); } }),
        h("button", { class: "primary", onclick: create }, "Create"))));
}

function pricesTab(context: AppContext, history: PriceHistory): HTMLElement {
  const draft: { item: string; date: string; cents: number | null } = { item: "", date: context.today, cents: null };
  const add = (): Promise<void> => {
    if (!draft.item.trim() || draft.cents === null) {
      context.notify("Enter an item and a price above zero");
      return Promise.resolve();
    }
    return save(context, () => api("POST", "/api/groceries/prices", { item: draft.item, date: draft.date, unitPriceCents: draft.cents }));
  };
  return h("div", { class: "two-col" },
    h("section", { class: "panel" },
      h("h3", {}, "Price watch"),
      history.watch.length
        ? h("table", { class: "grid-table" },
          h("thead", {}, h("tr", {}, h("th", {}, "Item"), h("th", { class: "num" }, "Was"), h("th", { class: "num" }, "Now"), h("th", { class: "num" }, "Change"))),
          h("tbody", {}, ...history.watch.map((entry) => h("tr", {},
            h("td", {}, entry.item),
            h("td", { class: "num muted" }, `${formatCents(entry.previousCents)} · ${entry.previousDate}`),
            h("td", { class: "num" }, `${formatCents(entry.latestCents)} · ${entry.latestDate}`),
            h("td", { class: `num ${entry.changeCents > 0 ? "negative" : "positive"}` }, `${entry.changeCents > 0 ? "+" : "−"}${formatCents(Math.abs(entry.changeCents))} (${entry.changePercent > 0 ? "+" : ""}${entry.changePercent}%)`)))))
        : h("p", { class: "muted small" }, "No price changes yet. Prices are recorded with each completed trip.")),
    h("section", { class: "panel" },
      h("h3", {}, "Price history"),
      h("div", { class: "inline-add" },
        h("input", { placeholder: "Item", oninput: (event: Event) => { draft.item = (event.target as HTMLInputElement).value; } }),
        h("input", { type: "date", value: draft.date, onchange: (event: Event) => { draft.date = (event.target as HTMLInputElement).value; } }),
        h("input", { class: "amount-input", inputmode: "decimal", placeholder: "price", oninput: (event: Event) => { draft.cents = parseEuroToCents((event.target as HTMLInputElement).value); }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void add(); } }),
        h("button", { onclick: add }, "Add price")),
      history.items.length ? null : h("p", { class: "muted small" }, "No prices recorded yet."),
      ...history.items.map((group) => h("div", { class: "price-group" },
        h("div", { class: "price-group-name" }, group.item),
        h("table", { class: "grid-table" }, h("tbody", {}, ...group.entries.map((entry) => h("tr", {},
          h("td", {}, h("input", { ...focusKey(`${entry.id}:date`), type: "date", value: entry.date, onchange: (event: Event) => save(context, () => api("PATCH", `/api/groceries/prices/${entry.id}`, { date: (event.target as HTMLInputElement).value })) })),
          h("td", { class: "num" }, priceInput(context, entry.unitPriceCents, `${entry.id}:price`, (cents) => save(context, () => api("PATCH", `/api/groceries/prices/${entry.id}`, { unitPriceCents: cents })))),
          h("td", { class: "muted small" }, entry.tripId ? "trip" : "manual"),
          h("td", { class: "actions" }, h("button", { class: "danger", onclick: () => save(context, () => api("DELETE", `/api/groceries/prices/${entry.id}`)) }, "Delete"))))))))));
}

function tripItemsEditor(context: AppContext, trip: Trip): HTMLElement {
  const putItems = (items: TripItem[]): Promise<void> => save(context, () => api("PATCH", `/api/groceries/trips/${trip.id}`, { items: items.map(({ name, quantity, unitPriceCents }) => ({ name, quantity, unitPriceCents })) }));
  const replace = (index: number, change: Partial<TripItem>): Promise<void> => putItems(trip.items.map((item, position) => (position === index ? { ...item, ...change } : item)));
  return h("tr", { class: "trip-items" }, h("td", { colspan: 6 },
    h("table", { class: "grid-table" }, h("tbody", {}, ...trip.items.map((item, index) => h("tr", {},
      h("td", {}, h("input", { ...focusKey(`${trip.id}:${index}:name`), value: item.name, onchange: (event: Event) => replace(index, { name: (event.target as HTMLInputElement).value }) })),
      h("td", {}, quantityInput(context, item.quantity, `${trip.id}:${index}:qty`, (quantity) => replace(index, { quantity }))),
      h("td", { class: "num" }, priceInput(context, item.unitPriceCents, `${trip.id}:${index}:price`, (cents) => replace(index, { unitPriceCents: cents! }))),
      h("td", { class: "num" }, formatCents(item.lineCents)),
      h("td", { class: "actions" }, h("button", {
        class: "danger", disabled: trip.items.length === 1, title: trip.items.length === 1 ? "A trip needs at least one item; delete the trip instead" : "Remove item",
        onclick: () => putItems(trip.items.filter((_item, position) => position !== index))
      }, "Remove"))))))));
}

function tripsTab(context: AppContext, trips: Trip[]): HTMLElement {
  const rows = trips.flatMap((trip) => {
    const patch = (body: Record<string, unknown>): Promise<void> => save(context, () => api("PATCH", `/api/groceries/trips/${trip.id}`, body));
    const row = h("tr", {},
      h("td", {}, h("input", { ...focusKey(`${trip.id}:date`), type: "date", value: trip.date, onchange: (event: Event) => patch({ date: (event.target as HTMLInputElement).value }) })),
      h("td", {}, h("input", { ...focusKey(`${trip.id}:store`), value: trip.store, placeholder: "Store", onchange: (event: Event) => patch({ store: (event.target as HTMLInputElement).value }) })),
      h("td", {}, `${trip.items.length} item${trip.items.length === 1 ? "" : "s"}`),
      h("td", { class: "num" }, formatCents(trip.totalCents)),
      h("td", { class: "small muted" }, trip.transactionId ? "In Finance" : "Expense deleted in Finance"),
      h("td", { class: "actions" },
        h("button", { onclick: () => { state.openTripId = state.openTripId === trip.id ? null : trip.id; void context.refresh(); } }, state.openTripId === trip.id ? "Hide items" : "Items"),
        h("button", { class: "danger", onclick: () => save(context, () => api("DELETE", `/api/groceries/trips/${trip.id}`)) }, "Delete")));
    return state.openTripId === trip.id ? [row, tripItemsEditor(context, trip)] : [row];
  });
  return h("section", { class: "panel" },
    h("table", { class: "grid-table" },
      h("thead", {}, h("tr", {}, ...["Date", "Store", "Items", "Total", "Finance", "Actions"].map((label) => h("th", label === "Total" ? { class: "num" } : {}, label)))),
      h("tbody", {}, ...rows, trips.length ? null : h("tr", {}, h("td", { colspan: 6, class: "empty" }, "No completed trips yet. Tick items on the shopping list and press Complete trip.")))),
    h("p", { class: "muted small" }, "Each completed trip is one Groceries expense in Finance. Editing a trip updates that expense; deleting the trip removes it."));
}

export async function renderGroceries(container: HTMLElement, context: AppContext): Promise<void> {
  let body: HTMLElement;
  if (state.tab === "list") {
    const [items, templates] = await Promise.all([api<ListItem[]>("GET", "/api/groceries/items"), api<Template[]>("GET", "/api/groceries/templates")]);
    body = listTab(context, items, templates);
  } else if (state.tab === "templates") body = templatesTab(context, await api<Template[]>("GET", "/api/groceries/templates"));
  else if (state.tab === "prices") body = pricesTab(context, await api<PriceHistory>("GET", "/api/groceries/prices"));
  else body = tripsTab(context, await api<Trip[]>("GET", "/api/groceries/trips"));
  container.replaceChildren(h("div", { class: "page groceries" },
    h("div", { class: "tabs" }, ...(Object.keys(tabLabels) as Tab[]).map((tab) =>
      h("button", { class: `tab${state.tab === tab ? " active" : ""}`, onclick: () => { state.tab = tab; void context.refresh(); } }, tabLabels[tab]))),
    body));
}
