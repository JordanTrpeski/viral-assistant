import { targetsFor, type FinanceDocument } from "./finance.js";
import { addDays, budgetWeekOf, firstOfMonth, inRange, lastOfMonth, mondayOf, monthOf, type IsoDate, type IsoMonth } from "./shared/dates.js";
import { sumCents } from "./shared/money.js";

// Re-exported from shared/ so the browser UI can import it from a served module while server code and tests
// keep importing it from here.
export { budgetStatus, type BudgetStatus } from "./shared/budget-status.js";

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

/** Number of days in a calendar month. */
export function daysInMonth(month: IsoMonth): number {
  return Number(lastOfMonth(month).slice(8, 10));
}

/**
 * Cents allotted to one day of `month` under `limitCents`, distributing the limit so the month's days sum to it
 * exactly: the base is floor(limit / days) and the first (limit mod days) days each get one extra cent.
 * `dayOfMonth` is 1-based.
 */
export function dailyRateCents(limitCents: number, month: IsoMonth, dayOfMonth: number): number {
  const days = daysInMonth(month);
  const base = Math.floor(limitCents / days);
  const remainder = limitCents - base * days;
  return base + (dayOfMonth <= remainder ? 1 : 0);
}

/** A monthly limit saved for one calendar month. */
export interface SavedMonthlyLimit {
  month: IsoMonth;
  limitCents: number;
}

export interface WeekAllowance {
  allowanceCents: number;
  /** True when at least one day fell back to another month's limit because its own month had none saved. */
  estimated: boolean;
}

/**
 * The Monday-to-Sunday allowance for the week beginning `weekStart`: the sum of each day's daily rate, taking
 * each day's rate from the saved monthly limit of the month that day falls in. Weeks are never cut at a month
 * boundary, so a week that crosses into the next month uses both months' rates. A day whose month has no saved
 * limit falls back to the most recent saved limit at or before it (else the earliest saved) and marks the week
 * estimated. With no saved limits at all the allowance is zero.
 */
export function weekAllowance(savedLimits: readonly SavedMonthlyLimit[], weekStart: IsoDate, weekDays = 7): WeekAllowance {
  const byMonth = new Map(savedLimits.map((entry) => [entry.month, entry.limitCents]));
  const months = [...byMonth.keys()].sort();
  let allowanceCents = 0;
  let estimated = false;
  for (let offset = 0; offset < weekDays; offset += 1) {
    const date = addDays(weekStart, offset);
    const month = monthOf(date);
    let limit = byMonth.get(month);
    if (limit === undefined) {
      const fallback = months.filter((candidate) => candidate <= month).at(-1) ?? months[0];
      if (fallback === undefined) continue;
      limit = byMonth.get(fallback)!;
      estimated = true;
    }
    allowanceCents += dailyRateCents(limit, month, Number(date.slice(8, 10)));
  }
  return { allowanceCents, estimated };
}

export interface WeekAllowanceRow {
  categoryId: string;
  name: string;
  /** The effective weekly allowance: the override when one is set, otherwise the calculated default. */
  allowanceCents: number;
  /** The calculated daily-rate default, before any override. */
  computedCents: number;
  /** The stored weekly override (weeklyCents) when greater than zero, else null. */
  overrideCents: number | null;
  spentCents: number;
  remainingCents: number;
  estimated: boolean;
}

export interface WeekAllowanceBudget {
  /** Monday of the week (never cut at a month edge). */
  start: IsoDate;
  /** Sunday of the week. */
  end: IsoDate;
  rows: WeekAllowanceRow[];
  allowanceCents: number;
  spentCents: number;
  remainingCents: number;
  estimated: boolean;
}

/**
 * Per-category weekly allowance for the full Monday-to-Sunday week containing `date`. Each category's limit is
 * its single stored monthly limit applied to every month the week touches, so in the app a week is never
 * estimated; a positive stored weekly override (weeklyCents) replaces the calculated default for that week.
 * Nothing here is stored: it is recomputed on every request from the monthly limits and the transactions.
 */
export function weeklyAllowanceBudget(document: FinanceDocument, date: IsoDate): WeekAllowanceBudget {
  const start = mondayOf(date);
  const end = addDays(start, 6);
  const months = [...new Set([monthOf(start), monthOf(end)])];
  const names = new Map(document.categories.map((category) => [category.id, category.name]));
  // Only categories switched on for weekly spreading appear in any weekly figure (allowance, spent, totals).
  const spreads = new Map(document.categories.map((category) => [category.id, category.spreadWeekly === true]));
  const rows: WeekAllowanceRow[] = targetsFor(document).filter((entry) => spreads.get(entry.categoryId) === true).map((entry) => {
    const savedLimits = months.map((month) => ({ month, limitCents: entry.monthlyCents }));
    const computed = weekAllowance(savedLimits, start);
    const overrideCents = entry.weeklyCents > 0 ? entry.weeklyCents : null;
    const allowanceCents = overrideCents ?? computed.allowanceCents;
    const spentCents = sumCents(document.transactions
      .filter((transaction) => transaction.kind === "expense" && transaction.categoryId === entry.categoryId && inRange(transaction.date, start, end))
      .map((transaction) => transaction.amountCents));
    return {
      categoryId: entry.categoryId,
      name: names.get(entry.categoryId) ?? entry.categoryId,
      allowanceCents,
      computedCents: computed.allowanceCents,
      overrideCents,
      spentCents,
      remainingCents: allowanceCents - spentCents,
      estimated: overrideCents === null && computed.estimated
    };
  });
  const allowanceCents = sumCents(rows.map((row) => row.allowanceCents));
  const spentCents = sumCents(rows.map((row) => row.spentCents));
  return { start, end, rows, allowanceCents, spentCents, remainingCents: allowanceCents - spentCents, estimated: rows.some((row) => row.estimated) };
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
