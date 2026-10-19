import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardContext, type DashboardContext } from "../src/dashboard/server.js";
import type { LocalInferenceResult, LocalModel, LocalModelProbe } from "../src/local/types.js";
import { clockAt, withTempDir } from "./dashboard-helpers.js";

const today = "2026-10-14";

/** A fake loopback model scripted by the message text (the prompt ends with "Message: <text>"). No real Ollama. */
function scriptedModel(reply: (text: string) => string): LocalModel {
  const probe: LocalModelProbe = {
    provider: "ollama", displayName: "Ollama", executable: "ollama", installed: true, running: true, usable: true,
    version: "test", models: ["m"], preferredModel: "m", diagnostics: []
  };
  return {
    id: "ollama", displayName: "Ollama",
    probe: () => Promise.resolve(probe),
    infer: (request) => {
      const text = (request.input.split("Message: ").pop() ?? "").trim();
      const inference: LocalInferenceResult = {
        provider: "ollama", model: "m", succeeded: true, output: reply(text), startedAt: "", finishedAt: "",
        durationMs: 1, statusCode: 200, timedOut: false, cancelled: false, error: null, diagnostics: []
      };
      return Promise.resolve(inference);
    }
  };
}

function expense(amount: number): string {
  return `{"action":"add_expense","fields":{"amount":${amount},"category":"Groceries"}}`;
}

async function withChat(reply: (text: string) => string, body: (chat: DashboardContext["chat"]) => Promise<void>): Promise<void> {
  await withTempDir(async (directory) => {
    const context = createDashboardContext({
      dataDir: directory, budgetStepCents: 1_000, chatMaxAmountCents: 500_000, clock: clockAt(today),
      localModel: scriptedModel(reply), chat: { model: "m", timeoutMs: 30_000, proposerEnabled: true }
    });
    await body(context.chat);
  });
}

/** Captures console.error for the duration of `body`, restoring it afterwards. */
async function captureErrors(body: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { await body(); } finally { console.error = original; }
  return lines;
}

test("arithmetic: 'divide that by 4' after an earlier 80 sets the target to 20.00 with its working, overriding the model and logging the difference", async () => {
  await withChat(
    (text) => (/divide that by 4/i.test(text) ? '{"action":"set_budget_target","fields":{"category":"Groceries","period":"week","amount":12.5}}' : '{"action":"none"}'),
    async (chat) => {
      const errors = await captureErrors(async () => {
        await chat.postMessage("main", { text: "80" });
        const result = await chat.postMessage("main", { text: "divide that by 4" });
        assert.equal(result.outcome, "proposal");
        assert.match(result.reply.text, /^Set Groceries weekly target to €20\.00 \(now €0\.00\) \(80 ÷ 4 = 20\)$/);
      });
      assert.equal(errors.length, 1, "the override is logged to the server exactly once");
      assert.match(errors[0]!, /1250c replaced by code result 2000c/, "the logged difference names the model and code cents");
    }
  );
});

test("arithmetic: the logged override reaches the server log, never the chat reply", async () => {
  await withChat(
    (text) => (/divide that by 4/i.test(text) ? '{"action":"set_budget_target","fields":{"category":"Groceries","period":"week","amount":12.5}}' : '{"action":"none"}'),
    async (chat) => {
      await chat.postMessage("main", { text: "80" });
      const result = await chat.postMessage("main", { text: "divide that by 4" });
      assert.doesNotMatch(result.reply.text, /1250|12\.50|replaced|override/i, "the model's wrong amount is not shown in the chat");
    }
  );
});

test("arithmetic: half, double and percent compute in code and show their working", async () => {
  await withChat((text) => {
    if (/half of 60/i.test(text)) return expense(1);
    if (/double 15/i.test(text)) return expense(1);
    if (/10% of 250/i.test(text)) return expense(1);
    return '{"action":"none"}';
  }, async (chat) => {
    const half = await chat.postMessage("main", { text: "half of 60 on groceries" });
    assert.equal(half.outcome, "proposal");
    assert.match(half.reply.text, /^Add expense €30\.00 · Groceries · 2026-10-14 \(today\) \(half of 60 = 30\)$/);

    const twice = await chat.postMessage("main", { text: "double 15 on groceries" });
    assert.equal(twice.outcome, "proposal");
    assert.match(twice.reply.text, /^Add expense €30\.00 · Groceries · 2026-10-14 \(today\) \(double 15 = 30\)$/);

    const percent = await chat.postMessage("main", { text: "10% of 250 on groceries" });
    assert.equal(percent.outcome, "proposal");
    assert.match(percent.reply.text, /^Add expense €25\.00 · Groceries · 2026-10-14 \(today\) \(10% of 250 = 25\)$/);
  });
});

test("arithmetic: a division that does not land on a whole cent rounds half-up and shows the rounded working", async () => {
  await withChat((text) => (/divide 10 by 3/i.test(text) ? expense(1) : '{"action":"none"}'), async (chat) => {
    const result = await chat.postMessage("main", { text: "divide 10 by 3 on groceries" });
    assert.equal(result.outcome, "proposal");
    assert.match(result.reply.text, /^Add expense €3\.33 · Groceries · 2026-10-14 \(today\) \(10 ÷ 3 = 3\.33\)$/);
  });
});

test("arithmetic: 'divide that by 4' with no earlier amount asks for the number and makes no proposal", async () => {
  await withChat((text) => (/divide that by 4/i.test(text) ? expense(1) : '{"action":"none"}'), async (chat) => {
    const result = await chat.postMessage("main", { text: "divide that by 4 on groceries" });
    assert.equal(result.outcome, "invalid");
    assert.equal(result.proposal, undefined, "no proposal is created when the reference is missing");
    assert.match(result.reply.text, /no earlier amount/i);
  });
});

test("arithmetic: 'split 60 between 3' is not calculated — it asks share-or-total and makes no proposal", async () => {
  await withChat((text) => (/split 60 between 3/i.test(text) ? expense(1) : '{"action":"none"}'), async (chat) => {
    const result = await chat.postMessage("main", { text: "split 60 between 3 on groceries" });
    assert.equal(result.outcome, "invalid");
    assert.equal(result.proposal, undefined, "a split is never turned into a proposal");
    assert.match(result.reply.text, /^Do you want your share of €60\.00, or the total for everyone\?$/);
  });
});
