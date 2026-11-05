// Read-only budget views for the Overview. The Finance > Budget tab builds its own editable table.
import type { BudgetRow, MonthBudget, WeekAllowanceBudget, WeekAllowanceRow, WeekBudget } from "../budget.js";
import { formatCents } from "../shared/money.js";
import { api } from "./api.js";
import { h } from "./dom.js";

export interface BudgetResponse {
  date: string;
  stepCents: number;
  week: WeekBudget;
  month: MonthBudget;
  /** Per-category daily-rate weekly allowance for the full week (spread categories only). */
  weekly: WeekAllowanceBudget;
}

/** The Overview budget payload: the month view keeps every category; the week view is the spread-only allowance. */
export interface OverviewBudget {
  date: string;
  month: MonthBudget;
  weekly: WeekAllowanceBudget;
}

export function loadBudget(date?: string): Promise<BudgetResponse> {
  return api<BudgetResponse>("GET", `/api/budget${date ? `?date=${date}` : ""}`);
}

export function shortDate(iso: string): string {
  const [, month, day] = iso.split("-").map(Number) as [number, number, number];
  return `${day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]}`;
}

/** A read-only progress row: name, "spent / limit", and a bar that fills red once spending is over. */
function progressRow(name: string, limitCents: number, spentCents: number, remainingCents: number): HTMLElement {
  const ratio = limitCents > 0 ? Math.min(1, spentCents / limitCents) : spentCents > 0 ? 1 : 0;
  const over = remainingCents < 0;
  return h("div", { class: "budget-row" },
    h("div", { class: "budget-row-head" },
      h("span", { class: "budget-name" }, name),
      h("span", { class: `budget-figures${over ? " over" : ""}` }, `${formatCents(spentCents)} / ${formatCents(limitCents)}`)),
    h("div", { class: "bar" }, h("div", { class: `bar-fill${over ? " over" : ""}`, style: `width:${Math.round(ratio * 100)}%` })));
}

function total(label: string, targetCents: number, spentCents: number, remainingCents: number): HTMLElement {
  return h("div", { class: "budget-total" },
    h("span", {}, label),
    h("span", { class: remainingCents < 0 ? "over" : "" }, `${formatCents(spentCents)} of ${formatCents(targetCents)} · ${remainingCents < 0 ? `${formatCents(-remainingCents)} over` : `${formatCents(remainingCents)} left`}`));
}

/** This week: the daily-rate allowance, same as the Budget tab, covering only categories spread over the week. */
export function weekView(data: WeekAllowanceBudget): HTMLElement {
  return h("div", { class: "budget-view" },
    h("div", { class: "budget-caption" }, `${shortDate(data.start)} – ${shortDate(data.end)} · 7 days${data.estimated ? " (estimated)" : ""}`),
    data.rows.length
      ? h("div", {}, ...data.rows.map((row: WeekAllowanceRow) => progressRow(row.name, row.allowanceCents, row.spentCents, row.remainingCents)))
      : h("div", { class: "muted small" }, "No categories are spread over the week yet."),
    total("Total this week", data.allowanceCents, data.spentCents, data.remainingCents));
}

/** This month: every category's monthly limit and spending. */
export function monthView(data: MonthBudget): HTMLElement {
  return h("div", { class: "budget-view" },
    h("div", { class: "budget-caption" }, "Expenses"),
    ...data.rows.map((budgetRow: BudgetRow) => progressRow(budgetRow.name, budgetRow.targetCents, budgetRow.spentCents, budgetRow.remainingCents)),
    total("Total this month", data.targetCents, data.spentCents, data.remainingCents));
}
