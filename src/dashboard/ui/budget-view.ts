// Budget views shared by the Overview and the Finance > Budget tab.
import type { BudgetRow, MonthBudget, WeekBudget } from "../budget.js";
import { formatCents } from "../shared/money.js";
import { api, save, type AppContext } from "./api.js";
import { h } from "./dom.js";

export interface BudgetResponse {
  date: string;
  stepCents: number;
  week: WeekBudget;
  month: MonthBudget;
}

/** Budget data for the shared views. `stepCents` is present only where editing is offered (Finance). */
export interface BudgetViewData {
  date: string;
  week: WeekBudget;
  month: MonthBudget;
  stepCents?: number;
}

export function loadBudget(date?: string): Promise<BudgetResponse> {
  return api<BudgetResponse>("GET", `/api/budget${date ? `?date=${date}` : ""}`);
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-").map(Number) as [number, number, number];
  return `${day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]}`;
}

function step(context: AppContext, categoryId: string, period: "weekly" | "monthly", direction: 1 | -1, stepCents: number): HTMLButtonElement {
  return h("button", {
    class: "step",
    title: `${direction > 0 ? "Raise" : "Lower"} ${period} target by ${formatCents(stepCents)}`,
    "aria-label": `${direction > 0 ? "Raise" : "Lower"} ${period} target`,
    onclick: () => save(context, () => api("POST", `/api/finance/targets/${encodeURIComponent(categoryId)}/step`, { period, direction }))
  }, direction > 0 ? "+" : "−");
}

function row(context: AppContext, budgetRow: BudgetRow, period: "weekly" | "monthly", editable: boolean, stepCents?: number): HTMLElement {
  const ratio = budgetRow.targetCents > 0 ? Math.min(1, budgetRow.spentCents / budgetRow.targetCents) : budgetRow.spentCents > 0 ? 1 : 0;
  const over = budgetRow.remainingCents < 0;
  return h("div", { class: "budget-row" },
    h("div", { class: "budget-row-head" },
      h("span", { class: "budget-name" }, budgetRow.name),
      h("span", { class: `budget-figures${over ? " over" : ""}` }, `${formatCents(budgetRow.spentCents)} / ${formatCents(budgetRow.targetCents)}`),
      editable && stepCents !== undefined
        ? h("span", { class: "budget-controls" }, step(context, budgetRow.categoryId, period, -1, stepCents), step(context, budgetRow.categoryId, period, 1, stepCents))
        : null),
    h("div", { class: "bar" }, h("div", { class: `bar-fill${over ? " over" : ""}`, style: `width:${Math.round(ratio * 100)}%` })));
}

function total(label: string, targetCents: number, spentCents: number, remainingCents: number): HTMLElement {
  return h("div", { class: "budget-total" },
    h("span", {}, label),
    h("span", { class: remainingCents < 0 ? "over" : "" }, `${formatCents(spentCents)} of ${formatCents(targetCents)} · ${remainingCents < 0 ? `${formatCents(-remainingCents)} over` : `${formatCents(remainingCents)} left`}`));
}

export function weekView(context: AppContext, data: BudgetViewData, editable: boolean): HTMLElement {
  const week = data.week;
  const prorated = week.days < 7;
  return h("div", { class: "budget-view" },
    h("div", { class: "budget-caption" }, `${shortDate(week.start)}${week.start === week.end ? "" : ` – ${shortDate(week.end)}`} · ${week.days} day${week.days === 1 ? "" : "s"}${prorated ? " (targets prorated)" : ""}`),
    ...week.rows.map((budgetRow) => row(context, budgetRow, "weekly", editable, data.stepCents)),
    total("Flexible this week", week.targetCents, week.spentCents, week.remainingCents));
}

export function monthView(context: AppContext, data: BudgetViewData, editable: boolean): HTMLElement {
  const month = data.month;
  return h("div", { class: "budget-view" },
    h("div", { class: "budget-caption" }, `Committed bills · ${formatCents(month.committedCents)}`),
    month.committed.length
      ? h("ul", { class: "committed" }, ...month.committed.map((bill) =>
        h("li", {}, h("span", { class: "muted" }, shortDate(bill.date)), h("span", {}, bill.label), h("span", { class: "amount" }, formatCents(bill.amountCents)))))
      : h("div", { class: "muted small" }, "No fixed bills this month."),
    h("div", { class: "budget-caption" }, "Flexible spending"),
    ...month.rows.map((budgetRow) => row(context, budgetRow, "monthly", editable, data.stepCents)),
    total("Flexible this month", month.targetCents, month.spentCents, month.remainingCents));
}
