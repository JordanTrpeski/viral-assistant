import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { join } from "node:path";
import test from "node:test";
import { OwnerObjectiveService } from "../src/objective.js";
import { deterministicEscalation } from "../src/local/policy.js";
import type { SelectionDecision } from "../src/efficiency/types.js";
import type { PersistedHarnessRun } from "../src/harness/types.js";
import type { LocalTaskResult } from "../src/local/types.js";
import type { Summary } from "../src/local/tasks.js";
import { loadState } from "../src/state.js";
import { readTask } from "../src/tasks.js";
import { fixture, validState } from "./helpers.js";

const decide = (changes: Partial<SelectionDecision> = {}): SelectionDecision => ({ schemaVersion: 1, taskId: "placeholder", action: "EXECUTE", tier: "CODING_HARNESS", effort: "MEDIUM", harness: "codex", model: null, reason: "Coding work requires Codex.", ownerInputRequired: false, freshSessionRecommended: false, nextProbeAt: null, failureCount: 0, maximumAttempts: 6, ...changes });
const runRecord = (taskId: string): PersistedHarnessRun => ({ schemaVersion: 1, runId: "run", taskId, packetPath: `packets/${taskId}.md`, harness: "codex", displayName: "Codex", command: [], succeeded: true, diagnostics: [], startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.001Z", durationMs: 1, exitCode: 0, signal: null, timedOut: false, stdout: "", stderr: "", error: null });
const localSuccess = (text: string): LocalTaskResult<Summary> => ({ succeeded: true, escalation: "LOCAL_OK", value: { text, originalCharacters: 100, summaryCharacters: text.length }, inference: null, diagnostics: [] });

function service(root: string, selection: Partial<SelectionDecision>, calls: { plans: unknown[]; launches: string[]; local: number[] }) {
  const executor = {
    planObjectiveTask: async (taskId: string, options: unknown) => { calls.plans.push(options); return decide({ taskId, ...selection }); },
    executeDecision: async (taskId: string) => { calls.launches.push(taskId); return runRecord(taskId); }
  };
  const brain = { summarize: async () => { calls.local.push(1); return localSuccess("Concise local result."); } };
  return new OwnerObjectiveService(root, executor, brain, () => new Date("2026-09-11T12:34:56.789Z"));
}

test("doctor command is deterministically recognized as coding work", () => {
  assert.equal(deterministicEscalation("Add a doctor command that checks Git, Ollama, Codex, config, and runtime health"), "CODING_HARNESS_REQUIRED");
});

test("owner objective creates a milestone-associated task and planning-only never executes", async () => {
  const root = await fixture();
  const calls = { plans: [] as unknown[], launches: [] as string[], local: [] as number[] };
  const result = await service(root, {}, calls).submit("Implement a small feature", { planOnly: true });
  assert.equal(result.taskId, "OBJ-20260911123456789");
  assert.equal(result.execution, null);
  assert.equal(calls.launches.length, 0);
  assert.equal(result.task.milestone, validState.currentMilestone);
  assert.equal((await loadState(root)).activeTask, result.taskId);
  assert.equal((await readTask(root, result.taskId)).objective, "Implement a small feature");
});

test("authorized coding objective starts the exact governor-selected harness decision", async () => {
  const root = await fixture();
  const calls = { plans: [] as unknown[], launches: [] as string[], local: [] as number[] };
  const result = await service(root, {}, calls).submit("Add a doctor command");
  assert.equal(result.execution?.kind, "CODING_HARNESS");
  assert.equal(result.execution?.succeeded, true);
  assert.deepEqual(calls.launches, [result.taskId]);
  assert.equal((await readTask(root, result.taskId)).status, "in_progress");
});

test("owner-gated objective persists safely and launches nothing", async () => {
  const root = await fixture();
  const calls = { plans: [] as unknown[], launches: [] as string[], local: [] as number[] };
  const result = await service(root, { action: "OWNER_INPUT_REQUIRED", tier: "DETERMINISTIC", effort: "HIGH", harness: null, ownerInputRequired: true, reason: "Owner approval is required." }, calls).submit("Change security policy");
  assert.equal(result.execution, null);
  assert.equal(result.task.status, "blocked");
  assert.equal(calls.launches.length, 0);
  assert.deepEqual(calls.plans[0], { ownerGate: "major_policy" });
});

test("local and deterministic objective paths execute without a coding harness", async () => {
  const localRoot = await fixture();
  const localCalls = { plans: [] as unknown[], launches: [] as string[], local: [] as number[] };
  const local = await service(localRoot, { tier: "LOCAL_MODEL", effort: "LOW", harness: null, model: "small" }, localCalls).submit("Summarize the current project state");
  assert.equal(local.execution?.output, "Concise local result.");
  assert.equal(local.task.status, "complete");
  assert.equal(localCalls.local.length, 1);
  assert.equal(localCalls.launches.length, 0);

  const deterministicRoot = await fixture();
  const deterministicCalls = { plans: [] as unknown[], launches: [] as string[], local: [] as number[] };
  const deterministic = await service(deterministicRoot, { tier: "DETERMINISTIC", effort: "LOW", harness: null }, deterministicCalls).submit("Show current project status");
  assert.equal(deterministic.execution?.kind, "DETERMINISTIC");
  assert.match(deterministic.execution?.output ?? "", /M00_BOOTSTRAP/);
  assert.equal(deterministicCalls.local.length, 0);
  assert.equal(deterministicCalls.launches.length, 0);
  assert.deepEqual(deterministicCalls.plans[0], { deterministicAvailable: true });
});

test("objective CLI returns a created task id and deterministic plan without execution", async () => {
  const root = await fixture();
  await writeFile(join(root, "viral-dev.config.json"), JSON.stringify({
    localBrain: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", preferredModel: null, defaultTimeoutMs: 5_000 },
    efficiencyGovernor: { primaryHarness: "codex", allowAutomaticPaidHarnessSwitch: false, maximumAttempts: 6, failuresPerEffortLevel: 2, initialContextCharacters: 1_000, maximumContextCharacters: 2_000, freshSessionCharacters: 1_500, freshSessionCompletedRatio: 0.6, freshSessionNoiseRatio: 0.5, maximumTelemetryEvents: 10 },
    verificationCommands: []
  }), "utf8");
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const result = await promisify(execFile)(process.execPath, [cli, "objective", "Show current project status", "--plan-only", "--json"], { env: { ...process.env, VIRAL_ROOT: root } });
  const output = JSON.parse(result.stdout) as { taskId: string; decision: SelectionDecision; planOnly: boolean };
  assert.match(output.taskId, /^OBJ-\d{17}$/);
  assert.equal(output.planOnly, true);
  assert.equal(output.decision.tier, "DETERMINISTIC");
  await access(join(root, "tasks", `${output.taskId}.json`));
  const saved = JSON.parse(await readFile(join(root, "tasks", `${output.taskId}.json`), "utf8")) as { milestone: string };
  assert.equal(saved.milestone, "M00_BOOTSTRAP");
});
