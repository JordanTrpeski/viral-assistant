import assert from "node:assert/strict";
import test from "node:test";
import { DesktopChatSession, type ObjectiveSubmitter } from "../src/desktop/chat.js";
import type { ObjectiveSubmission } from "../src/objective.js";
import type { SelectionDecision } from "../src/efficiency/types.js";

function decision(action: SelectionDecision["action"], changes: Partial<SelectionDecision> = {}): SelectionDecision {
  return { schemaVersion: 1, taskId: "OBJ-X", action, tier: "CODING_HARNESS", effort: "MEDIUM", harness: "claude", model: null, reason: "r", ownerInputRequired: action === "OWNER_INPUT_REQUIRED", freshSessionRecommended: false, nextProbeAt: null, failureCount: 0, maximumAttempts: 6, ...changes };
}

function submission(objective: string, decisionValue: SelectionDecision, execution: ObjectiveSubmission["execution"] = null): ObjectiveSubmission {
  return { taskId: decisionValue.taskId, taskPath: `tasks/${decisionValue.taskId}.json`, planOnly: false, decision: decisionValue, execution, task: { schemaVersion: 1, id: decisionValue.taskId, milestone: "M06_VIRAL_DESKTOP", objective, status: "pending", acceptanceCriteria: [], dependencies: [], relevantFiles: [], notes: [], nextAction: "n", verificationResult: null } };
}

function scriptedSubmitter(results: ((objective: string) => ObjectiveSubmission)[]): { submitter: ObjectiveSubmitter; calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    submitter: { submit: async (objective: string) => { calls.push(objective); const build = results[index++] ?? results.at(-1)!; return build(objective); } }
  };
}

test("start pushes the owner objective then a clarifying question when one is required", async () => {
  const { submitter } = scriptedSubmitter([(objective) => submission(objective, decision("OWNER_INPUT_REQUIRED", { clarifyingQuestions: ["Which STT engine should it use?"] }))]);
  const session = new DesktopChatSession(submitter, () => new Date("2026-09-12T00:00:00.000Z"));
  const state = await session.start("build voice interface");
  assert.equal(session.awaitingAnswer, true);
  assert.deepEqual(state.pendingQuestions, ["Which STT engine should it use?"]);
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[0]?.role, "owner");
  assert.equal(state.messages[0]?.text, "build voice interface");
  assert.equal(state.messages[1]?.role, "viral");
  assert.equal(state.messages[1]?.text, "Which STT engine should it use?");
});

test("answer embeds the reply into the objective and resubmits until execution proceeds", async () => {
  const { submitter, calls } = scriptedSubmitter([
    (objective) => submission(objective, decision("OWNER_INPUT_REQUIRED", { clarifyingQuestions: ["Which STT engine should it use?"] })),
    (objective) => submission(objective, decision("EXECUTE"), { kind: "CODING_HARNESS", succeeded: true, output: "Started.", run: null })
  ]);
  const session = new DesktopChatSession(submitter);
  await session.start("build voice interface");
  const state = await session.answer("Whisper local");
  assert.equal(calls[1], "build voice interface. Whisper local");
  assert.equal(session.awaitingAnswer, false);
  assert.equal(state.pendingQuestions.length, 0);
  assert.equal(state.execution?.succeeded, true);
  assert.equal(state.messages.at(-1)?.text, "Started.");
});

test("answer rejects an empty reply and rejects when no question is pending", async () => {
  const { submitter } = scriptedSubmitter([(objective) => submission(objective, decision("EXECUTE"), { kind: "DETERMINISTIC", succeeded: true, output: "done", run: null })]);
  const session = new DesktopChatSession(submitter);
  await session.start("show current project status");
  await assert.rejects(() => session.answer("anything"), /no pending clarifying question/);
  await assert.rejects(() => session.start(""), /non-empty text/);
});

test("snapshot reflects the latest decision and execution without mutating history on repeated calls", async () => {
  const { submitter } = scriptedSubmitter([(objective) => submission(objective, decision("EXECUTE"), { kind: "DETERMINISTIC", succeeded: true, output: "ok", run: null })]);
  const session = new DesktopChatSession(submitter);
  await session.start("show current project status");
  const first = session.snapshot();
  const second = session.snapshot();
  assert.deepEqual(first, second);
  assert.equal(first.taskId, "OBJ-X");
});
