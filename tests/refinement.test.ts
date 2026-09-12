import assert from "node:assert/strict";
import test from "node:test";
import { EfficiencyGovernor } from "../src/efficiency/governor.js";
import { ObjectiveRefiner } from "../src/efficiency/refinement.js";
import type { EfficiencyConfig, GovernorDependencies } from "../src/efficiency/types.js";

const refinedVoice = "build voice interface. Whisper local, Piper local, 16kHz mono, 2s timeout, interrupt";
const vagueSttVoice = "build voice interface. something good for STT, Piper local, 16kHz mono, 2s timeout, interrupt";

test("validateAnswer scores concrete, partial, and vague answers", () => {
  const refiner = new ObjectiveRefiner();
  assert.ok(refiner.validateAnswer("Which STT engine should it use?", "Whisper local") >= 0.9);
  assert.equal(refiner.validateAnswer("Which STT engine should it use?", "cloud thing"), 0.3);
  assert.ok(refiner.validateAnswer("Which STT engine should it use?", "something good") <= 0.1);
  // "No deadline" is a valid (clear) answer to the timeline question, not a vague one.
  assert.ok(refiner.validateAnswer("Is there a timeline or deadline to plan around?", "no fixed deadline") >= 0.6);
});

test("extractAnswers maps embedded answers to their questions", () => {
  const answers = new ObjectiveRefiner().extractAnswers(refinedVoice);
  assert.match(answers.get("stt") ?? "", /Whisper/);
  assert.match(answers.get("tts") ?? "", /Piper/);
  assert.match(answers.get("sampleRate") ?? "", /16kHz/i);
  assert.match(answers.get("timeout") ?? "", /2s/);
  assert.ok(answers.has("interrupt"));
});

test("a fresh vague build objective asks the initial full question set", () => {
  const result = new ObjectiveRefiner().refine("build voice");
  assert.equal(result.action, "OWNER_INPUT_REQUIRED");
  assert.equal(result.objectiveType, "build");
  assert.equal(result.questions.length, 5);
  assert.equal(result.iteration, 1);
});

test("a fully-answered objective validates all answers and proceeds", () => {
  const result = new ObjectiveRefiner().refine(refinedVoice);
  assert.equal(result.action, "PROCEED");
  assert.deepEqual(result.questions, []);
  assert.equal(result.answers.length, 5);
  assert.ok(result.answers.every((assessment) => assessment.clarity >= 0.6));
});

test("a partially-vague objective asks only the unclear follow-up", () => {
  const result = new ObjectiveRefiner().refine(vagueSttVoice);
  assert.equal(result.action, "OWNER_INPUT_REQUIRED");
  assert.equal(result.questions.length, 1);
  assert.match(result.questions[0]!, /STT/);
});

test("iteration limit is respected (max 3 asks, then proceed)", () => {
  const refiner = new ObjectiveRefiner();
  const outcomes = [refiner.refine(vagueSttVoice), refiner.refine(vagueSttVoice), refiner.refine(vagueSttVoice), refiner.refine(vagueSttVoice)];
  assert.deepEqual(outcomes.map((outcome) => outcome.action), ["OWNER_INPUT_REQUIRED", "OWNER_INPUT_REQUIRED", "OWNER_INPUT_REQUIRED", "PROCEED"]);
  assert.deepEqual(outcomes.map((outcome) => outcome.iteration), [1, 2, 3, 4]);
});

test("specific and non-build objectives proceed without refinement", () => {
  const refiner = new ObjectiveRefiner();
  assert.equal(refiner.refine("Create a TypeScript function that takes an array of numbers and returns the sum").action, "PROCEED");
  assert.equal(refiner.refine("what should I do with my free hour").action, "PROCEED");
  assert.equal(refiner.refine("Implement the efficiency governor").objectiveType, null);
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

test("governor gates a vague objective and proceeds on a refined one", async () => {
  const gated = await new EfficiencyGovernor(config, deps).plan({ taskId: "g1", objective: "build voice interface" });
  assert.equal(gated.action, "OWNER_INPUT_REQUIRED");
  assert.equal(gated.clarifyingQuestions?.length, 5);
  assert.match(gated.clarifyingQuestions!.join(" "), /STT/);

  const proceeded = await new EfficiencyGovernor(config, deps).plan({ taskId: "g2", objective: refinedVoice, workKind: "development" });
  assert.notEqual(proceeded.action, "OWNER_INPUT_REQUIRED");
});
