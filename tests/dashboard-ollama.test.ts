import assert from "node:assert/strict";
import test from "node:test";
import type { RawProposal } from "../src/dashboard/commands/actions.js";
import { OllamaProposer, unavailableReply } from "../src/dashboard/commands/ollama.js";
import { placeholderReply, type ProposerResult } from "../src/dashboard/commands/proposer.js";
import { validateProposal, type ValidationContext, type ValidationResult } from "../src/dashboard/commands/validate.js";
import { defaultCategories } from "../src/dashboard/finance.js";
import { createDashboardContext } from "../src/dashboard/server.js";
import type { LocalInferenceResult, LocalModel, LocalModelProbe } from "../src/local/types.js";
import { withTempDir } from "./dashboard-helpers.js";

const today = "2026-10-14";
const input = { threadId: "main", text: "a message", today };

/** A fake loopback model: ignores the prompt and returns whatever the test sets. No real Ollama. */
function fakeModel(result: { succeeded?: boolean; output?: string; timedOut?: boolean; error?: string }): LocalModel {
  const probe: LocalModelProbe = { provider: "ollama", displayName: "Ollama", executable: "ollama", installed: true, running: true, usable: true, version: "test", models: ["m"], preferredModel: "m", diagnostics: [] };
  const inference: LocalInferenceResult = {
    provider: "ollama", model: "m", succeeded: result.succeeded ?? true, output: result.output ?? "", startedAt: "", finishedAt: "",
    durationMs: 1, statusCode: 200, timedOut: result.timedOut ?? false, cancelled: false, error: result.error ?? null, diagnostics: []
  };
  return { id: "ollama", displayName: "Ollama", probe: () => Promise.resolve(probe), infer: () => Promise.resolve(inference) };
}

function proposer(result: Parameters<typeof fakeModel>[0]): OllamaProposer {
  return new OllamaProposer(fakeModel(result), { model: "qwen3:4b-instruct", timeoutMs: 30_000 }, () => Promise.resolve(defaultCategories));
}

function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return { today, maxAmountCents: 500_000, categories: defaultCategories, transactions: [], targets: [], lastChatTransactionId: null, ...overrides };
}

function proposalOf(result: ProposerResult): RawProposal {
  assert.equal(result.kind, "proposal", `expected a proposal, got ${result.kind === "reply" ? `reply "${result.text}"` : result.kind}`);
  return (result as Extract<ProposerResult, { kind: "proposal" }>).proposal;
}

function okOf(result: ValidationResult): Extract<ValidationResult, { ok: true }> {
  assert.equal(result.ok, true, `expected validation to pass: ${result.ok ? "" : result.errors.join(" | ")}`);
  return result as Extract<ValidationResult, { ok: true }>;
}

test("ollama proposer: valid action JSON becomes a proposal that passes the existing validation", async () => {
  const result = await proposer({ output: '{"action":"add_expense","fields":{"amount":10,"category":"Groceries"}}' }).propose(input);
  const valid = okOf(validateProposal(proposalOf(result), context()));
  assert.match(valid.preview, /^Add expense €10\.00 · Groceries · 2026-10-14 \(today\)$/);
});

test("ollama proposer: invalid JSON falls back to the plain placeholder reply", async () => {
  assert.deepEqual(await proposer({ output: "I'm not sure what you mean." }).propose(input), { kind: "reply", text: placeholderReply });
});

test("ollama proposer: an action outside the list, or \"none\", falls back to the plain placeholder reply", async () => {
  assert.deepEqual(await proposer({ output: '{"action":"fly_to_moon","fields":{}}' }).propose(input), { kind: "reply", text: placeholderReply });
  assert.deepEqual(await proposer({ output: '{"action":"none"}' }).propose(input), { kind: "reply", text: placeholderReply });
});

test("ollama proposer: a category the model invented is rejected by the existing validation with its existing error text", async () => {
  const result = await proposer({ output: '{"action":"add_expense","fields":{"amount":5,"category":"Yachts"}}' }).propose(input);
  const validated = validateProposal(proposalOf(result), context());
  assert.equal(validated.ok, false);
  assert.ok(!validated.ok && validated.errors.some((error) => error.startsWith('category "Yachts" is not an existing Fixed or Flexible category; choose one of:')));
});

test("ollama proposer: it does not invent a date; with no date the existing rules default to today", async () => {
  const result = await proposer({ output: '{"action":"add_expense","fields":{"amount":5,"category":"Groceries"}}' }).propose(input);
  const proposal = proposalOf(result);
  assert.equal("date" in (proposal.fields as Record<string, unknown>), false, "the proposer leaves date out rather than inventing one");
  const valid = okOf(validateProposal(proposal, context()));
  assert.equal(valid.action.action === "add_expense" && valid.action.date, today);
});

test("ollama proposer: a timeout returns the unavailable reply and never throws", async () => {
  assert.deepEqual(await proposer({ succeeded: false, timedOut: true, error: "Local inference timed out" }).propose(input), { kind: "reply", text: unavailableReply });
  assert.deepEqual(await proposer({ succeeded: false, error: "Ollama is unavailable" }).propose(input), { kind: "reply", text: unavailableReply });
});

test("ollama proposer: a <think> reasoning block is stripped before the JSON is parsed", async () => {
  const result = await proposer({ output: '<think>They spent ten euros on groceries today.</think>\n{"action":"add_expense","fields":{"amount":10,"category":"Groceries"}}' }).propose(input);
  assert.equal(proposalOf(result).action, "add_expense");
});

test("wiring: proposerEnabled=false uses the placeholder even when the model would propose; true lets the proposal through", async () => {
  const output = '{"action":"add_expense","fields":{"amount":10,"category":"Groceries"}}';
  await withTempDir(async (directory) => {
    const disabled = createDashboardContext({ dataDir: directory, budgetStepCents: 1_000, chatMaxAmountCents: 500_000, clock: () => new Date(2026, 9, 14, 12, 0, 0), localModel: fakeModel({ output }), chat: { model: "m", timeoutMs: 30_000, proposerEnabled: false } });
    const reply = await disabled.chat.postMessage("main", { text: "spent 10 on groceries" });
    assert.equal(reply.outcome, "reply");
    assert.equal(reply.reply.text, placeholderReply);
  });
  await withTempDir(async (directory) => {
    const enabled = createDashboardContext({ dataDir: directory, budgetStepCents: 1_000, chatMaxAmountCents: 500_000, clock: () => new Date(2026, 9, 14, 12, 0, 0), localModel: fakeModel({ output }), chat: { model: "m", timeoutMs: 30_000, proposerEnabled: true } });
    const proposed = await enabled.chat.postMessage("main", { text: "spent 10 on groceries" });
    assert.equal(proposed.outcome, "proposal");
  });
});
