import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { EfficiencyContextPlanner } from "../src/efficiency/context.js";
import { GovernedDevelopmentExecutor } from "../src/efficiency/execution.js";
import { EfficiencyGovernor } from "../src/efficiency/governor.js";
import { EfficiencySessionPlanner, deriveSessionMetrics } from "../src/efficiency/session.js";
import type { EfficiencyConfig, GovernorDependencies } from "../src/efficiency/types.js";
import { launchTask } from "../src/harness/coordinator.js";
import type { DevelopmentHarness, HarnessProbe, HarnessRunResult } from "../src/harness/types.js";
import { saveState } from "../src/state.js";
import { saveTask } from "../src/tasks.js";
import type { DevelopmentTask } from "../src/types.js";
import { fixture, validState } from "./helpers.js";

const baseConfig: EfficiencyConfig = {
  primaryHarness: "claude", allowAutomaticPaidHarnessSwitch: false, maximumAttempts: 6, failuresPerEffortLevel: 2,
  initialContextCharacters: 8_000, maximumContextCharacters: 24_000, freshSessionCharacters: 1_000,
  freshSessionCompletedRatio: 0.6, freshSessionNoiseRatio: 0.5, maximumTelemetryEvents: 50
};

function harnessProbe(usable: boolean): HarnessProbe {
  return { id: "claude", displayName: "Claude Code", executable: "claude", installed: true, usable, version: "test", diagnostics: [] };
}

function deps(usable: boolean): GovernorDependencies {
  return {
    harnessProbe: async () => harnessProbe(usable),
    localProbe: async () => ({ provider: "ollama", displayName: "Ollama", executable: "ollama", installed: false, running: false, usable: false, version: null, models: [], preferredModel: null, diagnostics: [] })
  };
}

function recordingHarness(record: (packet: string) => void): DevelopmentHarness {
  return {
    id: "claude", displayName: "Claude Code",
    probe: async () => harnessProbe(true),
    launch: async (request): Promise<HarnessRunResult> => {
      record(request.packet);
      return {
        harness: "claude", displayName: "Claude Code", command: ["claude"], succeeded: true, diagnostics: [],
        startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.001Z", durationMs: 1,
        exitCode: 0, signal: null, timedOut: false, stdout: "ok", stderr: "", error: null
      };
    }
  };
}

async function setupObjectiveFixture(notes: string[], objective = "Implement a new feature module"): Promise<{ root: string; taskId: string }> {
  const root = await fixture({ git: true });
  const taskId = "OBJ-SESSION-001";
  const task: DevelopmentTask = {
    schemaVersion: 1, id: taskId, milestone: "M00_BOOTSTRAP", objective, status: "in_progress",
    acceptanceCriteria: ["feature works"], dependencies: [], relevantFiles: ["src/feature.ts"], notes,
    nextAction: "Continue the feature.", verificationResult: null
  };
  await saveTask(root, task);
  await saveState(root, { ...validState, currentMilestone: "M00_BOOTSTRAP", activeTask: taskId, nextAction: "Continue the feature." });
  await writeFile(join(root, "viral-dev.config.json"), JSON.stringify({
    localBrain: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", preferredModel: "small", defaultTimeoutMs: 5_000 },
    efficiencyGovernor: baseConfig
  }, null, 2), "utf8");
  return { root, taskId };
}

test("freshSession() detects when context size, completion, or noise exceeds thresholds", async () => {
  const governor = new EfficiencyGovernor(baseConfig, deps(true));
  const below = await governor.plan({ taskId: "a", objective: "Implement feature", workKind: "development", contextCharacters: 500, completedContextRatio: 0.1, contextNoiseRatio: 0.1 });
  assert.equal(below.freshSessionRecommended, false);
  const bySize = await governor.plan({ taskId: "b", objective: "Implement feature", workKind: "development", contextCharacters: 5_000 });
  assert.equal(bySize.freshSessionRecommended, true);
  const byCompleted = await governor.plan({ taskId: "c", objective: "Implement feature", workKind: "development", contextCharacters: 10, completedContextRatio: 0.9 });
  assert.equal(byCompleted.freshSessionRecommended, true);
  const byNoise = await governor.plan({ taskId: "d", objective: "Implement feature", workKind: "development", contextCharacters: 10, contextNoiseRatio: 0.8 });
  assert.equal(byNoise.freshSessionRecommended, true);
});

test("deriveSessionMetrics and the session planner produce a valid bounded compact handoff", () => {
  const task: DevelopmentTask = {
    schemaVersion: 1, id: "T", milestone: "M00_BOOTSTRAP", objective: "Implement feature", status: "in_progress",
    acceptanceCriteria: ["a"], dependencies: [], relevantFiles: ["src/x.ts"],
    notes: ["Completed types and verified build.", "Attempt failed with an error."], nextAction: "n", verificationResult: null
  };
  const metrics = deriveSessionMetrics(task);
  assert.ok(metrics.contextCharacters > 0);
  assert.ok(metrics.completedContextRatio > 0 && metrics.completedContextRatio <= 1);
  assert.ok(metrics.contextNoiseRatio > 0 && metrics.contextNoiseRatio <= 1);
  const plan = new EfficiencySessionPlanner(baseConfig).plan({
    objective: "Implement feature", currentState: "active", completedWork: ["types"], unresolvedIssues: ["runtime"],
    relevantFiles: ["src/x.ts"], verification: ["typecheck pass"], gitState: "main clean", nextAction: "run tests",
    contextCharacters: metrics.contextCharacters, completedContextRatio: metrics.completedContextRatio, noiseRatio: metrics.contextNoiseRatio
  });
  assert.match(plan.handoff, /Fresh Development Session Handoff/);
  assert.match(plan.handoff, /Implement feature/);
  assert.doesNotMatch(plan.handoff, /# Development Task Packet/);
  assert.ok(plan.handoff.length <= 8_000);
});

test("context planner keeps mandatory sections and trims low-ranked content to the budget", async () => {
  const planner = new EfficiencyContextPlanner({ initialContextCharacters: 1_200, maximumContextCharacters: 1_500 });
  const plan = await planner.plan("task", [
    { id: "RULES", mandatory: true, authority: 1, content: "Must always keep." },
    { id: "high", relevance: 1, content: "H".repeat(400) },
    { id: "low", relevance: 0.1, content: "L".repeat(400) },
    { id: "huge", relevance: 0.2, content: "X".repeat(5_000) }
  ]);
  assert.equal(plan.includedIds.includes("RULES"), true);
  assert.equal(plan.includedIds.includes("high"), true);
  assert.equal(plan.excludedIds.includes("huge"), true);
  assert.ok(plan.packetCharacters < plan.originalCharacters);
  assert.match(plan.content, /Must always keep/);
});

test("coordinator routes to the compact handoff when a fresh session is recommended, full packet otherwise", async () => {
  const { root, taskId } = await setupObjectiveFixture(["a single small note"]);
  let freshPacket = "";
  let normalPacket = "";
  await launchTask(root, recordingHarness((p) => { freshPacket = p; }), taskId, 5_000, {
    freshSessionRecommended: true,
    selection: { tier: "CODING_HARNESS", effort: "MEDIUM", harness: "claude", model: null, reason: "resume" }
  });
  assert.match(freshPacket, /Fresh Development Session Handoff/);
  assert.match(freshPacket, /Operating Constraints/);
  assert.doesNotMatch(freshPacket, /# Development Task Packet/);
  assert.doesNotMatch(freshPacket, /Required Reading/);

  await launchTask(root, recordingHarness((p) => { normalPacket = p; }), taskId, 5_000, {});
  assert.match(normalPacket, /# Development Task Packet/);
  assert.match(normalPacket, /Required Reading/);
  assert.doesNotMatch(normalPacket, /Fresh Development Session Handoff/);
});

test("integration: an objective whose context exceeds the budget resumes via compact handoff, not replay", async () => {
  // A large accumulated note pushes contextCharacters past freshSessionCharacters (1000).
  const { root, taskId } = await setupObjectiveFixture(["A".repeat(2_000)]);
  let captured = "";
  const harness = recordingHarness((p) => { captured = p; });
  const executor = new GovernedDevelopmentExecutor(root, new EfficiencyGovernor(baseConfig, deps(true)), { codex: harness, claude: harness });

  const decision = await executor.planObjectiveTask(taskId);
  assert.equal(decision.action, "EXECUTE");
  assert.equal(decision.tier, "CODING_HARNESS");
  assert.ok(decision.effort === "MEDIUM" || decision.effort === "HIGH");
  assert.equal(decision.freshSessionRecommended, true);

  const run = await executor.executeDecision(taskId, 5_000, decision);
  assert.equal(run.succeeded, true);
  // The harness received the compact handoff, not a full-packet replay, and safety constraints are retained.
  assert.match(captured, /Fresh Development Session Handoff/);
  assert.doesNotMatch(captured, /Required Reading/);
  assert.match(captured, /Operating Constraints/);
});
