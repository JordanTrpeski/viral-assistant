import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { generateCheckpoint } from "../src/checkpoint.js";
import { inspectGit } from "../src/git.js";
import { saveState } from "../src/state.js";
import { saveTask } from "../src/tasks.js";
import type { DevelopmentTask } from "../src/types.js";
import { fixture, validState } from "./helpers.js";

test("inspects actual Git state and generates a concise deterministic checkpoint", async () => {
  const root = await fixture({ git: true });
  const task: DevelopmentTask = {
    schemaVersion: 1, id: "M00-001", milestone: "M00_BOOTSTRAP", objective: "Test checkpointing.",
    status: "in_progress", acceptanceCriteria: ["Checkpoint contains Git state"], dependencies: [],
    relevantFiles: ["changed.txt"], notes: [], nextAction: "Verify output.", verificationResult: null
  };
  await saveTask(root, task);
  await saveState(root, { ...validState, activeTask: task.id, nextAction: task.nextAction });
  await writeFile(join(root, "changed.txt"), "changed\n", "utf8");
  const git = await inspectGit(root);
  assert.equal(git.branch, "main");
  assert.equal(git.workingTreeStatus, "dirty");
  assert.ok(git.changedFiles.includes("changed.txt"));
  assert.ok(git.changedFiles.includes("STATE.json"));
  const first = await generateCheckpoint(root, false);
  const second = await generateCheckpoint(root, false);
  assert.equal(first, second);
  assert.match(first, /M00-001 — Test checkpointing/);
  assert.match(first, new RegExp(git.head));
  assert.match(first, /changed\.txt/);
});
