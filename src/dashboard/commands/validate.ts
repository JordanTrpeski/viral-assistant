// Plain-code validation of a proposed chat action. No model is involved: the proposal is untrusted input,
// and every failed check is reported as one plain sentence naming the field and the reason.
import type { BudgetTarget, Category, Transaction } from "../finance.js";
import { addDays, isIsoDate, weekdayMondayFirst, type IsoDate } from "../shared/dates.js";
import { formatCents } from "../shared/money.js";
import { actionNames, actions, isActionName, type ActionName, type RawProposal } from "./actions.js";

export const earliestYear = 2000;
export const maxNoteLength = 500;

/** Everything validation may look at; built from a snapshot so validation itself does no I/O. */
export interface ValidationContext {
  today: IsoDate;
  /** Largest amount a chat proposal may carry, in cents (config: dashboard.chatMaxAmountCents). */
  maxAmountCents: number;
  categories: readonly Category[];
  transactions: readonly Transaction[];
  targets: readonly BudgetTarget[];
  /** The most recent transaction created from this chat thread, or null. */
  lastChatTransactionId: string | null;
}

export type ResolvedAction =
  | { action: "add_expense" | "add_income"; categoryId: string; amountCents: number; date: IsoDate; note: string }
  | { action: "edit_transaction"; transactionId: string; changes: { amountCents?: number; categoryId?: string; note?: string; date?: IsoDate } }
  | { action: "delete_transaction"; transactionId: string }
  | { action: "set_budget_target"; categoryId: string; period: "week" | "month"; amountCents: number }
  | { action: "get_balance" };

export type ValidationResult =
  | { ok: true; action: ResolvedAction; preview: string; flags: string[] }
  | { ok: false; errors: string[] };

const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const quote = (value: unknown): string => (typeof value === "string" ? `"${value}"` : JSON.stringify(value) ?? String(value));

/** EUR number → cents, rounding half up; the tiny offset absorbs binary float error (12.345 → 1235). */
export function eurosToCents(value: number): number {
  return Math.round(value * 100 + 1e-9);
}

function resolveAmount(value: unknown, context: ValidationContext, errors: string[]): number | undefined {
  if (typeof value !== "number") {
    errors.push(`amount must be a number in EUR, for example 12.50, not ${quote(value)}.`);
    return undefined;
  }
  if (!Number.isFinite(value)) {
    errors.push("amount must be a finite number.");
    return undefined;
  }
  const cents = eurosToCents(value);
  if (value <= 0 || cents < 1) {
    errors.push("amount must be greater than 0.");
    return undefined;
  }
  if (cents > context.maxAmountCents) {
    errors.push(`amount ${formatCents(cents)} is above the ${formatCents(context.maxAmountCents)} limit for chat entries.`);
    return undefined;
  }
  return cents;
}

/** Exact name (or id) first, then case-insensitive; never creates a category. */
function resolveCategory(value: unknown, candidates: readonly Category[], kindLabel: string, errors: string[]): Category | undefined {
  const valid = candidates.map((category) => category.name).join(", ") || "none";
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`category must be the name of an existing ${kindLabel} category; choose one of: ${valid}.`);
    return undefined;
  }
  const exact = candidates.find((category) => category.name === value || category.id === value);
  if (exact) return exact;
  const folded = value.trim().toLowerCase();
  const loose = candidates.find((category) => category.name.toLowerCase() === folded || category.id === folded);
  if (loose) return loose;
  errors.push(`category ${quote(value)} is not an existing ${kindLabel} category; choose one of: ${valid}.`);
  return undefined;
}

/**
 * today / yesterday / tomorrow; a weekday name means its most recent occurrence on or before today;
 * "last <weekday>" is strictly before today and "next <weekday>" strictly after; or an ISO date.
 */
export function resolveDateWord(value: string, today: IsoDate): IsoDate | null {
  const word = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (word === "today") return today;
  if (word === "yesterday") return addDays(today, -1);
  if (word === "tomorrow") return addDays(today, 1);
  const match = /^(last |next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.exec(word);
  if (match) {
    const wanted = weekdays.indexOf(match[2]!);
    const current = weekdayMondayFirst(today);
    if (match[1] === "next ") return addDays(today, ((wanted - current + 6) % 7) + 1);
    const back = (current - wanted + 7) % 7;
    return addDays(today, -(match[1] === "last " ? back || 7 : back));
  }
  if (isIsoDate(value.trim())) return value.trim();
  return null;
}

function resolveDate(value: unknown, context: ValidationContext, errors: string[]): IsoDate | undefined {
  if (typeof value !== "string") {
    errors.push(`date must be text such as "today", "yesterday", a weekday name or YYYY-MM-DD, not ${quote(value)}.`);
    return undefined;
  }
  const resolved = resolveDateWord(value, context.today);
  if (resolved === null) {
    errors.push(`date ${quote(value)} is not a date I understand; use today, yesterday, tomorrow, a weekday name or YYYY-MM-DD.`);
    return undefined;
  }
  if (Number(resolved.slice(0, 4)) < earliestYear) {
    errors.push(`date ${resolved} is before ${earliestYear}; earlier dates are not accepted.`);
    return undefined;
  }
  return resolved;
}

function resolveNote(value: unknown, errors: string[]): string | undefined {
  if (typeof value !== "string" || value.length > maxNoteLength) {
    errors.push(`note must be text of at most ${maxNoteLength} characters.`);
    return undefined;
  }
  return value.trim();
}

function resolveTarget(value: unknown, context: ValidationContext, errors: string[]): Transaction | undefined {
  if (value === "last") {
    if (context.lastChatTransactionId === null) {
      errors.push("target \"last\" has nothing to refer to: no transaction has been added in this chat thread yet.");
      return undefined;
    }
    const found = context.transactions.find((transaction) => transaction.id === context.lastChatTransactionId);
    if (!found) errors.push("target \"last\" refers to a transaction from this chat that no longer exists.");
    return found;
  }
  if (typeof value !== "string" || value.trim() === "") {
    errors.push("target must be \"last\" or the id of an existing transaction.");
    return undefined;
  }
  const found = context.transactions.find((transaction) => transaction.id === value.trim());
  if (!found) errors.push(`target ${quote(value)} is not an existing transaction id.`);
  return found;
}

/** Future dates are allowed only for bills (Fixed categories); they are flagged in the preview. */
function checkFuture(date: IsoDate | undefined, category: Category | undefined, context: ValidationContext, errors: string[], flags: string[]): void {
  if (date === undefined || date <= context.today || category === undefined) return;
  if (category.kind === "fixed") flags.push("future date");
  else errors.push(`date ${date} is in the future; only bills in a Fixed category can be dated in the future.`);
}

function describeDate(date: IsoDate, today: IsoDate): string {
  if (date === today) return `${date} (today)`;
  if (date === addDays(today, -1)) return `${date} (yesterday)`;
  if (date === addDays(today, 1)) return `${date} (tomorrow)`;
  return date;
}

function describeTransaction(transaction: Transaction, categories: readonly Category[]): string {
  const name = categories.find((category) => category.id === transaction.categoryId)?.name ?? transaction.categoryId;
  return `${transaction.note ? `"${transaction.note}" ` : ""}${formatCents(transaction.amountCents)} · ${name} · ${transaction.date}`;
}

const flagText = (flags: string[]): string => (flags.length ? ` (${flags.join(", ")})` : "");

export function validateProposal(raw: RawProposal, context: ValidationContext): ValidationResult {
  if (!isActionName(raw.action)) {
    return { ok: false, errors: [`action ${quote(raw.action)} is not one of the allowed actions: ${actionNames.join(", ")}.`] };
  }
  const name: ActionName = raw.action;
  const definition = actions[name];
  const errors: string[] = [];
  const flags: string[] = [];
  const fields = raw.fields === undefined || raw.fields === null ? {} : raw.fields;
  if (typeof fields !== "object" || Array.isArray(fields)) return { ok: false, errors: ["fields must be an object of named values."] };
  const given = fields as Record<string, unknown>;
  for (const key of Object.keys(given)) if (!(key in definition.fields)) errors.push(`field ${quote(key)} is not part of ${name}.`);
  for (const [key, spec] of Object.entries(definition.fields)) if (spec.required && given[key] === undefined) errors.push(`${key} is required for ${name}.`);
  const has = (key: string): boolean => key in definition.fields && given[key] !== undefined;

  const spending = context.categories.filter((category) => category.kind !== "income");
  const income = context.categories.filter((category) => category.kind === "income");
  const flexible = context.categories.filter((category) => category.kind === "flexible");

  switch (name) {
    case "add_expense":
    case "add_income": {
      const amountCents = has("amount") ? resolveAmount(given.amount, context, errors) : undefined;
      const category = has("category") ? resolveCategory(given.category, name === "add_income" ? income : spending, name === "add_income" ? "Income" : "Fixed or Flexible", errors) : undefined;
      const date = has("date") ? resolveDate(given.date, context, errors) : context.today;
      const note = has("note") ? resolveNote(given.note, errors) : "";
      checkFuture(date, category, context, errors, flags);
      if (errors.length || amountCents === undefined || !category || date === undefined || note === undefined) return { ok: false, errors };
      const verb = name === "add_income" ? "Add income" : category.kind === "fixed" ? "Add bill" : "Add expense";
      return { ok: true, action: { action: name, categoryId: category.id, amountCents, date, note }, flags,
        preview: `${verb} ${formatCents(amountCents)} · ${category.name} · ${describeDate(date, context.today)}${note ? ` · "${note}"` : ""}${flagText(flags)}` };
    }
    case "edit_transaction": {
      const transaction = has("target") ? resolveTarget(given.target, context, errors) : undefined;
      const current = transaction ? context.categories.find((category) => category.id === transaction.categoryId) : undefined;
      const group = !current ? context.categories : current.kind === "income" ? income : spending;
      const changes: { amountCents?: number; categoryId?: string; note?: string; date?: IsoDate } = {};
      if (!["amount", "category", "note", "date"].some(has)) errors.push("edit_transaction needs at least one of amount, category, note or date to change.");
      const amountCents = has("amount") ? resolveAmount(given.amount, context, errors) : undefined;
      const category = has("category") ? resolveCategory(given.category, group, !current ? "" : current.kind === "income" ? "Income" : "Fixed or Flexible", errors) : undefined;
      const date = has("date") ? resolveDate(given.date, context, errors) : undefined;
      const note = has("note") ? resolveNote(given.note, errors) : undefined;
      checkFuture(date ?? transaction?.date, category ?? current, context, errors, flags);
      if (errors.length || !transaction) return { ok: false, errors };
      const parts: string[] = [];
      if (amountCents !== undefined) { changes.amountCents = amountCents; parts.push(`amount → ${formatCents(amountCents)}`); }
      if (category) { changes.categoryId = category.id; parts.push(`category → ${category.name}`); }
      if (date !== undefined) { changes.date = date; parts.push(`date → ${describeDate(date, context.today)}`); }
      if (note !== undefined) { changes.note = note; parts.push(`note → "${note}"`); }
      return { ok: true, action: { action: name, transactionId: transaction.id, changes }, flags,
        preview: `Edit ${describeTransaction(transaction, context.categories)}: ${parts.join(", ")}${flagText(flags)}` };
    }
    case "delete_transaction": {
      const transaction = has("target") ? resolveTarget(given.target, context, errors) : undefined;
      if (errors.length || !transaction) return { ok: false, errors };
      return { ok: true, action: { action: name, transactionId: transaction.id }, flags, preview: `Delete ${describeTransaction(transaction, context.categories)}` };
    }
    case "set_budget_target": {
      const category = has("category") ? resolveCategory(given.category, flexible, "Flexible", errors) : undefined;
      let period: "week" | "month" | undefined;
      if (has("period")) {
        if (given.period === "week" || given.period === "month") period = given.period;
        else errors.push(`period must be "week" or "month", not ${quote(given.period)}.`);
      }
      const amountCents = has("amount") ? resolveAmount(given.amount, context, errors) : undefined;
      if (errors.length || !category || !period || amountCents === undefined) return { ok: false, errors };
      const current = context.targets.find((entry) => entry.categoryId === category.id);
      const before = current ? (period === "week" ? current.weeklyCents : current.monthlyCents) : 0;
      return { ok: true, action: { action: name, categoryId: category.id, period, amountCents }, flags,
        preview: `Set ${category.name} ${period === "week" ? "weekly" : "monthly"} target to ${formatCents(amountCents)} (now ${formatCents(before)})` };
    }
    case "get_balance":
      if (errors.length) return { ok: false, errors };
      return { ok: true, action: { action: name }, flags, preview: "Show the current balance" };
  }
}
