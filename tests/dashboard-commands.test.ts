import assert from "node:assert/strict";
import test from "node:test";
import { actionNames, actions } from "../src/dashboard/commands/actions.js";
import { StubProposer } from "../src/dashboard/commands/proposer.js";
import { eurosToCents, resolveDateWord, validateProposal, type ValidationContext, type ValidationResult } from "../src/dashboard/commands/validate.js";
import type { ChatMessageView, ConfirmResult, PostResult, ProposalView } from "../src/dashboard/chat.js";
import { defaultCategories, type BudgetTarget, type Transaction } from "../src/dashboard/finance.js";
import { startDashboardServer, createDashboardContext, type DashboardContext } from "../src/dashboard/server.js";
import { withTempDir } from "./dashboard-helpers.js";

// 2026-10-14 is a Wednesday.
const today = "2026-10-14";

function transaction(id: string, categoryId: string, extra: Partial<Transaction> = {}): Transaction {
  return { id, kind: categoryId === "salary" ? "income" : categoryId === "rent" ? "bill" : "expense", categoryId, amountCents: 1_250, date: "2026-10-13", note: "Lidl", fixed: categoryId === "rent", source: "chat", createdAt: "", updatedAt: "", ...extra };
}

function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return { today, maxAmountCents: 500_000, categories: defaultCategories, transactions: [transaction("t1", "groceries")], targets: [], lastChatTransactionId: "t1", ...overrides };
}

function errorsOf(result: ValidationResult): string[] {
  assert.equal(result.ok, false, "expected validation to fail");
  return result.ok ? [] : result.errors;
}

function okOf(result: ValidationResult): Extract<ValidationResult, { ok: true }> {
  assert.equal(result.ok, true, `expected validation to pass: ${result.ok ? "" : result.errors.join(" | ")}`);
  return result as Extract<ValidationResult, { ok: true }>;
}

test("actions: the six allowed actions, each with a name, description and field schema", () => {
  assert.deepEqual([...actionNames], ["add_expense", "add_income", "edit_transaction", "delete_transaction", "set_budget_target", "get_balance"]);
  for (const name of actionNames) {
    assert.equal(actions[name].name, name);
    assert.ok(actions[name].description.length > 10);
  }
  assert.deepEqual(Object.entries(actions.add_expense.fields).map(([key, spec]) => [key, spec.required]), [["amount", true], ["category", true], ["note", false], ["date", false]]);
  assert.deepEqual(Object.keys(actions.get_balance.fields), []);
  assert.equal(actions.get_balance.writes, false);
});

test("validate shape: unknown actions, missing required fields and unknown fields — all reported together", () => {
  assert.deepEqual(errorsOf(validateProposal({ action: "transfer_money", fields: {} }, context())), [
    "action \"transfer_money\" is not one of the allowed actions: add_expense, add_income, edit_transaction, delete_transaction, set_budget_target, get_balance."
  ]);
  assert.deepEqual(errorsOf(validateProposal({ action: "add_expense", fields: { colour: "red" } }, context())), [
    "field \"colour\" is not part of add_expense.", "amount is required for add_expense.", "category is required for add_expense."
  ]);
  assert.deepEqual(errorsOf(validateProposal({ action: "add_expense", fields: { amount: -3, category: "Boats", date: "someday" } }, context())), [
    "amount must be greater than 0.",
    "category \"Boats\" is not an existing Fixed or Flexible category; choose one of: Rent, Phone, Subscriptions, Groceries, Entertainment, Transport.",
    "date \"someday\" is not a date I understand; use today, yesterday, tomorrow, a weekday name or YYYY-MM-DD."
  ]);
  assert.deepEqual(errorsOf(validateProposal({ action: "get_balance", fields: { account: "main" } }, context())), ["field \"account\" is not part of get_balance."]);
  assert.deepEqual(errorsOf(validateProposal({ action: "add_expense", fields: [1] }, context())), ["fields must be an object of named values."]);
});

test("validate amount: positive, finite numbers rounded to cents, within the configured sanity limit", () => {
  const amount = (value: unknown, limit = 500_000): ValidationResult => validateProposal({ action: "add_expense", fields: { amount: value, category: "Groceries" } }, context({ maxAmountCents: limit }));
  assert.deepEqual(errorsOf(amount(Number.NaN)), ["amount must be a finite number."]);
  assert.deepEqual(errorsOf(amount(Number.POSITIVE_INFINITY)), ["amount must be a finite number."]);
  assert.deepEqual(errorsOf(amount(-12)), ["amount must be greater than 0."]);
  assert.deepEqual(errorsOf(amount(0)), ["amount must be greater than 0."]);
  assert.deepEqual(errorsOf(amount(0.004)), ["amount must be greater than 0."], "rounds to zero cents");
  assert.deepEqual(errorsOf(amount("12.50")), ["amount must be a number in EUR, for example 12.50, not \"12.50\"."]);
  assert.deepEqual(errorsOf(amount(5_000.01)), ["amount €5,000.01 is above the €5,000.00 limit for chat entries."]);
  assert.deepEqual(errorsOf(amount(60, 5_000)), ["amount €60.00 is above the €50.00 limit for chat entries."]);
  const ok = okOf(amount(5_000));
  assert.equal(ok.action.action === "add_expense" && ok.action.amountCents, 500_000);
  assert.deepEqual([eurosToCents(12.345), eurosToCents(0.1 + 0.2), eurosToCents(19.99), eurosToCents(0.005)], [1_235, 30, 1_999, 1]);
});

test("validate category: exact, then case-insensitive, per type; never created from a proposal", () => {
  const exact = okOf(validateProposal({ action: "add_expense", fields: { amount: 5, category: "Groceries" } }, context()));
  const loose = okOf(validateProposal({ action: "add_expense", fields: { amount: 5, category: "  groCERies " } }, context()));
  assert.equal(exact.action.action === "add_expense" && exact.action.categoryId, "groceries");
  assert.equal(loose.action.action === "add_expense" && loose.action.categoryId, "groceries");
  assert.deepEqual(errorsOf(validateProposal({ action: "add_income", fields: { amount: 5, category: "Groceries" } }, context())),
    ["category \"Groceries\" is not an existing Income category; choose one of: Salary."], "income needs an Income category");
  assert.deepEqual(errorsOf(validateProposal({ action: "add_expense", fields: { amount: 5, category: "Salary" } }, context())).length, 1, "expenses cannot use Income categories");
  assert.deepEqual(errorsOf(validateProposal({ action: "set_budget_target", fields: { category: "Rent", period: "week", amount: 100 } }, context())),
    ["category \"Rent\" is not an existing Flexible category; choose one of: Groceries, Entertainment, Transport."]);
  assert.equal(defaultCategories.length, 7, "validation never adds categories");
  const bill = okOf(validateProposal({ action: "add_expense", fields: { amount: 950, category: "rent" } }, context()));
  assert.match(bill.preview, /^Add bill €950\.00 · Rent · 2026-10-14 \(today\)$/);
});

test("validate dates: words and weekdays resolve from today; ISO accepted; before 2000 rejected; future dates allowed everywhere, flagged", () => {
  assert.deepEqual(["today", "yesterday", "tomorrow", "Monday", "wednesday", "sunday", "last wednesday", "next wednesday", "next monday", "last friday", "2026-02-28"].map((word) => resolveDateWord(word, today)),
    ["2026-10-14", "2026-10-13", "2026-10-15", "2026-10-12", "2026-10-14", "2026-10-11", "2026-10-07", "2026-10-21", "2026-10-19", "2026-10-09", "2026-02-28"]);
  assert.equal(resolveDateWord("2026-02-30", today), null);
  assert.equal(resolveDateWord("in a while", today), null);
  const add = (date: unknown, category = "Groceries"): ValidationResult => validateProposal({ action: "add_expense", fields: { amount: 5, category, date } }, context());
  assert.equal(okOf(add("yesterday")).action.action === "add_expense" && (okOf(add("yesterday")).action as { date: string }).date, "2026-10-13");
  assert.deepEqual(errorsOf(add("1999-12-31")), ["date 1999-12-31 is before 2000; earlier dates are not accepted."]);
  assert.deepEqual(errorsOf(add(20261014)), ["date must be text such as \"today\", \"yesterday\", a weekday name or YYYY-MM-DD, not 20261014."]);
  const futureExpense = okOf(add("tomorrow"));
  assert.deepEqual(futureExpense.flags, ["future date"], "a future-dated flexible expense is allowed, flagged in the preview");
  assert.equal(futureExpense.preview, "Add expense €5.00 · Groceries · 2026-10-15 (tomorrow) (future date)");
  assert.deepEqual(okOf(validateProposal({ action: "add_income", fields: { amount: 5, category: "Salary", date: "next monday" } }, context())).flags, ["future date"], "future-dated income is allowed, flagged");
  const futureBill = okOf(add("next monday", "Phone"));
  assert.deepEqual(futureBill.flags, ["future date"]);
  assert.equal(futureBill.preview, "Add bill €5.00 · Phone · 2026-10-19 (future date)");
});

test("validate targets: \"last\" is the latest transaction added in this thread; ids must exist", () => {
  assert.deepEqual(errorsOf(validateProposal({ action: "delete_transaction", fields: { target: "last" } }, context({ lastChatTransactionId: null }))),
    ["target \"last\" has nothing to refer to: no transaction has been added in this chat thread yet."]);
  assert.deepEqual(errorsOf(validateProposal({ action: "delete_transaction", fields: { target: "last" } }, context({ lastChatTransactionId: "gone" }))),
    ["target \"last\" refers to a transaction from this chat that no longer exists."]);
  assert.deepEqual(errorsOf(validateProposal({ action: "delete_transaction", fields: { target: "nope" } }, context())), ["target \"nope\" is not an existing transaction id."]);
  const deleted = okOf(validateProposal({ action: "delete_transaction", fields: { target: "last" } }, context()));
  assert.deepEqual([deleted.action, deleted.preview], [{ action: "delete_transaction", transactionId: "t1" }, "Delete \"Lidl\" €12.50 · Groceries · 2026-10-13"]);
  assert.deepEqual(errorsOf(validateProposal({ action: "edit_transaction", fields: { target: "t1" } }, context())),
    ["edit_transaction needs at least one of amount, category, note or date to change."]);
  const edit = okOf(validateProposal({ action: "edit_transaction", fields: { target: "t1", amount: 15, note: "Lidl + Aldi" } }, context()));
  assert.deepEqual(edit.action, { action: "edit_transaction", transactionId: "t1", changes: { amountCents: 1_500, note: "Lidl + Aldi" } });
  assert.equal(edit.preview, "Edit \"Lidl\" €12.50 · Groceries · 2026-10-13: amount → €15.00, note → \"Lidl + Aldi\"");
  const futureEdit = okOf(validateProposal({ action: "edit_transaction", fields: { target: "t1", date: "tomorrow" } }, context()));
  assert.deepEqual(futureEdit.flags, ["future date"], "editing a flexible expense to a future date is allowed, flagged");
  assert.equal(futureEdit.preview, "Edit \"Lidl\" €12.50 · Groceries · 2026-10-13: date → 2026-10-15 (tomorrow) (future date)");
  assert.equal(errorsOf(validateProposal({ action: "edit_transaction", fields: { target: "t1", category: "Salary" } }, context())).length, 1, "an expense cannot move to an Income category");
});

test("validate set_budget_target and get_balance", () => {
  const targets: BudgetTarget[] = [{ categoryId: "groceries", weeklyCents: 10_000, monthlyCents: 40_000 }];
  const set = okOf(validateProposal({ action: "set_budget_target", fields: { category: "groceries", period: "week", amount: 150 } }, context({ targets })));
  assert.deepEqual(set.action, { action: "set_budget_target", categoryId: "groceries", period: "week", amountCents: 15_000 });
  assert.equal(set.preview, "Set Groceries weekly target to €150.00 (now €100.00)");
  assert.deepEqual(errorsOf(validateProposal({ action: "set_budget_target", fields: { category: "Groceries", period: "daily", amount: 0 } }, context())),
    ["period must be \"week\" or \"month\", not \"daily\".", "amount must be greater than 0."]);
  assert.deepEqual(okOf(validateProposal({ action: "get_balance" }, context())).action, { action: "get_balance" });
});

interface CommandServer {
  context: DashboardContext;
  proposer: StubProposer;
  advance(milliseconds: number): void;
  call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }>;
  say(text: string, proposal?: { action: string; fields?: Record<string, unknown> }, threadId?: string): Promise<PostResult>;
  transactions(): Promise<Transaction[]>;
}

/** The real dashboard server with the stub proposer and a clock the test moves forward. */
async function withCommandServer(body: (server: CommandServer) => Promise<void>): Promise<void> {
  await withTempDir(async (directory) => {
    let now = new Date(2026, 9, 14, 12, 0, 0).getTime();
    const proposer = new StubProposer();
    const dashboard = createDashboardContext({ dataDir: directory, budgetStepCents: 1_000, proposer, clock: () => new Date(now) });
    const server = await startDashboardServer(dashboard, "127.0.0.1", 0);
    const call = async <T>(method: string, path: string, payload?: unknown): Promise<{ status: number; body: T }> => {
      const init: RequestInit = method === "GET" ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload ?? {}) };
      const response = await fetch(`http://127.0.0.1:${server.port}${path}`, init);
      const text = await response.text();
      return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
    };
    try {
      await body({
        context: dashboard, proposer, call,
        advance: (milliseconds) => { now += milliseconds; },
        async say(text, proposal, threadId = "main") {
          if (proposal) proposer.proposeNext(proposal); else proposer.next = { kind: "reply", text: "Chat is not connected to a model yet." };
          const response = await call<PostResult>("POST", `/api/chat/threads/${threadId}/messages`, { text });
          assert.equal(response.status, 201, JSON.stringify(response.body));
          return response.body;
        },
        transactions: () => dashboard.finance.listTransactions()
      });
    } finally {
      await server.stop();
    }
  });
}

test("flow: a valid proposal is stored as pending and writes nothing; confirm writes once and returns the entry and an undo token", async () => {
  await withCommandServer(async ({ say, call, transactions, proposer }) => {
    const posted = await say("spent 12.50 on groceries at Lidl", { action: "add_expense", fields: { amount: 12.5, category: "groceries", note: "Lidl" } });
    assert.equal(posted.outcome, "proposal");
    assert.equal(posted.proposal?.preview, "Add expense €12.50 · Groceries · 2026-10-14 (today) · \"Lidl\"");
    assert.match(posted.proposal!.id, /^[0-9a-f]{8}$/);
    assert.equal(posted.proposal?.status, "pending");
    assert.equal(Date.parse(posted.proposal!.expiresAt) - Date.parse(posted.proposal!.createdAt), 10 * 60_000);
    assert.deepEqual(await transactions(), [], "posting a message never writes Finance data");
    assert.deepEqual(proposer.calls.at(-1), { threadId: "main", text: "spent 12.50 on groceries at Lidl", today: "2026-10-14" });

    const confirmed = await call<ConfirmResult>("POST", `/api/chat/proposals/${posted.proposal!.id}/confirm`);
    assert.equal(confirmed.status, 200);
    const entry = confirmed.body.entry as Transaction;
    assert.deepEqual([entry.amountCents, entry.categoryId, entry.note, entry.date, entry.source, entry.kind], [1_250, "groceries", "Lidl", "2026-10-14", "chat", "expense"]);
    assert.equal(confirmed.body.proposal.status, "confirmed");
    assert.equal(Date.parse(confirmed.body.undo.expiresAt) - Date.parse("2026-10-14T10:00:00.000Z") >= 0, true);
    assert.equal((await transactions()).length, 1);
    const again = await call<{ error: string }>("POST", `/api/chat/proposals/${posted.proposal!.id}/confirm`);
    assert.deepEqual([again.status, again.body.error], [400, `Proposal ${posted.proposal!.id} is already confirmed`]);
    assert.equal((await transactions()).length, 1, "a proposal is applied at most once");

    const messages = (await call<ChatMessageView[]>("GET", "/api/chat/threads/main/messages")).body;
    assert.deepEqual(messages.map((message) => [message.role, message.kind]), [["user", "text"], ["assistant", "proposal"], ["assistant", "result"]]);
    assert.equal(messages[1]?.proposal?.status, "confirmed");
  });
});

test("future dates: a future-dated flexible expense and income validate, the preview flags (future date), and confirm writes them; before 2000 is rejected", async () => {
  await withCommandServer(async ({ say, call, transactions }) => {
    const expense = await say("groceries next monday", { action: "add_expense", fields: { amount: 20, category: "groceries", date: "next monday" } });
    assert.equal(expense.outcome, "proposal");
    assert.match(expense.proposal!.preview, /\(future date\)$/);
    const confirmedExpense = await call<ConfirmResult>("POST", `/api/chat/proposals/${expense.proposal!.id}/confirm`);
    assert.equal(confirmedExpense.status, 200);
    assert.equal((confirmedExpense.body.entry as Transaction).date, "2026-10-19");

    const income = await say("salary tomorrow", { action: "add_income", fields: { amount: 100, category: "salary", date: "tomorrow" } });
    assert.equal(income.outcome, "proposal");
    assert.match(income.proposal!.preview, /\(future date\)$/);
    const confirmedIncome = await call<ConfirmResult>("POST", `/api/chat/proposals/${income.proposal!.id}/confirm`);
    assert.equal(confirmedIncome.status, 200);
    assert.equal((confirmedIncome.body.entry as Transaction).date, "2026-10-15");

    assert.deepEqual((await transactions()).map((entry) => entry.date).sort(), ["2026-10-15", "2026-10-19"]);

    const tooOld = await say("old expense", { action: "add_expense", fields: { amount: 5, category: "groceries", date: "1999-12-31" } });
    assert.equal(tooOld.outcome, "invalid");
    assert.match(tooOld.reply.text, /before 2000/);
  });
});

test("flow: invalid proposals return every error and store nothing pending; plain replies and get_balance never propose", async () => {
  await withCommandServer(async ({ say, transactions, context, call }) => {
    const invalid = await say("spent lots", { action: "add_expense", fields: { amount: Number.NaN, category: "Yachts" } });
    assert.equal(invalid.outcome, "invalid");
    assert.equal(invalid.errors?.length, 2);
    assert.equal(invalid.proposal, undefined);
    assert.match(invalid.reply.text, /amount must be a finite number/);
    assert.match(invalid.reply.text, /category "Yachts" is not an existing/);
    const plain = await say("hello");
    assert.deepEqual([plain.outcome, plain.reply.text], ["reply", "Chat is not connected to a model yet."]);
    await context.finance.updateSettings({ openingBalanceCents: 123_456 });
    const balance = await say("what is my balance?", { action: "get_balance" });
    assert.deepEqual([balance.outcome, balance.reply.text], ["reply", "Your balance is €1,234.56 (opening balance plus income minus spending up to today)."]);
    const unknown = await say("move money", { action: "transfer", fields: {} });
    assert.equal(unknown.outcome, "invalid");
    assert.deepEqual(await transactions(), []);
    assert.equal((await call<ChatMessageView[]>("GET", "/api/chat/threads/main/messages")).body.filter((message) => message.proposal).length, 0);
  });
});

test("flow: cancel discards; unknown or malformed proposal ids are 404; proposals expire after 10 minutes", async () => {
  await withCommandServer(async ({ say, call, transactions, advance }) => {
    const first = await say("coffee 3", { action: "add_expense", fields: { amount: 3, category: "Groceries" } });
    const cancelled = await call<ProposalView>("POST", `/api/chat/proposals/${first.proposal!.id}/cancel`);
    assert.deepEqual([cancelled.status, cancelled.body.status], [200, "cancelled"]);
    assert.equal((await call("POST", `/api/chat/proposals/${first.proposal!.id}/confirm`)).status, 400);
    assert.deepEqual(await transactions(), []);
    assert.equal((await call("POST", "/api/chat/proposals/0badc0de/confirm")).status, 404);
    assert.equal((await call("POST", "/api/chat/proposals/../../x/confirm")).status, 404);
    assert.equal((await call("POST", "/api/chat/proposals/not-an-id/cancel")).status, 404);

    const second = await say("bread 2", { action: "add_expense", fields: { amount: 2, category: "Groceries" } });
    advance(10 * 60_000 - 1);
    const third = await say("milk 1", { action: "add_expense", fields: { amount: 1, category: "Groceries" } });
    advance(1);
    const expired = await call<{ error: string }>("POST", `/api/chat/proposals/${second.proposal!.id}/confirm`);
    assert.equal(expired.status, 400);
    assert.match(expired.body.error, /expired at .*; send the request again/);
    assert.equal((await call("POST", `/api/chat/proposals/${second.proposal!.id}/cancel`)).status, 400);
    const messages = (await call<ChatMessageView[]>("GET", "/api/chat/threads/main/messages")).body;
    assert.equal(messages.find((message) => message.proposalId === second.proposal!.id)?.proposal?.status, "expired");
    assert.equal((await call("POST", `/api/chat/proposals/${third.proposal!.id}/confirm`)).status, 200, "a newer proposal is still valid");
    assert.equal((await transactions()).length, 1);
  });
});

test("undo: reverses an add, an edit (previous values), a delete (same record back) and a target, within 10 seconds", async () => {
  await withCommandServer(async ({ say, call, transactions, context, advance }) => {
    const confirm = async (text: string, proposal: { action: string; fields?: Record<string, unknown> }): Promise<ConfirmResult> => {
      const posted = await say(text, proposal);
      assert.equal(posted.outcome, "proposal", JSON.stringify(posted.errors));
      const response = await call<ConfirmResult>("POST", `/api/chat/proposals/${posted.proposal!.id}/confirm`);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body;
    };
    const undo = (token: string) => call<{ error?: string; proposal: ProposalView }>("POST", `/api/chat/undo/${token}`);

    const added = await confirm("add 20 groceries", { action: "add_expense", fields: { amount: 20, category: "Groceries", note: "Market" } });
    const undone = await undo(added.undo.token);
    assert.deepEqual([undone.status, undone.body.proposal.status], [200, "undone"]);
    assert.deepEqual(await transactions(), [], "undo of an add removes it");
    assert.equal((await undo(added.undo.token)).status, 404, "an undo token works once");

    const kept = await confirm("add 30 groceries", { action: "add_expense", fields: { amount: 30, category: "Groceries", note: "Weekly shop" } });
    const keptId = (kept.entry as Transaction).id;
    const edited = await confirm("make that 35 on Monday", { action: "edit_transaction", fields: { target: "last", amount: 35, date: "monday" } });
    assert.deepEqual([(edited.entry as Transaction).amountCents, (edited.entry as Transaction).date], [3_500, "2026-10-12"]);
    assert.equal((await undo(edited.undo.token)).status, 200);
    const restored = await context.finance.getTransaction(keptId);
    assert.deepEqual([restored.amountCents, restored.date, restored.note], [3_000, "2026-10-14", "Weekly shop"], "undo of an edit restores the previous values");

    const before = await context.finance.getTransaction(keptId);
    const deleted = await confirm("delete it", { action: "delete_transaction", fields: { target: "last" } });
    assert.deepEqual(await transactions(), []);
    assert.equal((await undo(deleted.undo.token)).status, 200);
    assert.deepEqual(await context.finance.getTransaction(keptId), before, "undo of a delete puts back the same record, same id");

    await context.finance.setTarget("groceries", { weeklyCents: 10_000 });
    const target = await confirm("weekly groceries 150", { action: "set_budget_target", fields: { category: "Groceries", period: "week", amount: 150 } });
    assert.equal((target.entry as BudgetTarget).weeklyCents, 15_000);
    assert.equal((await undo(target.undo.token)).status, 200);
    assert.equal((await context.finance.listTargets()).find((entry) => entry.categoryId === "groceries")?.weeklyCents, 10_000);

    const late = await confirm("add 1", { action: "add_expense", fields: { amount: 1, category: "Transport" } });
    advance(10_001);
    const tooLate = await undo(late.undo.token);
    assert.equal(tooLate.status, 400);
    assert.match(tooLate.body.error ?? "", /10-second undo window has passed/);
    assert.equal((await transactions()).length, 2, "the late undo changed nothing");
    assert.equal((await undo("00000000-0000-4000-8000-000000000000")).status, 404);
  });
});

test("undo: only the most recent chat write, and never over a later change made in Finance", async () => {
  await withCommandServer(async ({ say, call, context }) => {
    const confirmProposal = async (amount: number): Promise<ConfirmResult> => {
      const posted = await say(`add ${amount}`, { action: "add_expense", fields: { amount, category: "Groceries" } });
      return (await call<ConfirmResult>("POST", `/api/chat/proposals/${posted.proposal!.id}/confirm`)).body;
    };
    const older = await confirmProposal(5);
    const newer = await confirmProposal(6);
    const stale = await call<{ error: string }>("POST", `/api/chat/undo/${older.undo.token}`);
    assert.deepEqual([stale.status, stale.body.error], [400, "Only the most recent chat change can be undone"]);
    await context.finance.updateTransaction((newer.entry as Transaction).id, { note: "edited in Finance" });
    const changed = await call<{ error: string }>("POST", `/api/chat/undo/${newer.undo.token}`);
    assert.equal(changed.status, 400);
    assert.match(changed.body.error, /changed after the chat write/);
    assert.equal((await context.finance.getTransaction((newer.entry as Transaction).id)).note, "edited in Finance");
  });
});

test("\"last\" is per thread: another thread's additions do not count, and an undone add is no longer last", async () => {
  await withCommandServer(async ({ say, call }) => {
    const other = (await call<{ id: string }>("POST", "/api/chat/threads", { name: "Other" })).body.id;
    const noLast = await say("delete last", { action: "delete_transaction", fields: { target: "last" } }, other);
    assert.match(noLast.errors?.[0] ?? "", /no transaction has been added in this chat thread yet/);
    const confirm = async (amount: number, threadId: string): Promise<ConfirmResult> => {
      const posted = await say(`add ${amount}`, { action: "add_expense", fields: { amount, category: "Groceries", note: `n${amount}` } }, threadId);
      return (await call<ConfirmResult>("POST", `/api/chat/proposals/${posted.proposal!.id}/confirm`)).body;
    };
    await confirm(7, "main");
    const second = await confirm(8, "main");
    await confirm(9, other);
    const lastInMain = await say("delete last", { action: "delete_transaction", fields: { target: "last" } });
    assert.equal(lastInMain.proposal?.preview, "Delete \"n8\" €8.00 · Groceries · 2026-10-14");
    await call("POST", `/api/chat/proposals/${lastInMain.proposal!.id}/cancel`);
    await confirm(10, other);
    const undoOther = await call("POST", `/api/chat/undo/${(await confirm(11, other)).undo.token}`);
    assert.equal(undoOther.status, 200);
    const lastInOther = await say("delete last", { action: "delete_transaction", fields: { target: "last" } }, other);
    assert.equal(lastInOther.proposal?.preview, "Delete \"n10\" €10.00 · Groceries · 2026-10-14", "the undone add is no longer last");
    assert.ok(second.entry);
  });
});

test("confirm re-checks the data: a proposal whose target was deleted meanwhile is refused with 400", async () => {
  await withCommandServer(async ({ say, call, context }) => {
    const created = await context.finance.createTransaction({ categoryId: "groceries", amountCents: 500, date: "2026-10-13" });
    const posted = await say("delete that", { action: "delete_transaction", fields: { target: created.id } });
    await context.finance.deleteTransaction(created.id);
    const refused = await call<{ error: string }>("POST", `/api/chat/proposals/${posted.proposal!.id}/confirm`);
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /can no longer be applied: Unknown transaction id/);
  });
});
