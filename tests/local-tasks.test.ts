import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { LocalBrain } from "../src/local/tasks.js";
import type { LocalInferenceRequest, LocalInferenceResult, LocalModel, LocalModelProbe } from "../src/local/types.js";
import { fixture } from "./helpers.js";

function inference(output: string, changes: Partial<LocalInferenceResult> = {}): LocalInferenceResult {
  return {
    provider: "ollama", model: "fake:latest", succeeded: true, output,
    startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.001Z", durationMs: 1,
    statusCode: 200, timedOut: false, cancelled: false, error: null, diagnostics: [], ...changes
  };
}

class FakeModel implements LocalModel {
  readonly id = "ollama" as const;
  readonly displayName = "Fake Ollama";
  readonly requests: LocalInferenceRequest[] = [];
  constructor(private readonly results: LocalInferenceResult[]) {}
  async probe(): Promise<LocalModelProbe> { throw new Error("unused"); }
  async infer(request: LocalInferenceRequest): Promise<LocalInferenceResult> {
    this.requests.push(request);
    return this.results.shift() ?? inference("", { succeeded: false, error: "No fake response" });
  }
}

test("deterministic policy classifies representative local and escalation requests without model execution", async () => {
  const model = new FakeModel([]);
  const brain = new LocalBrain(model);
  const cases = [
    ["Summarize the current project state.", "LOCAL_OK"],
    ["What is my next scheduled task?", "LOCAL_OK"],
    ["Implement a new authentication architecture.", "CODING_HARNESS_REQUIRED"],
    ["Spend money / make an irreversible consequential decision.", "OWNER_INPUT_REQUIRED"]
  ] as const;
  for (const [request, expected] of cases) assert.equal((await brain.classify(request)).escalation, expected);
  assert.equal(model.requests.length, 0);
});

test("model classification and routing recommendations are validated and policy remains authoritative", async () => {
  const model = new FakeModel([
    inference(JSON.stringify({ escalation: "LOCAL_OK", rationale: "Routine reasoning." })),
    inference(JSON.stringify({ escalation: "LOCAL_OK", recommendation: "Handle locally." }))
  ]);
  const brain = new LocalBrain(model);
  assert.equal((await brain.classify("Compare these two short labels.")).value?.source, "model");
  assert.equal((await brain.recommendRoute("Review these notes for themes.", undefined)).escalation, "LOCAL_OK");
});

test("local context selection produces a substantially smaller relevant packet without a harness", async () => {
  const sections: Record<string, string> = {
    architecture: `Relevant local brain design. ${"A".repeat(8_000)}`,
    oldConversation: `Irrelevant historical chat. ${"B".repeat(30_000)}`,
    unrelatedFeature: `Future voice feature. ${"C".repeat(12_000)}`
  };
  const model = new FakeModel([inference(JSON.stringify({ selectedKeys: ["architecture"], summary: "Use the provider-neutral local model boundary." }))]);
  const result = await new LocalBrain(model).selectRelevantContext("Implement Ollama adapter", sections);
  assert.equal(result.succeeded, true);
  assert.deepEqual(result.value?.selectedKeys, ["architecture"]);
  assert.ok((result.value?.packetCharacters ?? Infinity) < (result.value?.originalCharacters ?? 0) / 4);
  assert.match(result.value?.packet ?? "", /provider-neutral local model boundary/);
  assert.doesNotMatch(result.value?.packet ?? "", /Irrelevant historical chat/);
  assert.equal(model.requests.length, 1);
});

test("summarization is bounded and malformed task output leaves repository state unchanged", async () => {
  const root = await fixture();
  const before = await readFile(join(root, "STATE.json"), "utf8");
  const model = new FakeModel([inference("S".repeat(8_000)), inference("not-json")]);
  const brain = new LocalBrain(model);
  const summary = await brain.summarize("large input", { milestone: "M02" });
  assert.equal(summary.value?.summaryCharacters, 4_000);
  const malformed = await brain.selectRelevantContext("task", { state: "data" });
  assert.equal(malformed.succeeded, false);
  assert.equal(malformed.escalation, "UNSURE");
  assert.match(malformed.diagnostics[0] ?? "", /malformed/);
  assert.equal(await readFile(join(root, "STATE.json"), "utf8"), before);
});

test("local task inference failures become UNSURE", async () => {
  const failure = inference("", { succeeded: false, statusCode: null, error: "Ollama unavailable" });
  const result = await new LocalBrain(new FakeModel([failure])).summarize("state", undefined);
  assert.equal(result.succeeded, false);
  assert.equal(result.escalation, "UNSURE");
  assert.match(result.diagnostics[0] ?? "", /unavailable/);
});
