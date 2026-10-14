// Finance module: summary cards, Transactions / Budget / Categories tabs.
import type { BudgetTarget, Category, Transaction } from "../finance.js";
import type { FinanceSummary } from "../summary.js";
import { monthOf } from "../shared/dates.js";
import { formatCents, parseEuroToCents } from "../shared/money.js";
import { api, save, type AppContext } from "./api.js";
import { loadBudget, monthView, weekView } from "./budget-view.js";
import { focusKey, h } from "./dom.js";

type Tab = "transactions" | "budget" | "categories";
type Filter = "all" | "fixed" | "flexible" | "income";

const state: { tab: Tab; filter: Filter; month: string | null; editingId: string | null; adding: boolean } = {
  tab: "transactions", filter: "all", month: null, editingId: null, adding: false
};

const typeLabel: Record<Category["kind"], string> = { fixed: "Fixed", flexible: "Flexible", income: "Income" };

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function card(label: string, value: string, detail?: string, tone?: string): HTMLElement {
  return h("div", { class: "stat" }, h("div", { class: "stat-label" }, label), h("div", { class: `stat-value${tone ? ` ${tone}` : ""}` }, value), detail ? h("div", { class: "stat-detail" }, detail) : null);
}

function runwayText(summary: FinanceSummary): { value: string; detail: string } {
  const days = summary.runway.days;
  if (days === null) return { value: "—", detail: `No spending in the last ${summary.runway.windowDays} days` };
  return { value: `${days} days`, detail: `≈ ${(days / 30.44).toFixed(1)} months at ${formatCents(summary.runway.averageDailySpendCents)}/day` };
}

function categorySelect(categories: Category[], value: string, onChange: (id: string) => void, key: string): HTMLSelectElement {
  const groups = (["flexible", "fixed", "income"] as const).map((kind) =>
    h("optgroup", { label: typeLabel[kind] }, ...categories.filter((category) => category.kind === kind).map((category) => h("option", { value: category.id }, category.name))));
  return h("select", { ...focusKey(key), value, onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value) }, ...groups);
}

function amountInput(cents: number | null, onChange: (cents: number) => void, context: AppContext, key: string): HTMLInputElement {
  return h("input", {
    ...focusKey(key), class: "amount-input", inputmode: "decimal", placeholder: "0.00", value: cents === null ? "" : centsToInput(cents),
    onchange: (event: Event) => {
      const input = event.target as HTMLInputElement;
      const parsed = parseEuroToCents(input.value);
      if (parsed === null || parsed <= 0) {
        context.notify("Enter an amount above zero, e.g. 12.50");
        input.value = cents === null ? "" : centsToInput(cents);
        return;
      }
      onChange(parsed);
    }
  });
}

function editRow(context: AppContext, transaction: Transaction, categories: Category[]): HTMLElement {
  const patch = (body: Record<string, unknown>): Promise<void> => save(context, () => api("PATCH", `/api/finance/transactions/${transaction.id}`, body));
  const category = categories.find((candidate) => candidate.id === transaction.categoryId);
  return h("tr", { class: "editing" },
    h("td", {}, h("input", { ...focusKey(`${transaction.id}:date`), type: "date", value: transaction.date, onchange: (event: Event) => patch({ date: (event.target as HTMLInputElement).value }) })),
    h("td", {}, categorySelect(categories, transaction.categoryId, (id) => patch({ categoryId: id }), `${transaction.id}:category`)),
    h("td", {}, h("span", { class: `type type-${category?.kind ?? "flexible"}` }, category ? typeLabel[category.kind] : "?")),
    h("td", {}, h("input", { ...focusKey(`${transaction.id}:note`), value: transaction.note, placeholder: "Note", onchange: (event: Event) => patch({ note: (event.target as HTMLInputElement).value }) })),
    h("td", { class: "num" }, amountInput(transaction.amountCents, (cents) => patch({ amountCents: cents }), context, `${transaction.id}:amount`)),
    h("td", { class: "actions" },
      h("button", { onclick: () => { state.editingId = null; void context.refresh(); } }, "Done"),
      h("button", { class: "danger", onclick: () => { state.editingId = null; return save(context, () => api("DELETE", `/api/finance/transactions/${transaction.id}`)); } }, "Delete")));
}

function viewRow(context: AppContext, transaction: Transaction, categories: Category[]): HTMLElement {
  const category = categories.find((candidate) => candidate.id === transaction.categoryId);
  const income = transaction.kind === "income";
  return h("tr", { ondblclick: () => { state.editingId = transaction.id; void context.refresh(); } },
    h("td", {}, transaction.date),
    h("td", {}, category?.name ?? transaction.categoryId),
    h("td", {}, h("span", { class: `type type-${category?.kind ?? "flexible"}` }, category ? typeLabel[category.kind] : "?")),
    h("td", { class: "note" }, transaction.note, transaction.source === "groceries" ? h("span", { class: "tag" }, "trip") : null),
    h("td", { class: `num${income ? " positive" : ""}` }, `${income ? "+" : "−"}${formatCents(transaction.amountCents)}`),
    h("td", { class: "actions" },
      h("button", { onclick: () => { state.editingId = transaction.id; void context.refresh(); } }, "Edit"),
      h("button", { class: "danger", onclick: () => save(context, () => api("DELETE", `/api/finance/transactions/${transaction.id}`)) }, "Delete")));
}

/** A new row that becomes a real transaction as soon as it has a valid amount; further edits then PATCH it. */
function addRow(context: AppContext, categories: Category[]): HTMLElement {
  const draft = { date: context.today, categoryId: categories.find((category) => category.kind === "flexible")?.id ?? categories[0]?.id ?? "", note: "" };
  const create = (amountCents: number): Promise<void> => save(context, async () => {
    const created = await api<Transaction>("POST", "/api/finance/transactions", { ...draft, amountCents });
    state.adding = false;
    state.editingId = created.id;
  });
  const kind = (): string => typeLabel[categories.find((category) => category.id === draft.categoryId)?.kind ?? "flexible"];
  const type = h("span", { class: "type" }, kind());
  return h("tr", { class: "editing adding" },
    h("td", {}, h("input", { type: "date", value: draft.date, onchange: (event: Event) => { draft.date = (event.target as HTMLInputElement).value; } })),
    h("td", {}, categorySelect(categories, draft.categoryId, (id) => { draft.categoryId = id; type.textContent = kind(); }, "new:category")),
    h("td", {}, type),
    h("td", {}, h("input", { placeholder: "Note", onchange: (event: Event) => { draft.note = (event.target as HTMLInputElement).value; } })),
    h("td", { class: "num" }, amountInput(null, create, context, "new:amount")),
    h("td", { class: "actions" }, h("button", { onclick: () => { state.adding = false; void context.refresh(); } }, "Cancel")));
}

async function transactionsTab(context: AppContext, categories: Category[]): Promise<HTMLElement> {
  const month = state.month ?? monthOf(context.today);
  const transactions = await api<Transaction[]>("GET", `/api/finance/transactions?month=${month}&type=${state.filter}`);
  const filters = (["all", "fixed", "flexible", "income"] as const).map((filter) =>
    h("button", { class: `chip${state.filter === filter ? " active" : ""}`, onclick: () => { state.filter = filter; void context.refresh(); } }, filter === "all" ? "All" : typeLabel[filter]));
  const rows = transactions.map((transaction) => (state.editingId === transaction.id ? editRow : viewRow)(context, transaction, categories));
  return h("div", {},
    h("div", { class: "toolbar" },
      ...filters,
      h("input", { type: "month", value: month, "aria-label": "Month", onchange: (event: Event) => { state.month = (event.target as HTMLInputElement).value || null; void context.refresh(); } }),
      h("span", { class: "spacer" }),
      h("button", { class: "primary", onclick: () => { state.adding = true; state.editingId = null; void context.refresh().then(() => document.querySelector<HTMLElement>("[data-focus='new:amount']")?.focus()); } }, "+ Add transaction")),
    h("table", { class: "grid-table" },
      h("thead", {}, h("tr", {}, ...["Date", "Category", "Type", "Note", "Amount", "Actions"].map((label) => h("th", label === "Amount" ? { class: "num" } : {}, label)))),
      h("tbody", {}, state.adding ? addRow(context, categories) : null, ...rows,
        rows.length || state.adding ? null : h("tr", {}, h("td", { colspan: 6, class: "empty" }, "No transactions for this month and filter.")))));
}

async function budgetTab(context: AppContext, categories: Category[]): Promise<HTMLElement> {
  const [targets, budget] = await Promise.all([api<BudgetTarget[]>("GET", "/api/finance/targets"), loadBudget()]);
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const targetInput = (target: BudgetTarget, field: "weeklyCents" | "monthlyCents"): HTMLInputElement => amountInputAllowZero(target[field], (cents) =>
    save(context, () => api("PATCH", `/api/finance/targets/${encodeURIComponent(target.categoryId)}`, { [field]: cents })), context, `${target.categoryId}:${field}`);
  const stepper = (target: BudgetTarget, period: "weekly" | "monthly"): HTMLElement[] => [-1, 1].map((direction) =>
    h("button", { class: "step", onclick: () => save(context, () => api("POST", `/api/finance/targets/${encodeURIComponent(target.categoryId)}/step`, { period, direction })) }, direction > 0 ? "+" : "−"));
  return h("div", { class: "budget-tab" },
    h("section", { class: "panel" },
      h("h3", {}, "Targets (Flexible categories)"),
      h("p", { class: "muted small" }, `Weekly and monthly targets are independent. − and + move a target by ${formatCents(budget.stepCents)}.`),
      h("table", { class: "grid-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Category"), h("th", {}, "Weekly target"), h("th", {}, "Monthly target"))),
        h("tbody", {}, ...targets.map((target) => h("tr", {},
          h("td", {}, names.get(target.categoryId) ?? target.categoryId),
          h("td", {}, h("div", { class: "target-cell" }, stepper(target, "weekly")[0]!, targetInput(target, "weeklyCents"), stepper(target, "weekly")[1]!)),
          h("td", {}, h("div", { class: "target-cell" }, stepper(target, "monthly")[0]!, targetInput(target, "monthlyCents"), stepper(target, "monthly")[1]!))))))),
    h("div", { class: "two-col" },
      h("section", { class: "panel" }, h("h3", {}, "This week"), weekView(context, budget)),
      h("section", { class: "panel" }, h("h3", {}, "This month"), monthView(context, budget))));
}

function amountInputAllowZero(cents: number, onChange: (cents: number) => void, context: AppContext, key: string): HTMLInputElement {
  return h("input", {
    ...focusKey(key), class: "amount-input", inputmode: "decimal", value: centsToInput(cents),
    onchange: (event: Event) => {
      const input = event.target as HTMLInputElement;
      const parsed = parseEuroToCents(input.value);
      if (parsed === null || parsed < 0) {
        context.notify("Enter a target of zero or more, e.g. 150");
        input.value = centsToInput(cents);
        return;
      }
      onChange(parsed);
    }
  });
}

function categoriesTab(context: AppContext, categories: Category[]): HTMLElement {
  const draft = { name: "", kind: "flexible" as Category["kind"] };
  const kindSelect = (value: Category["kind"], onChange: (kind: Category["kind"]) => void, key?: string): HTMLSelectElement =>
    h("select", { ...(key ? focusKey(key) : {}), value, onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value as Category["kind"]) },
      ...(["fixed", "flexible", "income"] as const).map((kind) => h("option", { value: kind }, typeLabel[kind])));
  const add = (): Promise<void> => save(context, () => api("POST", "/api/finance/categories", draft));
  return h("section", { class: "panel narrow" },
    h("table", { class: "grid-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Type"), h("th", {}, "Actions"))),
      h("tbody", {},
        ...categories.map((category) => h("tr", {},
          h("td", {}, h("input", { ...focusKey(`${category.id}:name`), value: category.name, onchange: (event: Event) => save(context, () => api("PATCH", `/api/finance/categories/${category.id}`, { name: (event.target as HTMLInputElement).value })) })),
          h("td", {}, kindSelect(category.kind, (kind) => save(context, () => api("PATCH", `/api/finance/categories/${category.id}`, { kind })), `${category.id}:kind`)),
          h("td", { class: "actions" }, h("button", { class: "danger", onclick: () => save(context, () => api("DELETE", `/api/finance/categories/${category.id}`)) }, "Delete")))),
        h("tr", { class: "adding" },
          h("td", {}, h("input", { placeholder: "New category name", oninput: (event: Event) => { draft.name = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void add(); } })),
          h("td", {}, kindSelect(draft.kind, (kind) => { draft.kind = kind; })),
          h("td", { class: "actions" }, h("button", { class: "primary", onclick: add }, "Add category"))))));
}

export async function renderFinance(container: HTMLElement, context: AppContext): Promise<void> {
  const [summary, categories] = await Promise.all([api<FinanceSummary>("GET", "/api/finance/summary"), api<Category[]>("GET", "/api/finance/categories")]);
  const runway = runwayText(summary);
  const tabs = (["transactions", "budget", "categories"] as const).map((tab) =>
    h("button", { class: `tab${state.tab === tab ? " active" : ""}`, onclick: () => { state.tab = tab; void context.refresh(); } }, tab[0]!.toUpperCase() + tab.slice(1)));
  const body = state.tab === "transactions" ? await transactionsTab(context, categories) : state.tab === "budget" ? await budgetTab(context, categories) : categoriesTab(context, categories);
  container.replaceChildren(h("div", { class: "page finance" },
    h("div", { class: "stats" },
      card("Balance", formatCents(summary.balanceCents), "Opening balance + income − spending to date", summary.balanceCents < 0 ? "negative" : undefined),
      card("Income this month", formatCents(summary.incomeCents), undefined, "positive"),
      card("Spent this month", formatCents(summary.spentCents)),
      card("Runway", runway.value, runway.detail)),
    h("div", { class: "tabs" }, ...tabs),
    body));
}
