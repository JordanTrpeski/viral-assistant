import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { join } from "node:path";
import test from "node:test";
import { validateEfficiencyConfig } from "../src/efficiency/config.js";
import { EfficiencyContextPlanner } from "../src/efficiency/context.js";
import { GovernedDevelopmentExecutor } from "../src/efficiency/execution.js";
import { EfficiencyGovernor } from "../src/efficiency/governor.js";
import { EfficiencySessionPlanner } from "../src/efficiency/session.js";
import { EfficiencyTelemetry, JsonEfficiencyStore } from "../src/efficiency/telemetry.js";
import type { EfficiencyConfig, EfficiencyRecorder, SelectionDecision } from "../src/efficiency/types.js";
import { ClaudeHarness } from "../src/harness/claude.js";
import { CodexHarness } from "../src/harness/codex.js";
import type { DevelopmentHarness, HarnessId, HarnessProbe, PersistedHarnessRun, ProcessResult, ProcessRunner, ProcessSpec } from "../src/harness/types.js";
import type { LocalModelProbe, LocalTaskResult } from "../src/local/types.js";
import type { RelevantContext } from "../src/local/tasks.js";
import { saveTask } from "../src/tasks.js";
import { saveState } from "../src/state.js";
import { prepareTaskPacket } from "../src/packet.js";
import { fixture, validState } from "./helpers.js";

const config: EfficiencyConfig = {
  primaryHarness: "codex", allowAutomaticPaidHarnessSwitch: false, maximumAttempts: 6, failuresPerEffortLevel: 2,
  initialContextCharacters: 1_000, maximumContextCharacters: 2_000, freshSessionCharacters: 1_500,
  freshSessionCompletedRatio: 0.6, freshSessionNoiseRatio: 0.5, maximumTelemetryEvents: 2
};
const localProbe = (usable = true): LocalModelProbe => ({ provider: "ollama", displayName: "Ollama", executable: "ollama", installed: usable, running: usable, usable, version: "1", models: usable ? ["small:latest"] : [], preferredModel: usable ? "small:latest" : null, diagnostics: [] });
const harnessProbe = (id: HarnessId, usable: boolean | null): HarnessProbe => ({ id, displayName: id, executable: id, installed: usable !== false, usable, version: "1", diagnostics: [] });
const decision = (changes: Partial<SelectionDecision> = {}): SelectionDecision => ({ schemaVersion: 1, taskId: "M04-001", action: "EXECUTE", tier: "DETERMINISTIC", effort: "LOW", harness: null, model: null, reason: "Selected deterministic software.", ownerInputRequired: false, freshSessionRecommended: false, nextProbeAt: null, failureCount: 0, maximumAttempts: 6, ...changes });

class MemoryRecorder implements EfficiencyRecorder {
  readonly decisions: SelectionDecision[] = [];
  async record(value: SelectionDecision): Promise<void> { this.decisions.push(value); }
  async snapshot() { return { schemaVersion: 1 as const, updatedAt: new Date(0).toISOString(), nextSequence: 1, events: [] }; }
}

function governor(options: { local?: boolean; codex?: boolean | null; claude?: boolean | null; automaticSwitch?: boolean; recorder?: EfficiencyRecorder } = {}) {
  const probes: HarnessId[] = [];
  const instance = new EfficiencyGovernor({ ...config, allowAutomaticPaidHarnessSwitch: options.automaticSwitch ?? false }, {
    localProbe: async () => localProbe(options.local ?? true),
    harnessProbe: async (id) => { probes.push(id); return harnessProbe(id, id === "codex" ? (options.codex ?? true) : (options.claude ?? false)); },
    classify: async () => "LOCAL_OK",
    ...(options.recorder ? { recorder: options.recorder } : {})
  });
  return { instance, probes };
}

test("efficiency configuration validates owner gates and configurable thresholds", () => {
  assert.deepEqual(validateEfficiencyConfig(config), config);
  assert.throws(() => validateEfficiencyConfig({ ...config, primaryHarness: "other" }), /primaryHarness/);
  assert.throws(() => validateEfficiencyConfig({ ...config, initialContextCharacters: 1_500, maximumContextCharacters: 1_000, freshSessionCharacters: 1_000 }), /at least initialContextCharacters/);
  assert.throws(() => validateEfficiencyConfig({ ...config, maximumAttempts: 2 }), /bounded effort escalation/);
});

test("governor selects deterministic, local, and coding tiers with visible reasons", async () => {
  const recorder = new MemoryRecorder();
  const { instance, probes } = governor({ recorder });
  const deterministic = await instance.plan({ taskId: "D", objective: "Read Git status", deterministicAvailable: true });
  const local = await instance.plan({ taskId: "L", objective: "Summarize notes", workKind: "local_reasoning" });
  const coding = await instance.plan({ taskId: "C", objective: "Implement feature", workKind: "development" });
  assert.deepEqual([deterministic.tier, local.tier, coding.tier], ["DETERMINISTIC", "LOCAL_MODEL", "CODING_HARNESS"]);
  assert.deepEqual([deterministic.effort, local.effort, coding.effort], ["LOW", "LOW", "MEDIUM"]);
  assert.equal(local.model, "small:latest");
  assert.equal(coding.harness, "codex");
  for (const item of [deterministic, local, coding]) { assert.match(item.reason, /Selected|selected/); assert.ok(item.reason.length <= 300); }
  assert.deepEqual(probes, ["codex"]);
  assert.equal(recorder.decisions.length, 3);
});

test("risk and bounded failures raise effort then require owner input", async () => {
  const { instance } = governor();
  assert.equal((await instance.plan({ taskId: "A", objective: "work", workKind: "development", architectureChange: true })).effort, "HIGH");
  assert.equal((await instance.plan({ taskId: "B", objective: "work", workKind: "local_reasoning", failureCount: 2 })).effort, "MEDIUM");
  assert.equal((await instance.plan({ taskId: "C", objective: "work", workKind: "local_reasoning", failureCount: 4 })).effort, "HIGH");
  const bounded = await instance.plan({ taskId: "D", objective: "work", workKind: "development", failureCount: 6 });
  assert.equal(bounded.action, "OWNER_INPUT_REQUIRED");
  assert.match(bounded.reason, /retry limit/);
});

test("permanent gates and paid harness switching require owner approval by default", async () => {
  const { instance } = governor({ codex: false, claude: true });
  for (const ownerGate of ["consequential", "major_policy", "main_merge"] as const) {
    const result = await instance.plan({ taskId: ownerGate, objective: "owner gated work", ownerGate });
    assert.equal(result.action, "OWNER_INPUT_REQUIRED");
  }
  const blocked = await instance.plan({ taskId: "switch", objective: "Implement work", workKind: "development" });
  assert.equal(blocked.action, "OWNER_INPUT_REQUIRED");
  assert.equal(blocked.harness, "claude");
  const allowed = await governor({ codex: false, claude: true, automaticSwitch: true }).instance.plan({ taskId: "allowed", objective: "Implement work", workKind: "development" });
  assert.equal(allowed.action, "EXECUTE");
  assert.equal(allowed.harness, "claude");
});

test("unavailable harnesses wait with earliest retry and fresh-session evidence", async () => {
  const retryAt = "2026-01-02T00:00:00.000Z";
  const result = await governor({ codex: false, claude: false }).instance.plan({ taskId: "wait", objective: "Implement work", workKind: "development", earliestModelRetryAt: retryAt, contextCharacters: 1_600 });
  assert.equal(result.action, "WAITING_FOR_MODEL");
  assert.equal(result.nextProbeAt, retryAt);
  assert.equal(result.freshSessionRecommended, true);
  assert.match(result.reason, /probe again/);
});

test("context planning preserves authority, compresses after filtering, and retrieves progressively", async () => {
  let compressionCalls = 0;
  const compressor = {
    selectRelevantContext: async (): Promise<LocalTaskResult<RelevantContext>> => {
      compressionCalls += 1;
      return { succeeded: true, escalation: "LOCAL_OK", value: { selectedKeys: ["useful"], summary: "Useful implementation detail only.", packet: "", originalCharacters: 0, packetCharacters: 0 }, inference: null, diagnostics: [] };
    }
  };
  const sections = [
    { id: "RULES", content: "Mandatory owner rules.", mandatory: true, authority: 1 },
    { id: "useful", content: "U".repeat(1_100), relevance: 1, dependency: 1 },
    { id: "old", content: "O".repeat(1_100), relevance: 0.1 }
  ];
  const planner = new EfficiencyContextPlanner(config, compressor);
  const plan = await planner.plan("Implement governor", sections);
  assert.match(plan.content, /Mandatory owner rules/);
  assert.equal(plan.includedIds.includes("RULES"), true);
  assert.deepEqual(plan.summarizedIds, ["useful"]);
  assert.equal(plan.usedLocalCompression, true);
  assert.equal(compressionCalls, 1);
  assert.ok(plan.packetCharacters < plan.originalCharacters);
  const expanded = planner.retrieve(plan, sections, ["useful"]);
  assert.equal(expanded.includedIds.includes("useful"), true);
  assert.ok(expanded.packetCharacters <= config.maximumContextCharacters);
});

test("local compression failure keeps a valid deterministic context plan", async () => {
  const compressor = { selectRelevantContext: async (): Promise<LocalTaskResult<RelevantContext>> => ({ succeeded: false, escalation: "UNSURE", value: null, inference: null, diagnostics: ["malformed local output"] }) };
  const plan = await new EfficiencyContextPlanner(config, compressor).plan("task", [
    { id: "RULES", content: "Required", mandatory: true }, { id: "large", content: "X".repeat(1_500), relevance: 1 }
  ]);
  assert.match(plan.content, /Required/);
  assert.equal(plan.usedLocalCompression, false);
  assert.match(plan.diagnostics.join(" "), /malformed/);
});

test("session planner creates a bounded repository-style handoff without conversation replay", () => {
  const planner = new EfficiencySessionPlanner(config);
  const result = planner.plan({ objective: "Finish M04", currentState: "Implementation active", completedWork: ["Types complete"], unresolvedIssues: ["Runtime test"], relevantFiles: ["src/efficiency/governor.ts"], verification: ["typecheck pass"], gitState: "dev/m04 dirty", nextAction: "Run tests", contextCharacters: 1_600, completedContextRatio: 0.7, noiseRatio: 0.1 });
  assert.equal(result.freshSessionRecommended, true);
  assert.match(result.handoff, /Finish M04/);
  assert.match(result.handoff, /typecheck pass/);
  assert.doesNotMatch(result.handoff, /conversation history/i);
  assert.ok(result.handoff.length <= 8_000);
});

test("telemetry is bounded, structured, and excludes task prompts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viral-efficiency-"));
  const telemetry = new EfficiencyTelemetry(new JsonEfficiencyStore(directory), 2, () => new Date("2026-01-01T00:00:00.000Z"));
  await telemetry.record(decision({ taskId: "one" }));
  await telemetry.record(decision({ taskId: "two", action: "WAITING_FOR_MODEL" }));
  await telemetry.record(decision({ taskId: "three", failureCount: 2 }));
  const snapshot = await telemetry.snapshot();
  assert.equal(snapshot.events.length, 2);
  assert.deepEqual(snapshot.events.map((event) => event.taskId), ["two", "three"]);
  const raw = await readFile(join(directory, "state.json"), "utf8");
  assert.doesNotMatch(raw, /prompt|conversation|credential/i);
});

test("governed execution blocks unauthorized decisions and carries effort into an authorized launch", async () => {
  const root = await fixture();
  await saveTask(root, { schemaVersion: 1, id: "M04-001", milestone: "M04_EFFICIENCY_GOVERNOR", objective: "Implement governor", status: "in_progress", acceptanceCriteria: ["works"], dependencies: [], relevantFiles: [], notes: [], nextAction: "continue", verificationResult: null });
  let launches = 0;
  let launchOptions: unknown;
  const launcher = async (_root: string, _harness: DevelopmentHarness, taskId: string, _timeout: number, options?: unknown): Promise<PersistedHarnessRun> => {
    launches += 1; launchOptions = options;
    return { schemaVersion: 1, runId: "run", taskId, packetPath: "packets/M04-001.md", harness: "codex", displayName: "Codex", command: [], succeeded: true, diagnostics: [], startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.001Z", durationMs: 1, exitCode: 0, signal: null, timedOut: false, stdout: "", stderr: "", error: null };
  };
  const harness = (id: HarnessId): DevelopmentHarness => ({ id, displayName: id, probe: async () => harnessProbe(id, true), launch: async () => { throw new Error("unused"); } });
  const harnesses = { codex: harness("codex"), claude: harness("claude") };
  const blockedGovernor = governor().instance;
  const blocked = await new GovernedDevelopmentExecutor(root, blockedGovernor, harnesses, undefined, launcher).runTask("M04-001", 1_000, { requestedHarness: "claude" });
  assert.equal(blocked.launched, false);
  assert.equal(launches, 0);
  const allowed = await new GovernedDevelopmentExecutor(root, blockedGovernor, harnesses, undefined, launcher).runTask("M04-001", 1_000, { architectureChange: true });
  assert.equal(allowed.launched, true);
  assert.equal(launches, 1);
  assert.deepEqual(launchOptions, { reasoningEffort: "high", selection: { tier: "CODING_HARNESS", effort: "HIGH", harness: "codex", model: null, reason: allowed.decision.reason } });
});

class RecordingRunner implements ProcessRunner {
  calls: ProcessSpec[] = [];
  async run(spec: ProcessSpec): Promise<ProcessResult> { this.calls.push(spec); return { startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.001Z", durationMs: 1, exitCode: 0, signal: null, timedOut: false, stdout: "ok", stderr: "", error: null }; }
}

test("harness adapters propagate governed model and effort only where supported", async () => {
  const codexRunner = new RecordingRunner();
  await new CodexHarness(codexRunner).launch({ root: ".", packet: "task", timeoutMs: 1_000, model: "configured", reasoningEffort: "high" });
  assert.deepEqual(codexRunner.calls[0]?.args.slice(-5), ["--model", "configured", "-c", 'model_reasoning_effort="high"', "-"]);
  const claudeRunner = new RecordingRunner();
  await new ClaudeHarness(claudeRunner).launch({ root: ".", packet: "task", timeoutMs: 1_000, model: "configured", reasoningEffort: "high" });
  assert.deepEqual(claudeRunner.calls[0]?.args.slice(-2), ["--model", "configured"]);
  assert.equal(claudeRunner.calls[0]?.args.some((arg) => arg.includes("effort")), false);
});
test("task packet includes authoritative efficiency policy and the visible selection record", async () => {
  const root = await fixture({ git: true });
  await saveTask(root, { schemaVersion: 1, id: "M04-001", milestone: "M04_EFFICIENCY_GOVERNOR", objective: "Implement governor", status: "in_progress", acceptanceCriteria: ["works"], dependencies: [], relevantFiles: [], notes: [], nextAction: "continue", verificationResult: null });
  await saveState(root, { ...validState, currentMilestone: "M04_EFFICIENCY_GOVERNOR", activeTask: "M04-001" });
  const packet = await prepareTaskPacket(root, "M04-001", false, { tier: "CODING_HARNESS", effort: "HIGH", harness: "codex", model: null, reason: "Architecture work requires Codex." });
  assert.match(packet.content, /EFFICIENCY\.md/);
  assert.match(packet.content, /Efficiency Selection/);
  assert.match(packet.content, /Reasoning effort: HIGH/);
  assert.match(packet.content, /Architecture work requires Codex/);
});

test("efficiency CLI plans, blocks unauthorized execution, and reports local telemetry", async () => {
  const root = await fixture();
  await saveTask(root, { schemaVersion: 1, id: "M04-001", milestone: "M04_EFFICIENCY_GOVERNOR", objective: "Implement governor", status: "in_progress", acceptanceCriteria: ["works"], dependencies: [], relevantFiles: [], notes: [], nextAction: "continue", verificationResult: null });
  await saveState(root, { ...validState, currentMilestone: "M04_EFFICIENCY_GOVERNOR", activeTask: "M04-001" });
  await writeFile(join(root, "jarvis-dev.config.json"), JSON.stringify({
    localBrain: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", preferredModel: "small", defaultTimeoutMs: 5_000 },
    efficiencyGovernor: config,
    verificationCommands: []
  }), "utf8");
  const run = promisify(execFile);
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const environment = { ...process.env, JARVIS_ROOT: root };
  const planned = await run(process.execPath, [cli, "efficiency-plan", "M04-001", "--harness", "claude", "--json"], { env: environment });
  assert.equal((JSON.parse(planned.stdout) as SelectionDecision).action, "OWNER_INPUT_REQUIRED");
  await assert.rejects(run(process.execPath, [cli, "efficiency-run", "M04-001", "--harness", "claude", "--json"], { env: environment }), (error: unknown) => {
    const failure = error as { code?: number; stdout?: string };
    assert.equal(failure.code, 1);
    assert.equal((JSON.parse(failure.stdout ?? "{}") as { launched?: boolean }).launched, false);
    return true;
  });
  await assert.rejects(access(join(root, "runs")));
  const status = await run(process.execPath, [cli, "efficiency-status", "--json"], { env: environment });
  const snapshot = JSON.parse(status.stdout) as { events: Array<{ action: string }> };
  assert.equal(snapshot.events.length, 2);
  assert.equal(snapshot.events.every((event) => event.action === "OWNER_INPUT_REQUIRED"), true);
});
