// Finance module: summary cards, Transactions / Budget / Categories tabs.
import type { Category, Transaction } from "../finance.js";
import type { FinanceSummary } from "../summary.js";
import { monthOf } from "../shared/dates.js";
import { formatCents, parseEuroToCents } from "../shared/money.js";
import { budgetStatus } from "../shared/budget-status.js";
import { api, save, type AppContext } from "./api.js";
import { loadBudget, shortDate } from "./budget-view.js";
import { focusKey, h } from "./dom.js";

type Tab = "transactions" | "budget" | "categories";
type Filter = "all" | "fixed" | "flexible" | "income";

const state: { tab: Tab; filter: Filter; month: string | null; editingId: string | null; adding: boolean } = {
  tab: "transactions", filter: "all", month: null, editingId: null, adding: false
};

// "Flexible" is shown as "Expense" everywhere (stored value stays "flexible"). "Fixed" keeps its label for the
// few places a pre-existing fixed category is still displayed, but it is no longer offered in the type dropdown.
const typeLabel: Record<Category["kind"], string> = { fixed: "Fixed", flexible: "Expense", income: "Income" };

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
  // Expense (flexible) and Income only. A Fixed group is shown just when pre-existing fixed categories exist,
  // so their transactions stay reachable; new fixed categories can no longer be made (see the type dropdown).
  const kinds: Category["kind"][] = ["flexible", "income"];
  if (categories.some((category) => category.kind === "fixed")) kinds.push("fixed");
  const groups = kinds.map((kind) =>
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

async function budgetTab(context: AppContext, _categories: Category[]): Promise<HTMLElement> {
  const budget = await loadBudget();
  const month = budget.month;
  const weeklyOf = new Map(budget.weekly.rows.map((row) => [row.categoryId, row]));

  const monthlyInput = (categoryId: string, cents: number): HTMLInputElement =>
    amountInputAllowZero(cents, (value) => save(context, () => api("PATCH", `/api/finance/targets/${encodeURIComponent(categoryId)}`, { monthlyCents: value })), context, `${categoryId}:monthlyCents`);
  const stepper = (categoryId: string): HTMLElement[] => [-1, 1].map((direction) =>
    h("button", { class: "step", "aria-label": `${direction > 0 ? "Raise" : "Lower"} monthly limit`, onclick: () => save(context, () => api("POST", `/api/finance/targets/${encodeURIComponent(categoryId)}/step`, { period: "monthly", direction })) }, direction > 0 ? "+" : "−"));
  // The weekly cell shows the allowance and doubles as the override: typing a value stores weeklyCents (0 clears it).
  const weeklyCell = (categoryId: string, cents: number, overridden: boolean, estimated: boolean): HTMLElement =>
    h("td", { class: "num" }, h("div", { class: "target-cell" },
      amountInputAllowZero(cents, (value) => save(context, () => api("PATCH", `/api/finance/targets/${encodeURIComponent(categoryId)}`, { weeklyCents: value })), context, `${categoryId}:weeklyCents`),
      overridden ? h("span", { class: "tag", title: "Weekly override set" }, "set") : estimated ? h("span", { class: "tag muted", title: "Estimated from the most recent limit" }, "est.") : null));

  const headers = ["Category", "Monthly limit", "Spent this month", "Left", "This week (allowance)", "Spent this week", "Status"];
  const bodyRows = month.rows.map((budgetRow) => {
    const limitCents = budgetRow.configuredCents;
    const status = budgetStatus(limitCents, budgetRow.spentCents);
    const weekly = weeklyOf.get(budgetRow.categoryId);
    const leftCell = status.kind === "none"
      ? h("td", { class: "num muted" }, "—")
      : status.kind === "over"
        ? h("td", { class: "num over" }, `−${formatCents(status.overByCents)}`)
        : h("td", { class: "num" }, formatCents(limitCents - budgetRow.spentCents));
    const statusCell = status.kind === "none"
      ? h("td", { class: "muted" }, "—")
      : status.kind === "over"
        ? h("td", { class: "status over" }, `Over by ${formatCents(status.overByCents)}`)
        : h("td", { class: "status" }, "OK");
    const weekSpent = weekly?.spentCents ?? 0;
    return h("tr", {},
      h("td", {}, budgetRow.name),
      h("td", {}, h("div", { class: "target-cell" }, stepper(budgetRow.categoryId)[0]!, monthlyInput(budgetRow.categoryId, limitCents), stepper(budgetRow.categoryId)[1]!)),
      h("td", { class: "num" }, formatCents(budgetRow.spentCents)),
      leftCell,
      weeklyCell(budgetRow.categoryId, weekly?.allowanceCents ?? 0, weekly?.overrideCents !== null && weekly !== undefined, weekly?.estimated ?? false),
      h("td", { class: `num${weekly && weekSpent > weekly.allowanceCents && weekly.allowanceCents > 0 ? " over" : ""}` }, formatCents(weekSpent)),
      statusCell);
  });

  const over = month.remainingCents < 0;
  const totalRow = h("tr", { class: "budget-total-row" },
    h("td", {}, "Total spent of total limits"),
    h("td", { class: "num" }, formatCents(month.targetCents)),
    h("td", { class: "num" }, formatCents(month.spentCents)),
    h("td", { class: `num${over ? " over" : ""}` }, over ? `−${formatCents(-month.remainingCents)}` : formatCents(month.remainingCents)),
    h("td", { class: "num" }, formatCents(budget.weekly.allowanceCents)),
    h("td", { class: "num" }, formatCents(budget.weekly.spentCents)),
    h("td", { class: over ? "status over" : "status" }, over ? `Over by ${formatCents(-month.remainingCents)}` : "OK"));

  return h("div", { class: "budget-tab" },
    h("section", { class: "panel" },
      h("h3", {}, "Monthly budget"),
      h("p", { class: "muted small" }, `One row per category: its limit, spent, what is left, and this week's allowance (monthly limit ÷ days in the month, summed over the week). − and + move a limit by ${formatCents(budget.stepCents)}; type in the week cell to override it.`),
      h("table", { class: "grid-table budget-table" },
        h("thead", {}, h("tr", {}, ...headers.map((label) => h("th", label === "Category" || label === "Status" ? {} : { class: "num" }, label)))),
        h("tbody", {}, ...(bodyRows.length ? bodyRows : [h("tr", {}, h("td", { colspan: headers.length, class: "empty" }, "No categories with budgets yet."))])),
        h("tfoot", {}, totalRow))),
    h("section", { class: "panel" },
      h("h3", {}, "Committed bills this month"),
      h("p", { class: "muted small" }, `Fixed bills are committed for the month · ${formatCents(month.committedCents)}`),
      month.committed.length
        ? h("ul", { class: "committed" }, ...month.committed.map((bill) =>
          h("li", {}, h("span", { class: "muted" }, shortDate(bill.date)), h("span", {}, bill.label), h("span", { class: "amount" }, formatCents(bill.amountCents)))))
        : h("div", { class: "muted small" }, "No fixed bills this month.")));
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
  // Only Expense and Income can be chosen. "Fixed" is offered solely when the category is already fixed, so an
  // existing fixed category keeps its stored kind until the owner deliberately changes it.
  const kindSelect = (value: Category["kind"], onChange: (kind: Category["kind"]) => void, key?: string): HTMLSelectElement => {
    const kinds: Category["kind"][] = ["flexible", "income"];
    if (value === "fixed") kinds.unshift("fixed");
    return h("select", { ...(key ? focusKey(key) : {}), value, onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value as Category["kind"]) },
      ...kinds.map((kind) => h("option", { value: kind }, typeLabel[kind])));
  };
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
