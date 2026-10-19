import { targetsFor, type FinanceDocument } from "./finance.js";
import { budgetWeekOf, firstOfMonth, inRange, lastOfMonth, type IsoDate, type IsoMonth } from "./shared/dates.js";
import { sumCents } from "./shared/money.js";

export interface BudgetRow {
  categoryId: string;
  name: string;
  /** Target for this period; a cut week gets the weekly target prorated by days (rounded to the cent). */
  targetCents: number;
  /** The unprorated target as configured. */
  configuredCents: number;
  spentCents: number;
  remainingCents: number;
}

export interface CommittedBill {
  transactionId: string;
  categoryId: string;
  name: string;
  label: string;
  date: IsoDate;
  amountCents: number;
}

export interface WeekBudget {
  start: IsoDate;
  end: IsoDate;
  days: number;
  rows: BudgetRow[];
  targetCents: number;
  spentCents: number;
  remainingCents: number;
}

export interface MonthBudget {
  month: IsoMonth;
  committed: CommittedBill[];
  committedCents: number;
  rows: BudgetRow[];
  targetCents: number;
  spentCents: number;
  remainingCents: number;
}

/** Weekly target for a week segment of `days` days: the full target for 7 days, otherwise prorated and rounded to the cent. */
export function proratedWeeklyTarget(weeklyCents: number, days: number): number {
  return days >= 7 ? weeklyCents : Math.round((weeklyCents * days) / 7);
}

function flexibleRows(document: FinanceDocument, start: IsoDate, end: IsoDate, target: (weeklyCents: number, monthlyCents: number) => number, configured: "weekly" | "monthly"): BudgetRow[] {
  const names = new Map(document.categories.map((category) => [category.id, category.name]));
  return targetsFor(document).map((entry) => {
    const spentCents = sumCents(document.transactions
      .filter((transaction) => transaction.kind === "expense" && transaction.categoryId === entry.categoryId && inRange(transaction.date, start, end))
      .map((transaction) => transaction.amountCents));
    const targetCents = target(entry.weeklyCents, entry.monthlyCents);
    return {
      categoryId: entry.categoryId,
      name: names.get(entry.categoryId) ?? entry.categoryId,
      targetCents,
      configuredCents: configured === "weekly" ? entry.weeklyCents : entry.monthlyCents,
      spentCents,
      remainingCents: targetCents - spentCents
    };
  });
}

function totals(rows: BudgetRow[]): { targetCents: number; spentCents: number; remainingCents: number } {
  const targetCents = sumCents(rows.map((row) => row.targetCents));
  const spentCents = sumCents(rows.map((row) => row.spentCents));
  return { targetCents, spentCents, remainingCents: targetCents - spentCents };
}

/** "This week": the Monday-to-Sunday week containing `date`, cut at month edges. Flexible spending only; bills never split into weeks. */
export function weekBudget(document: FinanceDocument, date: IsoDate): WeekBudget {
  const week = budgetWeekOf(date);
  const rows = flexibleRows(document, week.start, week.end, (weekly) => proratedWeeklyTarget(weekly, week.days), "weekly");
  return { ...week, rows, ...totals(rows) };
}

/** "This month": fixed bills committed for the whole month with their due dates, plus flexible spending against monthly targets. */
export function monthBudget(document: FinanceDocument, month: IsoMonth): MonthBudget {
  const start = firstOfMonth(month);
  const end = lastOfMonth(month);
  const names = new Map(document.categories.map((category) => [category.id, category.name]));
  const committed = document.transactions
    .filter((transaction) => transaction.kind === "bill" && inRange(transaction.date, start, end))
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((transaction) => {
      const name = names.get(transaction.categoryId) ?? transaction.categoryId;
      return { transactionId: transaction.id, categoryId: transaction.categoryId, name, label: transaction.note || name, date: transaction.date, amountCents: transaction.amountCents };
    });
  const rows = flexibleRows(document, start, end, (_weekly, monthly) => monthly, "monthly");
  return { month, committed, committedCents: sumCents(committed.map((bill) => bill.amountCents)), rows, ...totals(rows) };
}
