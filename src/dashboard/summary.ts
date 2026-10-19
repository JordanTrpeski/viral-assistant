import type { FinanceDocument } from "./finance.js";
import { addDays, monthOf, type IsoDate, type IsoMonth } from "./shared/dates.js";
import { sumCents } from "./shared/money.js";

/** Days of history used for the average daily spend behind runway. */
export const runwayWindowDays = 90;

export interface FinanceSummary {
  month: IsoMonth;
  today: IsoDate;
  balanceCents: number;
  incomeCents: number;
  spentCents: number;
  runway: {
    /** Whole days the balance lasts at the recent average daily spend; null when there was no spending to extrapolate. */
    days: number | null;
    averageDailySpendCents: number;
    windowDays: number;
  };
}

/**
 * Balance: opening balance plus income minus expenses and bills dated today or earlier.
 * Income and spent this month: transactions in `month` dated today or earlier (future-dated bills are commitments, not spending yet).
 * Runway: balance divided by the average daily spend (expenses and bills) over the last 90 days, including today.
 */
export function financeSummary(document: FinanceDocument, month: IsoMonth, today: IsoDate): FinanceSummary {
  const past = document.transactions.filter((transaction) => transaction.date <= today);
  const income = past.filter((transaction) => transaction.kind === "income");
  const spending = past.filter((transaction) => transaction.kind !== "income");
  const balanceCents = document.settings.openingBalanceCents + sumCents(income.map((item) => item.amountCents)) - sumCents(spending.map((item) => item.amountCents));
  const windowStart = addDays(today, -(runwayWindowDays - 1));
  const windowSpend = sumCents(spending.filter((item) => item.date >= windowStart).map((item) => item.amountCents));
  const days = windowSpend === 0 ? null : balanceCents <= 0 ? 0 : Math.floor((balanceCents * runwayWindowDays) / windowSpend);
  return {
    month,
    today,
    balanceCents,
    incomeCents: sumCents(income.filter((item) => monthOf(item.date) === month).map((item) => item.amountCents)),
    spentCents: sumCents(spending.filter((item) => monthOf(item.date) === month).map((item) => item.amountCents)),
    runway: { days, averageDailySpendCents: Math.round(windowSpend / runwayWindowDays), windowDays: runwayWindowDays }
  };
}
