import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EfficiencyModelAvailabilityCondition, GovernedDevelopmentTaskHandler } from "../src/efficiency/runtime.js";
import type { GovernedRunResult, SelectionDecision } from "../src/efficiency/types.js";
import type { DevelopmentHarness, HarnessId, PersistedHarnessRun } from "../src/harness/types.js";
import type { LocalInferenceRequest, LocalInferenceResult, LocalModel, LocalModelProbe } from "../src/local/types.js";
import { ViralRuntime } from "../src/runtime/engine.js";
import type { RuntimeTask } from "../src/runtime/types.js";
import { FakeClock, MemoryRuntimeStore } from "./runtime-helpers.js";

async function runtimeTask(runtime: ViralRuntime, id: string): Promise<RuntimeTask> {
  const task = (await runtime.getSnapshot()).tasks.find((item) => item.id === id);
  if (!task) throw new Error(`Missing runtime task: ${id}`);
  return task;
}

function plan(changes: Partial<SelectionDecision> = {}): SelectionDecision {
  return { schemaVersion: 1, taskId: "M04-001", action: "WAITING_FOR_MODEL", tier: "CODING_HARNESS", effort: "MEDIUM", harness: "codex", model: null, reason: "Wait for confirmed Codex availability.", ownerInputRequired: false, freshSessionRecommended: false, nextProbeAt: "2026-01-01T00:00:10.000Z", failureCount: 0, maximumAttempts: 6, ...changes };
}
function runRecord(succeeded = true): PersistedHarnessRun {
  return { schemaVersion: 1, runId: "run", taskId: "M04-001", packetPath: "packets/M04-001.md", harness: "codex", displayName: "Codex", command: [], succeeded, diagnostics: [], startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.001Z", durationMs: 1, exitCode: succeeded ? 0 : 1, signal: null, timedOut: false, stdout: "", stderr: succeeded ? "" : "failed", error: null };
}
class FakeLocalModel implements LocalModel {
  readonly id = "ollama" as const;
  readonly displayName = "Fake local";
  probes = 0;
  inferences = 0;
  usable = true;
  async probe(): Promise<LocalModelProbe> { this.probes += 1; return { provider: "ollama", displayName: "Fake", executable: "fake", installed: true, running: true, usable: this.usable, version: "1", models: ["small"], preferredModel: "small", diagnostics: [] }; }
  async infer(_request: LocalInferenceRequest): Promise<LocalInferenceResult> { this.inferences += 1; throw new Error("waiting must not infer"); }
}
function fakeHarness(id: HarnessId, probe: () => boolean): DevelopmentHarness {
  return { id, displayName: id, probe: async () => ({ id, displayName: id, executable: id, installed: true, usable: probe(), version: "1", diagnostics: [] }), launch: async () => { throw new Error("condition must not launch"); } };
}

test("availability condition respects retry time and requires a real probe without inference", async () => {
  const clock = new FakeClock();
  const local = new FakeLocalModel();
  let harnessAvailable = false;
  let harnessProbes = 0;
  const harnesses = { codex: fakeHarness("codex", () => { harnessProbes += 1; return harnessAvailable; }), claude: fakeHarness("claude", () => false) };
  const condition = new EfficiencyModelAvailabilityCondition(local, harnesses, () => clock.now());
  const spec = { type: "efficiency_model_available", parameters: { capability: "harness", harness: "codex", earliestRetryAt: "2026-01-01T00:00:10.000Z" } };
  assert.equal(await condition.evaluate(spec), false);
  assert.equal(harnessProbes, 0);
  clock.advance(10_000);
  assert.equal(await condition.evaluate(spec), false);
  assert.equal(harnessProbes, 1);
  harnessAvailable = true;
  assert.equal(await condition.evaluate(spec), true);
  assert.equal(harnessProbes, 2);
  assert.equal(local.inferences, 0);
  assert.equal(await condition.evaluate({ type: condition.type, parameters: { capability: "local", model: "small" } }), true);
  assert.equal(local.probes, 1);
  assert.equal(local.inferences, 0);
});

test("runtime keeps governed work waiting until availability is confirmed, then resumes", async () => {
  const clock = new FakeClock();
  const store = new MemoryRuntimeStore();
  const local = new FakeLocalModel();
  let available = false;
  let probes = 0;
  let executions = 0;
  const harnesses = { codex: fakeHarness("codex", () => { probes += 1; return available; }), claude: fakeHarness("claude", () => false) };
  const executor = {
    runTask: async (): Promise<GovernedRunResult> => {
      executions += 1;
      return executions === 1 ? { decision: plan(), launched: false, run: null } : { decision: plan({ action: "EXECUTE", nextProbeAt: null }), launched: true, run: runRecord() };
    }
  };
  const runtime = new ViralRuntime(store, [new GovernedDevelopmentTaskHandler(executor, 1_000)], [new EfficiencyModelAvailabilityCondition(local, harnesses, () => clock.now())], clock);
  await runtime.initialize();
  await runtime.enqueue({ id: "governed", type: "governed-development", payload: { taskId: "M04-001", earliestModelRetryAt: "2026-01-01T00:00:10.000Z" } });
  await runtime.tick();
  assert.equal((await runtimeTask(runtime, "governed")).state, "WAITING_FOR_MODEL");
  assert.equal(executions, 1);
  await runtime.tick();
  assert.equal(probes, 0);
  assert.equal(executions, 1);
  clock.advance(10_000);
  await runtime.tick();
  assert.equal((await runtimeTask(runtime, "governed")).state, "WAITING_FOR_MODEL");
  assert.equal(probes, 1);
  available = true;
  await runtime.tick();
  assert.equal((await runtimeTask(runtime, "governed")).state, "COMPLETED");
  assert.equal(probes, 2);
  assert.equal(executions, 2);
  assert.equal(local.inferences, 0);
});

test("governed runtime owner gate pauses safely and does not launch", async () => {
  let calls = 0;
  const executor = { runTask: async (): Promise<GovernedRunResult> => { calls += 1; return { decision: plan({ action: "OWNER_INPUT_REQUIRED", ownerInputRequired: true, reason: "Owner approval required." }), launched: false, run: null }; } };
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [new GovernedDevelopmentTaskHandler(executor)], [], new FakeClock());
  await runtime.initialize();
  await runtime.enqueue({ id: "owner", type: "governed-development", payload: { taskId: "M04-001" } });
  await runtime.tick();
  const task = await runtimeTask(runtime, "owner");
  assert.equal(task.state, "WAITING_FOR_OWNER");
  assert.equal(task.ownerInputRequired?.prompt, "Owner approval required.");
  assert.equal(calls, 1);
});

test("private efficiency telemetry is covered by Git ignore policy", async () => {
  const ignore = await readFile(new URL("../../.gitignore", import.meta.url), "utf8");
  assert.match(ignore, /^\.viral\/efficiency\/$/m);
});
