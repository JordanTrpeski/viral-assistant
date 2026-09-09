import assert from "node:assert/strict";
import test from "node:test";
import { readTask, saveTask, updateTask } from "../src/tasks.js";
import type { DevelopmentTask } from "../src/types.js";
import { fixture } from "./helpers.js";

test("creates, reads, and updates a validated development task", async () => {
  const root = await fixture();
  const task: DevelopmentTask = {
    schemaVersion: 1,
    id: "M00-test",
    milestone: "M00_BOOTSTRAP",
    objective: "Prove task persistence.",
    status: "pending",
    acceptanceCriteria: ["Round trips"],
    dependencies: [],
    relevantFiles: ["tasks/M00-test.json"],
    notes: [],
    nextAction: "Update task.",
    verificationResult: null
  };
  await saveTask(root, task);
  assert.deepEqual(await readTask(root, task.id), task);
  const updated = await updateTask(root, task.id, { status: "complete", nextAction: "None." });
  assert.equal(updated.status, "complete");
  assert.equal((await readTask(root, task.id)).nextAction, "None.");
});

test("rejects an invalid task", async () => {
  const root = await fixture();
  await assert.rejects(saveTask(root, { id: "broken" } as DevelopmentTask), /schemaVersion/);
});

