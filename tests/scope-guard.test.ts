import assert from "node:assert/strict";
import test from "node:test";
import { GovernedDevelopmentExecutor } from "../src/efficiency/execution.js";
import { EfficiencyGovernor } from "../src/efficiency/governor.js";
import { detectMilestone, evaluateScope, findDuplicateObjective, isObjectiveInScope } from "../src/efficiency/scope-guard.js";
import type { EfficiencyConfig, GovernorDependencies, SelectionDecision } from "../src/efficiency/types.js";
import type { DevelopmentHarness, HarnessProbe } from "../src/harness/types.js";
import { OwnerObjectiveService } from "../src/objective.js";
import { saveState } from "../src/state.js";
import { readTask, saveTask } from "../src/tasks.js";
import type { DevelopmentTask } from "../src/types.js";
import { fixture, validState } from "./helpers.js";

const active = ["M05_VOICE_INTERFACE", "M06_VIRAL_DESKTOP"];
const desktopObjective = "Build an Electron + React desktop app called 'Viral Desktop' with a system tray.";
const task = (id: string, milestone: string, objective: string, status: DevelopmentTask["status"]): DevelopmentTask => ({
  schemaVersion: 1, id, milestone, objective, status, acceptanceCriteria: ["works"], dependencies: [], relevantFiles: [], notes: [], nextAction: "n", verificationResult: null
});

test("detectMilestone and isObjectiveInScope classify domain and milestone fit", () => {
  assert.equal(detectMilestone(desktopObjective), "M06");
  assert.equal(detectMilestone("Add local Whisper STT with a 2s silence timeout"), "M05");
  assert.equal(detectMilestone("Add a utility function that validates emails"), null);
  assert.equal(isObjectiveInScope(desktopObjective, "M05_VOICE_INTERFACE", active).inScope, false); // desktop filed under voice
  assert.equal(isObjectiveInScope(desktopObjective, "M06_VIRAL_DESKTOP", active).inScope, true);   // desktop filed under M06
  assert.equal(isObjectiveInScope("Add a utility function", "M05_VOICE_INTERFACE", active).inScope, true); // domain-neutral
  assert.equal(isObjectiveInScope(desktopObjective, "M09_FUTURE", active).inScope, false);          // inactive milestone
});

test("findDuplicateObjective matches only prior already-handled identical objectives", () => {
  assert.equal(findDuplicateObjective(desktopObjective, [{ id: "OBJ-1", objective: desktopObjective, status: "blocked" }]), "OBJ-1");
  assert.equal(findDuplicateObjective(`  ${desktopObjective.toUpperCase()}  `, [{ id: "OBJ-1", objective: desktopObjective, status: "complete" }]), "OBJ-1");
  assert.equal(findDuplicateObjective(desktopObjective, [{ id: "OBJ-2", objective: "totally different", status: "blocked" }]), null);
  assert.equal(findDuplicateObjective(desktopObjective, [{ id: "OBJ-3", objective: desktopObjective, status: "pending" }]), null); // not yet handled
});

test("evaluateScope returns DUPLICATE, OUT_OF_SCOPE, or PROCEED", () => {
  assert.equal(evaluateScope({ objective: desktopObjective, milestone: "M05_VOICE_INTERFACE", activeMilestones: active, existing: [] }).action, "OUT_OF_SCOPE");
  assert.equal(evaluateScope({ objective: desktopObjective, milestone: "M06_VIRAL_DESKTOP", activeMilestones: active, existing: [] }).action, "PROCEED");
  assert.equal(evaluateScope({ objective: desktopObjective, milestone: "M06_VIRAL_DESKTOP", activeMilestones: active, existing: [{ id: "OBJ-1", objective: desktopObjective, status: "blocked" }] }).action, "DUPLICATE");
});

const config: EfficiencyConfig = {
  primaryHarness: "claude", allowAutomaticPaidHarnessSwitch: false, maximumAttempts: 6, failuresPerEffortLevel: 2,
  initialContextCharacters: 12_000, maximumContextCharacters: 24_000, freshSessionCharacters: 18_000,
  freshSessionCompletedRatio: 0.6, freshSessionNoiseRatio: 0.5, maximumTelemetryEvents: 50
};
const probe = (): HarnessProbe => ({ id: "claude", displayName: "Claude Code", executable: "claude", installed: true, usable: true, version: "test", diagnostics: [] });
const deps: GovernorDependencies = {
  harnessProbe: async () => probe(),
  localProbe: async () => ({ provider: "ollama", displayName: "Ollama", executable: "ollama", installed: false, running: false, usable: false, version: null, models: [], preferredModel: null, diagnostics: [] })
};
const harness = (): DevelopmentHarness => ({ id: "claude", displayName: "Claude Code", probe: async () => probe(), launch: async () => { throw new Error("harness must not launch"); } });

test("pre-launch guard refuses an out-of-scope objective without launching a harness", async () => {
  const root = await fixture();
  await saveState(root, { ...validState, currentMilestone: "M05_VOICE_INTERFACE", activeMilestones: active });
  await saveTask(root, task("OBJ-OOS", "M05_VOICE_INTERFACE", desktopObjective, "pending"));
  let launched = false;
  const executor = new GovernedDevelopmentExecutor(root, new EfficiencyGovernor(config, deps), { codex: harness(), claude: harness() }, undefined, async () => { launched = true; throw new Error("must not launch"); });
  const decision = await executor.planObjectiveTask("OBJ-OOS");
  assert.equal(decision.action, "OWNER_INPUT_REQUIRED");
  assert.match(decision.reason, /M06|filed under|scope/i);
  assert.equal(launched, false);
});

test("pre-launch guard blocks a duplicate resubmission without launching a harness", async () => {
  const root = await fixture();
  await saveState(root, { ...validState, currentMilestone: "M06_VIRAL_DESKTOP", activeMilestones: active });
  await saveTask(root, task("OBJ-FIRST", "M06_VIRAL_DESKTOP", desktopObjective, "blocked"));
  await saveTask(root, task("OBJ-DUP", "M06_VIRAL_DESKTOP", desktopObjective, "pending"));
  const executor = new GovernedDevelopmentExecutor(root, new EfficiencyGovernor(config, deps), { codex: harness(), claude: harness() }, undefined, async () => { throw new Error("must not launch"); });
  const decision = await executor.planObjectiveTask("OBJ-DUP");
  assert.equal(decision.action, "OWNER_INPUT_REQUIRED");
  assert.match(decision.reason, /duplicate/i);
});

test("an in-scope, specific objective under an active milestone proceeds to selection", async () => {
  const root = await fixture();
  await saveState(root, { ...validState, currentMilestone: "M06_VIRAL_DESKTOP", activeMilestones: active });
  // In-scope for M06 (mentions Viral Desktop) and specific enough to clear the refinement gate.
  const specific = "Build the Viral Desktop system module that takes a config object and returns a JSON status.";
  await saveTask(root, task("OBJ-OK", "M06_VIRAL_DESKTOP", specific, "pending"));
  const executor = new GovernedDevelopmentExecutor(root, new EfficiencyGovernor(config, deps), { codex: harness(), claude: harness() }, undefined, async () => { throw new Error("no launch during planning"); });
  const decision = await executor.planObjectiveTask("OBJ-OK");
  assert.equal(decision.action, "EXECUTE");
  assert.equal(decision.tier, "CODING_HARNESS");
});

test("objective --milestone targets the requested active milestone instead of the current one", async () => {
  const root = await fixture();
  await saveState(root, { ...validState, currentMilestone: "M05_VOICE_INTERFACE", activeMilestones: active });
  const decision = (id: string): SelectionDecision => ({ schemaVersion: 1, taskId: id, action: "EXECUTE", tier: "CODING_HARNESS", effort: "MEDIUM", harness: "claude", model: null, reason: "ok", ownerInputRequired: false, freshSessionRecommended: false, nextProbeAt: null, failureCount: 0, maximumAttempts: 6 });
  const fakeExecutor = { planObjectiveTask: async (id: string) => decision(id), executeDecision: async () => { throw new Error("no"); } };
  const localBrain = { summarize: async () => ({ succeeded: true, escalation: "LOCAL_OK" as const, value: { text: "ok", originalCharacters: 1, summaryCharacters: 2 }, inference: null, diagnostics: [] }) };
  const service = new OwnerObjectiveService(root, fakeExecutor, localBrain, () => new Date("2026-09-12T07:30:00.000Z"));
  const result = await service.submit(desktopObjective, { milestone: "M06", planOnly: true });
  const created = await readTask(root, result.taskId);
  assert.equal(created.milestone, "M06_VIRAL_DESKTOP");
});
