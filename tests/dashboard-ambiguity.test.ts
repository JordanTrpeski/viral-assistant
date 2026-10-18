import assert from "node:assert/strict";
import test from "node:test";
import { findAmbiguity } from "../src/dashboard/commands/ambiguity.js";
import { StubProposer } from "../src/dashboard/commands/proposer.js";
import type { ChatMessageView, ClarificationView, ConfirmResult, PostResult, ProposalView } from "../src/dashboard/chat.js";
import { defaultCategories, type Transaction } from "../src/dashboard/finance.js";
import { createDashboardContext, startDashboardServer } from "../src/dashboard/server.js";
import { withTempDir } from "./dashboard-helpers.js";

interface ChatHarness {
  call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }>;
  say(text: string, proposal?: { action: string; fields?: Record<string, unknown> }): Promise<PostResult>;
  transactions(): Promise<Transaction[]>;
  advance(ms: number): void;
}

async function withChat(body: (harness: ChatHarness) => Promise<void>): Promise<void> {
  await withTempDir(async (directory) => {
    let now = new Date(2026, 9, 14, 12, 0, 0).getTime();
    const proposer = new StubProposer();
    const context = createDashboardContext({ dataDir: directory, budgetStepCents: 1_000, chatMaxAmountCents: 500_000, proposer, clock: () => new Date(now) });
    const server = await startDashboardServer(context, "127.0.0.1", 0);
    const call = async <T>(method: string, path: string, payload?: unknown): Promise<{ status: number; body: T }> => {
      const init: RequestInit = method === "GET" ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload ?? {}) };
      const response = await fetch(`http://127.0.0.1:${server.port}${path}`, init);
      const text = await response.text();
      return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
    };
    try {
      await body({
        call,
        async say(text, proposal) {
          if (proposal) proposer.proposeNext(proposal); else proposer.next = { kind: "reply", text: "Chat is not connected to a model yet." };
          const response = await call<PostResult>("POST", "/api/chat/threads/main/messages", { text });
          assert.equal(response.status, 201, JSON.stringify(response.body));
          return response.body;
        },
        transactions: () => context.finance.listTransactions(),
        advance: (ms) => { now += ms; }
      });
    } finally {
      await server.stop();
    }
  });
}

test("findAmbiguity: drops candidate names that are not real categories; a word with none left is not ambiguous", () => {
  // Default categories include Entertainment and Groceries, but not Spending or Personal.
  assert.deepEqual(findAmbiguity("coffee 2.50 at hofer", defaultCategories), { word: "coffee", candidates: ["Entertainment", "Groceries"] });
  assert.deepEqual(findAmbiguity("drinks 8", defaultCategories), { word: "drinks", candidates: ["Entertainment"] }, "Spending dropped");
  assert.equal(findAmbiguity("gift 20", defaultCategories), null, "Personal and Spending both dropped, so gift has no candidates");
  assert.equal(findAmbiguity("coffee with groceries 2.50", defaultCategories), null, "a real category name in the text means there is nothing to ask");
});

test("ambiguous word with no category named: returns a question, stores no pending proposal, writes nothing", async () => {
  await withChat(async ({ say, call, transactions }) => {
    const posted = await say("coffee 2.50 at hofer", { action: "add_expense", fields: { amount: 2.5, category: "Entertainment", note: "coffee at hofer" } });
    assert.equal(posted.outcome, "question");
    assert.equal(posted.proposal, undefined);
    assert.equal(posted.clarification?.preview, "Coffee, €2.50. Which category?");
    assert.deepEqual(posted.clarification?.candidates, ["Entertainment", "Groceries"]);
    assert.match(posted.clarification!.id, /^[0-9a-f]{8}$/);
    assert.deepEqual(await transactions(), []);
    const messages = (await call<ChatMessageView[]>("GET", "/api/chat/threads/main/messages")).body;
    assert.deepEqual(messages.map((message) => [message.role, message.kind]), [["user", "text"], ["assistant", "question"]]);
    assert.equal(messages.filter((message) => message.proposal).length, 0);
  });
});

test("a category named in the message skips the question and proposes directly", async () => {
  await withChat(async ({ say }) => {
    const posted = await say("coffee groceries 2.50", { action: "add_expense", fields: { amount: 2.5, category: "Groceries" } });
    assert.equal(posted.outcome, "proposal");
    assert.match(posted.proposal!.preview, /Add expense €2\.50 · Groceries/);
  });
});

test("answering a question with a candidate makes a pending proposal; confirming writes once; the word is then remembered", async () => {
  await withChat(async ({ say, call, transactions }) => {
    const question = await say("coffee 2.50", { action: "add_expense", fields: { amount: 2.5, category: "Entertainment" } });
    const answered = await call<{ proposal: ProposalView }>("POST", `/api/chat/clarifications/${question.clarification!.id}/answer`, { category: "Entertainment" });
    assert.equal(answered.status, 200);
    assert.match(answered.body.proposal.preview, /Add expense €2\.50 · Entertainment/);
    assert.equal(answered.body.proposal.status, "pending");
    assert.deepEqual(await transactions(), [], "answering writes nothing");

    const confirmed = await call<ConfirmResult>("POST", `/api/chat/proposals/${answered.body.proposal.id}/confirm`);
    assert.equal(confirmed.status, 200);
    assert.deepEqual([(confirmed.body.entry as Transaction).amountCents, (confirmed.body.entry as Transaction).categoryId], [250, "entertainment"]);
    assert.equal((await transactions()).length, 1);

    // The same word now proposes directly with the remembered category, asking nothing.
    const again = await say("coffee 4", { action: "add_expense", fields: { amount: 4, category: "Groceries" } });
    assert.equal(again.outcome, "proposal", "remembered word is not asked again");
    assert.match(again.proposal!.preview, /Add expense €4\.00 · Entertainment/, "uses the remembered category, not the stub's guess");
  });
});

test("answering with an invalid category is rejected with the existing category error", async () => {
  await withChat(async ({ say, call }) => {
    const question = await say("coffee 2.50", { action: "add_expense", fields: { amount: 2.5, category: "Entertainment" } });
    const answered = await call<{ error: string }>("POST", `/api/chat/clarifications/${question.clarification!.id}/answer`, { category: "Yachts" });
    assert.equal(answered.status, 400);
    assert.match(answered.body.error, /category "Yachts" is not an existing Fixed or Flexible category; choose one of:/);
  });
});

test("an expired clarification cannot be answered; unknown ids are 404", async () => {
  await withChat(async ({ say, call, advance }) => {
    const question = await say("coffee 2.50", { action: "add_expense", fields: { amount: 2.5, category: "Entertainment" } });
    advance(10 * 60_000 + 1);
    const expired = await call<{ error: string }>("POST", `/api/chat/clarifications/${question.clarification!.id}/answer`, { category: "Entertainment" });
    assert.equal(expired.status, 400);
    assert.match(expired.body.error, /expired at .*; send the request again/);
    assert.equal((await call("POST", "/api/chat/clarifications/0badc0de/answer", { category: "Entertainment" })).status, 404);
    assert.equal((await call("POST", "/api/chat/clarifications/not-an-id/answer", { category: "Entertainment" })).status, 404);
  });
});
