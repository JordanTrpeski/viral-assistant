import assert from "node:assert/strict";
import test from "node:test";
import { saveTask } from "../src/tasks.js";
import type { DevelopmentTask } from "../src/types.js";
import { projectTaskQueue } from "../src/desktop/tasks.js";
import { fixture } from "./helpers.js";

function task(id: string, status: DevelopmentTask["status"]): DevelopmentTask {
  return { schemaVersion: 1, id, milestone: "M06_VIRAL_DESKTOP", objective: `objective for ${id}`, status, acceptanceCriteria: [], dependencies: [], relevantFiles: [], notes: [], nextAction: `next for ${id}`, verificationResult: null };
}

test("projectTaskQueue maps each persisted task to a deterministic progress percent, newest first", async () => {
  const root = await fixture();
  await saveTask(root, task("OBJ-1", "pending"));
  await saveTask(root, task("OBJ-2", "in_progress"));
  await saveTask(root, task("OBJ-3", "blocked"));
  await saveTask(root, task("OBJ-4", "complete"));

  const queue = await projectTaskQueue(root);
  assert.deepEqual(queue.map((item) => item.id), ["OBJ-4", "OBJ-3", "OBJ-2", "OBJ-1"]);
  assert.deepEqual(queue.map((item) => item.progressPercent), [100, 50, 50, 0]);
  assert.equal(queue[0]?.nextAction, "next for OBJ-4");
});

test("projectTaskQueue returns an empty queue when no tasks have been created yet", async () => {
  const root = await fixture();
  assert.deepEqual(await projectTaskQueue(root), []);
});
