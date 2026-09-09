import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ClaudeHarness } from "../src/harness/claude.js";
import { launchTask } from "../src/harness/coordinator.js";
import { CodexHarness } from "../src/harness/codex.js";
import { NodeProcessRunner } from "../src/harness/process.js";
import { prepareTaskPacket } from "../src/packet.js";
import { loadState, saveState } from "../src/state.js";
import { saveTask } from "../src/tasks.js";
import type { DevelopmentTask } from "../src/types.js";
import { fixture, validState } from "./helpers.js";

test("a fake Codex start is understandable to a separate fake Claude process without chat history", async () => {
  const root = await fixture({ git: true });
  const task: DevelopmentTask = {
    schemaVersion: 1, id: "M01-001", milestone: "M01_MULTI_HARNESS",
    objective: "Prove repository-only portability.", status: "in_progress",
    acceptanceCriteria: ["Claude identifies Codex handoff from repository state"], dependencies: ["M00-001"],
    relevantFiles: ["codex-handoff.txt"], notes: [], nextAction: "Begin with Codex.", verificationResult: null
  };
  await writeFile(join(root, "milestones", "M01_MULTI_HARNESS.md"), "# M01 portability\n", "utf8");
  await saveTask(root, task);
  await saveState(root, { ...validState, currentMilestone: "M01_MULTI_HARNESS", activeTask: task.id, lastHarnessRun: null });

  const codexScript = join(root, "fake-codex.mjs");
  const claudeScript = join(root, "fake-claude.mjs");
  await writeFile(codexScript, `
    import { readFile, writeFile } from "node:fs/promises";
    const packet = await new Promise((resolve) => { let value = ""; process.stdin.on("data", c => value += c); process.stdin.on("end", () => resolve(value)); });
    if (!packet.includes("M01-001") || !packet.includes("AGENTS.md")) process.exit(2);
    await writeFile("codex-handoff.txt", "Codex began M01; next harness should inspect repository state.\\n");
    console.log(JSON.stringify({ type: "result", session_id: "fake-codex", result: "started" }));
  `, "utf8");
  await writeFile(claudeScript, `
    const packet = await new Promise((resolve) => { let value = ""; process.stdin.on("data", c => value += c); process.stdin.on("end", () => resolve(value)); });
    const understood = packet.includes("Previous Harness Run") && packet.includes("Codex CLI") && packet.includes("codex-handoff.txt") && packet.includes("tasks/M01-001.json");
    console.log(JSON.stringify({ type: "result", session_id: "fake-claude", understood }));
    if (!understood) process.exit(3);
  `, "utf8");

  const runner = new NodeProcessRunner();
  const codex = new CodexHarness(runner, { executable: process.execPath, prefixArgs: [codexScript] }, root);
  const first = await launchTask(root, codex, task.id, 10_000);
  assert.equal(first.succeeded, true);
  assert.match(await readFile(join(root, "CHECKPOINT.md"), "utf8"), /Codex CLI: succeeded/);

  const packetForClaude = await prepareTaskPacket(root, task.id, false);
  const repeatedPacket = await prepareTaskPacket(root, task.id, false);
  assert.equal(packetForClaude.content, repeatedPacket.content);
  assert.match(packetForClaude.content, /Previous Harness Run[\s\S]*Codex CLI/);
  assert.ok(packetForClaude.content.length < 24_000);
  const claude = new ClaudeHarness(runner, { executable: process.execPath, prefixArgs: [claudeScript] }, root);
  const second = await launchTask(root, claude, task.id, 10_000);
  assert.equal(second.succeeded, true);
  assert.match(second.stdout, /"understood":true/);
  assert.match((await loadState(root)).lastHarnessRun ?? "", /claude-M01-001\.json$/);
});
