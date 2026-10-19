import assert from "node:assert/strict";
import test from "node:test";
import { ChatService } from "../src/dashboard/chat.js";
import { FinanceService } from "../src/dashboard/finance.js";
import { createDashboardContext } from "../src/dashboard/server.js";
import type { LocalInferenceResult, LocalModel, LocalModelProbe } from "../src/local/types.js";
import { clockAt, withTempDir } from "./dashboard-helpers.js";

const today = "2026-10-14";

/** A fake loopback model that COUNTS its calls, scripted by the message text. Arithmetic must never call it. */
function spyModel(reply: (text: string) => string = () => '{"action":"none"}'): { model: LocalModel; calls: () => number } {
  const probe: LocalModelProbe = {
    provider: "ollama", displayName: "Ollama", executable: "ollama", installed: true, running: true, usable: true,
    version: "test", models: ["m"], preferredModel: "m", diagnostics: []
  };
  let calls = 0;
  const model: LocalModel = {
    id: "ollama", displayName: "Ollama",
    probe: () => Promise.resolve(probe),
    infer: (request) => {
      calls += 1;
      const text = (request.input.split("Message: ").pop() ?? "").trim();
      const inference: LocalInferenceResult = {
        provider: "ollama", model: "m", succeeded: true, output: reply(text), startedAt: "", finishedAt: "",
        durationMs: 1, statusCode: 200, timedOut: false, cancelled: false, error: null, diagnostics: []
      };
      return Promise.resolve(inference);
    }
  };
  return { model, calls: () => calls };
}

interface Harness { chat: ChatService; finance: FinanceService; calls: () => number }

async function withChat(body: (harness: Harness) => Promise<void>, reply?: (text: string) => string): Promise<void> {
  await withTempDir(async (directory) => {
    const spy = spyModel(reply);
    const context = createDashboardContext({
      dataDir: directory, budgetStepCents: 1_000, chatMaxAmountCents: 500_000, clock: clockAt(today),
      localModel: spy.model, chat: { model: "m", timeoutMs: 30_000, proposerEnabled: true }
    });
    await body({ chat: context.chat, finance: context.finance, calls: spy.calls });
  });
}

/** Establishes a confirmed Groceries weekly target from a bare arithmetic phrase — entirely in code, no model. */
async function confirmGroceriesWeekly(chat: ChatService, phrase: string): Promise<void> {
  const question = await chat.postMessage("main", { text: phrase });
  assert.equal(question.outcome, "question", `expected a target question for "${phrase}"`);
  const answered = await chat.answerTargetQuestion(question.targetQuestion!.id, { category: "Groceries", period: "week" });
  await chat.confirm(answered.proposal.id);
}

test("arithmetic: a bare 'divide that by 4' with reference 80 asks which target, makes no proposal, and never calls the model", async () => {
  await withChat(async ({ chat, calls }) => {
    await confirmGroceriesWeekly(chat, "double 40"); // the last amount in the thread becomes €80
    const result = await chat.postMessage("main", { text: "divide that by 4" });
    assert.equal(result.outcome, "question");
    assert.equal(result.proposal, undefined, "a bare arithmetic phrase never produces a proposal directly");
    assert.ok(result.targetQuestion, "a which-target question is returned");
    assert.equal(result.targetQuestion!.preview, "€20.00 for which target?");
    assert.equal(result.targetQuestion!.working, "80 ÷ 4 = 20");
    assert.equal(calls(), 0, "the model is not called for arithmetic messages");
  });
});

test("arithmetic: answering the which-target question with the weekly Groceries target proposes €20.00 with its working, and confirming writes once", async () => {
  await withChat(async ({ chat, finance, calls }) => {
    await confirmGroceriesWeekly(chat, "double 40"); // Groceries weekly target is now €80
    const question = await chat.postMessage("main", { text: "divide that by 4" });
    const answered = await chat.answerTargetQuestion(question.targetQuestion!.id, { category: "Groceries", period: "week" });
    assert.match(answered.proposal.preview, /^Set Groceries weekly target to €20\.00 \(now €80\.00\) \(80 ÷ 4 = 20\)$/);
    await chat.confirm(answered.proposal.id);
    const target = (await finance.snapshot()).targets.find((entry) => entry.categoryId === "groceries");
    assert.equal(target?.weeklyCents, 2_000, "confirming wrote the €20 weekly target");
    await assert.rejects(() => chat.confirm(answered.proposal.id), /already confirmed/, "a second confirm does not write again");
    assert.equal(calls(), 0);
  });
});

test("arithmetic: 'set groceries weekly target to half of 80' needs no question and proposes €40.00 with its working", async () => {
  await withChat(async ({ chat, calls }) => {
    const result = await chat.postMessage("main", { text: "set groceries weekly target to half of 80" });
    assert.equal(result.outcome, "proposal");
    assert.match(result.reply.text, /^Set Groceries weekly target to €40\.00 \(now €0\.00\) \(half of 80 = 40\)$/);
    assert.equal(calls(), 0);
  });
});

test("arithmetic: '10% of 250' with no target asks which target; naming the monthly Groceries target proposes €25.00 with its working", async () => {
  await withChat(async ({ chat }) => {
    const bare = await chat.postMessage("main", { text: "10% of 250" });
    assert.equal(bare.outcome, "question");
    assert.equal(bare.targetQuestion!.preview, "€25.00 for which target?");
    assert.equal(bare.targetQuestion!.working, "10% of 250 = 25");
    const named = await chat.postMessage("main", { text: "set groceries monthly target to 10% of 250" });
    assert.equal(named.outcome, "proposal");
    assert.match(named.reply.text, /^Set Groceries monthly target to €25\.00 \(now €0\.00\) \(10% of 250 = 25\)$/);
  });
});

test("arithmetic: 'double it' with reference 15 asks which target", async () => {
  await withChat(async ({ chat }) => {
    await confirmGroceriesWeekly(chat, "half of 30"); // the last amount becomes €15
    const result = await chat.postMessage("main", { text: "double it" });
    assert.equal(result.outcome, "question");
    assert.equal(result.targetQuestion!.preview, "€30.00 for which target?");
    assert.equal(result.targetQuestion!.working, "double 15 = 30");
  });
});

test("arithmetic: the which-target default is marked '(last changed)' only after a target was changed in the thread", async () => {
  await withChat(async ({ chat }) => {
    const first = await chat.postMessage("main", { text: "half of 50" });
    assert.equal(first.outcome, "question");
    assert.deepEqual(first.targetQuestion!.options.map((option) => option.default), [false, false], "no default before any target is changed");
    assert.ok(first.targetQuestion!.options.every((option) => !option.label.includes("(last changed)")));

    await confirmGroceriesWeekly(chat, "double 40"); // changes the weekly Groceries target
    const second = await chat.postMessage("main", { text: "half of 50" });
    const weekly = second.targetQuestion!.options.find((option) => option.period === "week")!;
    const monthly = second.targetQuestion!.options.find((option) => option.period === "month")!;
    assert.equal(weekly.default, true);
    assert.match(weekly.label, /\(last changed\)$/);
    assert.equal(monthly.default, false);
  });
});

test("arithmetic: 'Other…' rejects an invalid category or period with the existing errors", async () => {
  await withChat(async ({ chat }) => {
    const question = await chat.postMessage("main", { text: "divide 80 by 4" });
    assert.equal(question.outcome, "question");
    await assert.rejects(
      () => chat.answerTargetQuestion(question.targetQuestion!.id, { category: "Yachts", period: "week" }),
      /category "Yachts" is not an existing Flexible category/
    );
    await assert.rejects(
      () => chat.answerTargetQuestion(question.targetQuestion!.id, { category: "Groceries", period: "fortnight" }),
      /period must be "week" or "month"/
    );
  });
});

test("arithmetic: a named spending category stays an expense — 'half of 60 on groceries' adds €30.00 with its working", async () => {
  await withChat(async ({ chat, calls }) => {
    const half = await chat.postMessage("main", { text: "half of 60 on groceries" });
    assert.equal(half.outcome, "proposal");
    assert.match(half.reply.text, /^Add expense €30\.00 · Groceries · 2026-10-14 \(today\) \(half of 60 = 30\)$/);

    const twice = await chat.postMessage("main", { text: "double 15 on groceries" });
    assert.match(twice.reply.text, /^Add expense €30\.00 · Groceries · 2026-10-14 \(today\) \(double 15 = 30\)$/);

    const percent = await chat.postMessage("main", { text: "10% of 250 on groceries" });
    assert.match(percent.reply.text, /^Add expense €25\.00 · Groceries · 2026-10-14 \(today\) \(10% of 250 = 25\)$/);

    const divide = await chat.postMessage("main", { text: "divide 10 by 3 on groceries" });
    assert.match(divide.reply.text, /^Add expense €3\.33 · Groceries · 2026-10-14 \(today\) \(10 ÷ 3 = 3\.33\)$/);

    assert.equal(calls(), 0, "arithmetic expenses are also decided in code, not the model");
  });
});

test("arithmetic: 'split 60 between 3' is not calculated — it asks share-or-total and makes no proposal", async () => {
  await withChat(async ({ chat }) => {
    const result = await chat.postMessage("main", { text: "split 60 between 3 on groceries" });
    assert.equal(result.outcome, "invalid");
    assert.equal(result.proposal, undefined);
    assert.match(result.reply.text, /^Do you want your share of €60\.00, or the total for everyone\?$/);
  });
});
