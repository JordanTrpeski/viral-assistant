// Runs a validated chat action against Finance and plans how to undo it. Only the confirm route calls this.
import { ValidationError } from "../errors.js";
import type { BudgetTarget, FinanceDocument, Transaction } from "../finance.js";
import { monthOf, type IsoDate } from "../shared/dates.js";
import { formatCents } from "../shared/money.js";
import { financeSummary } from "../summary.js";
import type { ResolvedAction } from "./validate.js";

/** The Finance operations chat commands need; FinanceService satisfies it. Chat never touches finance.json directly. */
export interface FinanceCommandPort {
  snapshot(): Promise<FinanceDocument>;
  getTransaction(id: string): Promise<Transaction>;
  createTransaction(body: unknown): Promise<Transaction>;
  updateTransaction(id: string, body: unknown): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;
  restoreTransaction(record: Transaction): Promise<Transaction>;
  setTarget(categoryId: string, body: unknown): Promise<BudgetTarget>;
}

/** How to reverse one chat write, plus what the data must still look like for the reverse to be safe. */
type Fields = { amountCents: number; categoryId: string; note: string; date: IsoDate };

export type UndoPlan =
  | { kind: "delete-created"; transactionId: string; expect: Fields }
  | { kind: "restore-fields"; transactionId: string; previous: Fields; expect: Fields }
  | { kind: "restore-deleted"; record: Transaction }
  | { kind: "restore-target"; categoryId: string; field: "weeklyCents" | "monthlyCents"; previousCents: number; expectCents: number };

export interface ExecutionResult {
  entry: Transaction | BudgetTarget | { deleted: Transaction };
  undo: UndoPlan;
  /** Set when the action created a transaction, so "last" can refer to it. */
  createdTransactionId: string | null;
}

/** The values a chat write leaves behind; undo only proceeds if the transaction still has exactly these. */
function fieldsOf(transaction: Transaction): Fields {
  return { amountCents: transaction.amountCents, categoryId: transaction.categoryId, note: transaction.note, date: transaction.date };
}

function unchanged(current: Transaction, expect: Fields): boolean {
  const now = fieldsOf(current);
  return now.amountCents === expect.amountCents && now.categoryId === expect.categoryId && now.note === expect.note && now.date === expect.date;
}

export async function executeAction(action: ResolvedAction, finance: FinanceCommandPort): Promise<ExecutionResult> {
  switch (action.action) {
    case "add_expense":
    case "add_income": {
      const created = await finance.createTransaction({ categoryId: action.categoryId, amountCents: action.amountCents, date: action.date, note: action.note, source: "chat" });
      return { entry: created, undo: { kind: "delete-created", transactionId: created.id, expect: fieldsOf(created) }, createdTransactionId: created.id };
    }
    case "edit_transaction": {
      const before = await finance.getTransaction(action.transactionId);
      const after = await finance.updateTransaction(action.transactionId, action.changes);
      return { entry: after, undo: { kind: "restore-fields", transactionId: after.id, previous: fieldsOf(before), expect: fieldsOf(after) }, createdTransactionId: null };
    }
    case "delete_transaction": {
      const record = await finance.getTransaction(action.transactionId);
      await finance.deleteTransaction(action.transactionId);
      return { entry: { deleted: record }, undo: { kind: "restore-deleted", record }, createdTransactionId: null };
    }
    case "set_budget_target": {
      const field = action.period === "week" ? "weeklyCents" : "monthlyCents";
      const current = (await finance.snapshot()).targets.find((target) => target.categoryId === action.categoryId);
      const saved = await finance.setTarget(action.categoryId, { [field]: action.amountCents });
      return { entry: saved, undo: { kind: "restore-target", categoryId: action.categoryId, field, previousCents: current?.[field] ?? 0, expectCents: action.amountCents }, createdTransactionId: null };
    }
    case "get_balance":
      throw new ValidationError("get_balance is read-only and is answered directly, not confirmed");
  }
}

const changedSince = "it was changed after the chat write, so undo would overwrite that change";

/** Reverses a chat write, refusing if the data no longer matches what the write left behind. */
export async function undoAction(plan: UndoPlan, finance: FinanceCommandPort): Promise<Transaction | BudgetTarget | { removed: string }> {
  switch (plan.kind) {
    case "delete-created": {
      const current = await finance.getTransaction(plan.transactionId).catch(() => null);
      if (!current) throw new ValidationError("Cannot undo: the added transaction no longer exists");
      if (!unchanged(current, plan.expect)) throw new ValidationError(`Cannot undo: ${changedSince}`);
      await finance.deleteTransaction(plan.transactionId);
      return { removed: plan.transactionId };
    }
    case "restore-fields": {
      const current = await finance.getTransaction(plan.transactionId).catch(() => null);
      if (!current) throw new ValidationError("Cannot undo: the edited transaction no longer exists");
      if (!unchanged(current, plan.expect)) throw new ValidationError(`Cannot undo: ${changedSince}`);
      return finance.updateTransaction(plan.transactionId, plan.previous);
    }
    case "restore-deleted":
      return finance.restoreTransaction(plan.record);
    case "restore-target": {
      const current = (await finance.snapshot()).targets.find((target) => target.categoryId === plan.categoryId);
      if ((current?.[plan.field] ?? 0) !== plan.expectCents) throw new ValidationError(`Cannot undo: the target ${changedSince}`);
      return finance.setTarget(plan.categoryId, { [plan.field]: plan.previousCents });
    }
  }
}

/** The read-only answer to get_balance. */
export async function balanceReply(finance: FinanceCommandPort, today: IsoDate): Promise<string> {
  const summary = financeSummary(await finance.snapshot(), monthOf(today), today);
  return `Your balance is ${formatCents(summary.balanceCents)} (opening balance plus income minus spending up to today).`;
}
