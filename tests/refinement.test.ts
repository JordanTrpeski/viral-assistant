import assert from "node:assert/strict";
import test from "node:test";
import { EfficiencyGovernor } from "../src/efficiency/governor.js";
import { ObjectiveRefiner } from "../src/efficiency/refinement.js";
import type { EfficiencyConfig, GovernorDependencies } from "../src/efficiency/types.js";

const refiner = new ObjectiveRefiner();

test("a vague 'build' objective returns domain-specific clarifying questions", () => {
  const result = refiner.clarify("build voice interface");
  assert.equal(result.needsRefinement, true);
  assert.equal(result.objectiveType, "build");
  const joined = result.questions.join(" ");
  assert.match(joined, /STT/);
  assert.match(joined, /TTS/);
  assert.match(joined, /sample rate/i);
  assert.match(joined, /timeout/i);
  assert.match(joined, /interrupt/i);
});

test("a specific objective with a concrete spec needs no refinement", () => {
  const result = refiner.clarify("Create a TypeScript function that takes an array of numbers and returns the sum");
  assert.equal(result.needsRefinement, false);
  assert.deepEqual(result.questions, []);
});

test("a vague learning-app objective returns level/content/format questions", () => {
  const result = refiner.clarify("make me a Slovenian learning app");
  assert.equal(result.needsRefinement, true);
  assert.equal(result.objectiveType, "build");
  const joined = result.questions.join(" ");
  assert.match(joined, /level/i);
  assert.match(joined, /content/i);
  assert.match(joined, /format/i);
});

test("a non-build objective is not gated", () => {
  const result = refiner.clarify("what should I do with my free hour");
  assert.equal(result.needsRefinement, false);
  assert.equal(result.objectiveType, null);
  assert.deepEqual(result.questions, []);
});

test("analyze and research objectives use their own templates; implement-style objectives pass through", () => {
  const analyze = refiner.clarify("analyze my spending");
  assert.equal(analyze.objectiveType, "analyze");
  assert.match(analyze.questions.join(" "), /data source/i);
  const research = refiner.clarify("research electric cars");
  assert.equal(research.objectiveType, "research");
  assert.match(research.questions.join(" "), /topic|depth|deep/i);
  // "Implement …" must not be treated as a vague build objective.
  assert.equal(refiner.clarify("Implement the efficiency governor").needsRefinement, false);
});

const config: EfficiencyConfig = {
  primaryHarness: "claude", allowAutomaticPaidHarnessSwitch: false, maximumAttempts: 6, failuresPerEffortLevel: 2,
  initialContextCharacters: 12_000, maximumContextCharacters: 24_000, freshSessionCharacters: 18_000,
  freshSessionCompletedRatio: 0.6, freshSessionNoiseRatio: 0.5, maximumTelemetryEvents: 50
};

const deps: GovernorDependencies = {
  harnessProbe: async () => ({ id: "claude", displayName: "Claude Code", executable: "claude", installed: true, usable: true, version: "test", diagnostics: [] }),
  localProbe: async () => ({ provider: "ollama", displayName: "Ollama", executable: "ollama", installed: false, running: false, usable: false, version: null, models: [], preferredModel: null, diagnostics: [] })
};

test("governor gates a vague objective to OWNER_INPUT_REQUIRED with questions embedded", async () => {
  const governor = new EfficiencyGovernor(config, deps);
  const gated = await governor.plan({ taskId: "g1", objective: "build voice interface" });
  assert.equal(gated.action, "OWNER_INPUT_REQUIRED");
  assert.ok(gated.ownerInputRequired);
  assert.ok((gated.clarifyingQuestions ?? []).length >= 3);
  assert.match(gated.clarifyingQuestions!.join(" "), /STT/);
});

test("governor does not gate a specific objective", async () => {
  const governor = new EfficiencyGovernor(config, deps);
  const proceeded = await governor.plan({ taskId: "g2", objective: "Create a TypeScript function that takes an array of numbers and returns the sum", workKind: "development" });
  assert.notEqual(proceeded.action, "OWNER_INPUT_REQUIRED");
  assert.equal(proceeded.clarifyingQuestions, undefined);
});
