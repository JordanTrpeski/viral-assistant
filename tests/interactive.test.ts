import assert from "node:assert/strict";
import test from "node:test";
import { embedAnswers, promptForAnswers, refineInteractively, type LineReader } from "../src/cli/interactive.js";
import type { ObjectiveSubmission } from "../src/objective.js";
import type { SelectionDecision } from "../src/efficiency/types.js";

function scriptedReader(answers: string[]): LineReader {
  let index = 0;
  return { question: async () => answers[index++] ?? "", close: () => {} };
}

function decision(action: SelectionDecision["action"], clarifyingQuestions?: string[]): SelectionDecision {
  return { schemaVersion: 1, taskId: "OBJ-X", action, tier: "CODING_HARNESS", effort: "MEDIUM", harness: "claude", model: null, reason: "r", ownerInputRequired: action === "OWNER_INPUT_REQUIRED", freshSessionRecommended: false, nextProbeAt: null, failureCount: 0, maximumAttempts: 6, ...(clarifyingQuestions ? { clarifyingQuestions } : {}) };
}

function submission(decisionValue: SelectionDecision): ObjectiveSubmission {
  return { taskId: decisionValue.taskId, taskPath: "tasks/OBJ-X.json", planOnly: false, decision: decisionValue, execution: null, task: { schemaVersion: 1, id: "OBJ-X", milestone: "M06_VIRAL_DESKTOP", objective: "o", status: "pending", acceptanceCriteria: [], dependencies: [], relevantFiles: [], notes: [], nextAction: "n", verificationResult: null } };
}

test("promptForAnswers re-asks a vague answer then accepts a concrete one", async () => {
  const printed: string[] = [];
  // First answer is vague (validate 0.1), second is concrete (validate 0.9).
  const reader = scriptedReader(["something good", "Whisper local"]);
  let calls = 0;
  const answers = await promptForAnswers(["Which STT engine?"], {
    reader,
    print: (line) => printed.push(line),
    validate: () => (++calls === 1 ? 0.1 : 0.9)
  });
  assert.equal(answers.get("Which STT engine?"), "Whisper local");
  assert.equal(calls, 2); // asked twice: re-prompted after the vague answer
  assert.ok(printed.some((line) => /vague/i.test(line)));
});

test("promptForAnswers stops after the max attempts and keeps the last answer", async () => {
  const reader = scriptedReader(["vague one", "vague two", "vague three", "unused"]);
  let calls = 0;
  const answers = await promptForAnswers(["Which TTS engine?"], { reader, print: () => {}, validate: () => { calls += 1; return 0.1; } });
  assert.equal(answers.get("Which TTS engine?"), "vague three");
  assert.equal(calls, 3); // capped at maxAnswerAttempts
});

test("embedAnswers appends answers so the refiner can extract them", () => {
  const answers = new Map([["Which STT?", "Whisper local"], ["Which TTS?", "Piper local"]]);
  assert.equal(embedAnswers("build voice interface", answers), "build voice interface. Whisper local, Piper local");
  assert.equal(embedAnswers("build voice interface.", answers), "build voice interface. Whisper local, Piper local");
});

test("refineInteractively loops until the decision proceeds, then returns the final submission", async () => {
  const submitted: string[] = [];
  const reader = scriptedReader(["Whisper local", "Piper local"]);
  const first = submission(decision("OWNER_INPUT_REQUIRED", ["Which STT engine?", "Which TTS engine?"]));
  const result = await refineInteractively("build voice interface", first, {
    reader,
    print: () => {},
    validate: () => 0.9,
    submit: async (objective) => { submitted.push(objective); return submission(decision("EXECUTE")); }
  });
  assert.equal(result.decision.action, "EXECUTE");
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0], "build voice interface. Whisper local, Piper local"); // refined objective passed through
});

test("refineInteractively stops after the maximum rounds even if still unclear", async () => {
  let submits = 0;
  const reader = scriptedReader(Array(20).fill("something"));
  const first = submission(decision("OWNER_INPUT_REQUIRED", ["Which STT engine?"]));
  const result = await refineInteractively("build voice", first, {
    reader,
    print: () => {},
    validate: () => 0.1,
    maxRounds: 3,
    submit: async () => { submits += 1; return submission(decision("OWNER_INPUT_REQUIRED", ["Which STT engine?"])); }
  });
  assert.equal(result.decision.action, "OWNER_INPUT_REQUIRED");
  assert.equal(submits, 3); // bounded — no infinite loop
});
