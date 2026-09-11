import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadProjectContext } from "../src/context.js";
import { loadState } from "../src/state.js";
import { fixture } from "./helpers.js";

test("loads every required context file and validates state", async () => {
  const root = await fixture();
  const context = await loadProjectContext(root);
  assert.equal(context.state.currentMilestone, "M00_BOOTSTRAP");
  assert.equal(context.milestonePath, "milestones/M00_BOOTSTRAP.md");
  assert.equal(Object.keys(context.documents).length, 8);
});

test("reports a missing context file clearly", async () => {
  const root = await fixture();
  await rm(join(root, "PRODUCT.md"));
  await assert.rejects(loadProjectContext(root), /Cannot load required context PRODUCT\.md/);
});

test("reports malformed and invalid state clearly", async () => {
  const root = await fixture();
  await writeFile(join(root, "STATE.json"), "{ nope", "utf8");
  await assert.rejects(loadState(root), /Malformed JSON/);
  await writeFile(join(root, "STATE.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");
  await assert.rejects(loadState(root), /STATE\.json\.[A-Za-z]+ must be a non-empty string/);
});
