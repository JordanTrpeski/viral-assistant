import type { FinanceDocument, TransactionKind } from "./finance.js";
import type { ColourCategory } from "./shared/colours.js";
import type { IsoDate } from "./shared/dates.js";

export type TimelineSource = "transaction" | "reminder" | "prepare";
export type TimelineStatus = "scheduled" | "done";

/** One dated entry shown on the calendar, in Next 7 days and in Reminders, derived from a source record. */
export interface TimelineItem {
  /** Stable per source record: `<source>:<sourceId>`. */
  id: string;
  date: IsoDate;
  source: TimelineSource;
  sourceId: string;
  label: string;
  colour: ColourCategory;
  status: TimelineStatus;
  amountCents: number | null;
  prepareBy: IsoDate | null;
}

export function colourForTransaction(kind: TransactionKind): ColourCategory {
  return kind === "bill" ? "bills" : kind === "income" ? "income" : "spending";
}

/** Bills, income and spending as timeline items; anything dated today or earlier counts as done. */
export function transactionTimelineItems(document: FinanceDocument, today: IsoDate): TimelineItem[] {
  const names = new Map(document.categories.map((category) => [category.id, category.name]));
  return document.transactions.map((transaction) => ({
    id: `transaction:${transaction.id}`,
    date: transaction.date,
    source: "transaction",
    sourceId: transaction.id,
    label: transaction.note || names.get(transaction.categoryId) || transaction.categoryId,
    colour: colourForTransaction(transaction.kind),
    status: transaction.date <= today ? "done" : "scheduled",
    amountCents: transaction.amountCents,
    prepareBy: null
  }));
}

/** Days before a personal date that "prepare by" defaults to. */
export const defaultPrepareDays = 14;

/**
 * For every item with a prepare-by date, a separate grey Reminder entry on that date ("Prepare: <label>"),
 * so preparation shows on the calendar and in Reminders alongside the date itself.
 */
export function prepareEntries(items: TimelineItem[], today: IsoDate): TimelineItem[] {
  return items.filter((item) => item.prepareBy !== null && item.source !== "prepare").map((item) => ({
    id: `prepare:${item.sourceId}`,
    date: item.prepareBy!,
    source: "prepare",
    sourceId: item.sourceId,
    label: `Prepare: ${item.label}`,
    colour: "reminder",
    status: item.status === "done" || item.prepareBy! < today ? "done" : "scheduled",
    amountCents: null,
    prepareBy: null
  }));
}

/** Stable display order within a day: bills, income, gym, viral, personal, spending, reminder, then label. */
export function sortTimeline(items: TimelineItem[]): TimelineItem[] {
  const order: ColourCategory[] = ["bills", "income", "gym", "viral", "personal", "spending", "reminder"];
  return items.sort((left, right) =>
    left.date.localeCompare(right.date) || order.indexOf(left.colour) - order.indexOf(right.colour) || left.label.localeCompare(right.label));
}
