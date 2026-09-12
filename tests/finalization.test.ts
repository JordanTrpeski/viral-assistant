import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DevelopmentFinalizer, type GitPublisher } from "../src/finalization.js";
import { writeJson } from "../src/files.js";
import { loadState, saveState } from "../src/state.js";
import { readTask, saveTask } from "../src/tasks.js";
import type { DevelopmentTask, VerificationReport } from "../src/types.js";
import { fixture } from "./helpers.js";

const report: VerificationReport = {
  schemaVersion: 1,
  executedAt: "2026-09-11T12:00:00.000Z",
  passed: true,
  results: [{ name: "tests", command: "pnpm test", passed: true, exitCode: 0, stdout: "ok", stderr: "", durationMs: 1 }]
};

class FakeGit implements GitPublisher {
  commits: string[] = [];
  messages: string[] = [];
  pushes = 0;
  preflights = 0;
  dirty = true;
  failPushes = new Set<number>();

  async branch(): Promise<string> { return "dev/finalization-test"; }
  async head(): Promise<string> { return this.commits.at(-1) ?? "initial"; }
  async isDirty(): Promise<boolean> { return this.dirty; }
  async identity(): Promise<{ name: string; email: string }> { return { name: "Jordan Trpeski", email: "102552864+JordanTrpeski@users.noreply.github.com" }; }
  async remoteUrl(): Promise<string> { return "https://github.com/JordanTrpeski/viral-assistant.git"; }
  async preflightPush(): Promise<void> { this.preflights += 1; }
  async stageAll(): Promise<void> {}
  async hasStagedChanges(): Promise<boolean> { return true; }
  async commit(message: string): Promise<string> { this.messages.push(message); const sha = `commit-${this.commits.length + 1}`; this.commits.push(sha); return sha; }
  async push(): Promise<void> {
    this.pushes += 1;
    if (this.failPushes.has(this.pushes)) throw Object.assign(new Error("remote rejected test push"), { stderr: "remote rejected test push" });
  }
}

async function setup(): Promise<{ root: string; data: string }> {
  const root = await fixture({ git: true });
  const task: DevelopmentTask = {
    schemaVersion: 1,
    id: "OBJ-TEST",
    milestone: "M00_BOOTSTRAP",
    objective: "Implement a verified test change",
    status: "in_progress",
    acceptanceCriteria: ["Verified change is published."],
    dependencies: [],
    relevantFiles: ["STATE.json"],
    notes: ["Efficiency selection: EXECUTE / CODING_HARNESS / MEDIUM. Test."],
    nextAction: "Finalize verified changes.",
    verificationResult: null
  };
  await saveTask(root, task);
  const state = await loadState(root);
  await saveState(root, { ...state, activeTask: task.id, nextAction: task.nextAction });
  await mkdir(join(root, "verification"), { recursive: true });
  await writeJson(join(root, "verification", "latest.json"), report);
  return { root, data: join(root, ".test-finalization") };
}

test("successful finalization commits and pushes implementation before completing the task", async () => {
  const { root, data } = await setup();
  const git = new FakeGit();
  const result = await new DevelopmentFinalizer(root, git, data, () => new Date("2026-09-11T12:01:00.000Z")).finalize("OBJ-TEST");
  assert.equal(result.succeeded, true);
  assert.equal(result.phase, "COMPLETED");
  assert.deepEqual(git.commits, ["commit-1", "commit-2"]);
  assert.equal(git.pushes, 2);
  assert.match(git.messages[0]!, /^feat: complete OBJ-TEST implementation$/);
  assert.equal((await readTask(root, "OBJ-TEST")).status, "complete");
  assert.equal((await loadState(root)).activeTask, null);
});

test("a blocked task is finalized honestly as a block, not a completed implementation", async () => {
  const { root, data } = await setup();
  await saveTask(root, { ...await readTask(root, "OBJ-TEST"), status: "blocked", nextAction: "Blocked: out-of-scope M06 objective filed under M05." });
  const git = new FakeGit();
  const result = await new DevelopmentFinalizer(root, git, data, () => new Date("2026-09-11T12:01:00.000Z")).finalize("OBJ-TEST");
  assert.equal(result.succeeded, true);
  assert.match(git.messages[0]!, /^chore: block OBJ-TEST \(/);
  assert.doesNotMatch(git.messages.join("\n"), /feat: complete/);
  // The task stays blocked and is not added to completedTasks.
  assert.equal((await readTask(root, "OBJ-TEST")).status, "blocked");
  assert.equal((await loadState(root)).completedTasks.includes("OBJ-TEST"), false);
});

test("a failed implementation push keeps exact recoverable state and retry does not duplicate the commit", async () => {
  const { root, data } = await setup();
  const git = new FakeGit();
  git.failPushes.add(1);
  const first = await new DevelopmentFinalizer(root, git, data).finalize("OBJ-TEST");
  assert.equal(first.succeeded, false);
  assert.equal(first.phase, "IMPLEMENTATION_COMMITTED");
  assert.match(first.diagnostic, /commit-1.*remote rejected test push/);
  assert.equal((await readTask(root, "OBJ-TEST")).status, "blocked");

  git.failPushes.clear();
  const retried = await new DevelopmentFinalizer(root, git, data).finalize("OBJ-TEST");
  assert.equal(retried.succeeded, true);
  assert.deepEqual(git.commits, ["commit-1", "commit-2"]);
  assert.equal((await readTask(root, "OBJ-TEST")).status, "complete");
});

test("completion-push failure is restart safe and restores the dirty task state after retry", async () => {
  const { root, data } = await setup();
  const git = new FakeGit();
  git.failPushes.add(2);
  const first = await new DevelopmentFinalizer(root, git, data).finalize("OBJ-TEST");
  assert.equal(first.phase, "COMPLETION_COMMITTED");
  assert.equal((await readTask(root, "OBJ-TEST")).status, "blocked");

  git.failPushes.clear();
  const recovered = await new DevelopmentFinalizer(root, git, data).finalize("OBJ-TEST");
  assert.equal(recovered.succeeded, true);
  assert.deepEqual(git.commits, ["commit-1", "commit-2"]);
  assert.equal((await readTask(root, "OBJ-TEST")).status, "complete");
});

test("completed journal makes restart and repeated finalization idempotent", async () => {
  const { root, data } = await setup();
  const git = new FakeGit();
  await new DevelopmentFinalizer(root, git, data).finalize("OBJ-TEST");
  const commits = git.commits.length;
  const pushes = git.pushes;
  const repeated = await new DevelopmentFinalizer(root, git, data).finalize("OBJ-TEST");
  assert.equal(repeated.succeeded, true);
  assert.equal(git.commits.length, commits);
  assert.equal(git.pushes, pushes);
  assert.equal(git.preflights, 1);
});
