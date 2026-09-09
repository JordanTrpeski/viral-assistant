#!/usr/bin/env node
import { resolve } from "node:path";
import { generateCheckpoint } from "./checkpoint.js";
import { loadProjectContext } from "./context.js";
import { loadState } from "./state.js";
import { readTask } from "./tasks.js";
import { runVerification } from "./verification.js";
import { createHarnesses } from "./harness/registry.js";
import { launchTask } from "./harness/coordinator.js";
import type { HarnessId } from "./harness/types.js";
import { prepareTaskPacket } from "./packet.js";

const root = resolve(process.env.JARVIS_ROOT ?? process.cwd());
const command = process.argv[2];
const json = process.argv.includes("--json");

async function selectedTask(explicit?: string): Promise<string> {
  if (explicit && !explicit.startsWith("--")) return explicit;
  const state = await loadState(root);
  if (!state.activeTask) throw new Error("No active task; provide a task id explicitly");
  return state.activeTask;
}

async function main(): Promise<void> {
  if (command === "context") {
    const context = await loadProjectContext(root);
    const summary = { milestone: context.state.currentMilestone, milestonePath: context.milestonePath, files: [...Object.keys(context.documents), "STATE.json", context.milestonePath] };
    console.log(json ? JSON.stringify(summary, null, 2) : `Loaded ${summary.files.length} context files for ${summary.milestone}.`);
  } else if (command === "status") {
    const state = await loadState(root);
    const task = state.activeTask ? await readTask(root, state.activeTask) : null;
    const summary = { milestone: state.currentMilestone, milestoneStatus: state.milestoneStatus, activeTask: task, blockers: state.blockers, nextAction: state.nextAction };
    console.log(json ? JSON.stringify(summary, null, 2) : [`Milestone: ${summary.milestone} (${summary.milestoneStatus})`, `Active task: ${task?.id ?? "None"}`, `Next action: ${summary.nextAction}`].join("\n"));
  } else if (command === "verify") {
    const report = await runVerification(root);
    console.log(json ? JSON.stringify(report, null, 2) : report.results.map((item) => `${item.passed ? "PASS" : "FAIL"} ${item.name} (${item.durationMs}ms)`).join("\n"));
    if (!report.passed) process.exitCode = 1;
  } else if (command === "checkpoint") {
    const checkpoint = await generateCheckpoint(root);
    console.log(json ? JSON.stringify({ path: "CHECKPOINT.md", checkpoint }, null, 2) : checkpoint);
  } else if (command === "harnesses") {
    const harnesses = createHarnesses(root);
    const probes = await Promise.all([harnesses.codex.probe(), harnesses.claude.probe()]);
    console.log(json ? JSON.stringify(probes, null, 2) : probes.map((probe) => `${probe.id}: installed=${probe.installed}, usable=${probe.usable}, version=${probe.version ?? "unknown"}`).join("\n"));
    if (probes.some((probe) => !probe.installed || probe.usable === false)) process.exitCode = 1;
  } else if (command === "packet") {
    const taskId = await selectedTask(process.argv[3]);
    const packet = await prepareTaskPacket(root, taskId);
    console.log(json ? JSON.stringify(packet, null, 2) : packet.content);
  } else if (command === "run") {
    const harnessId = process.argv[3] as HarnessId | undefined;
    if (harnessId !== "codex" && harnessId !== "claude") throw new Error("Harness must be codex or claude");
    const taskId = await selectedTask(process.argv[4]);
    const timeoutIndex = process.argv.indexOf("--timeout-ms");
    const timeoutMs = timeoutIndex === -1 ? 900_000 : Number(process.argv[timeoutIndex + 1]);
    const record = await launchTask(root, createHarnesses(root)[harnessId], taskId, timeoutMs);
    console.log(json ? JSON.stringify(record, null, 2) : `${record.displayName} ${record.succeeded ? "completed" : "failed"}; run record: runs/${record.runId}.json`);
    if (!record.succeeded) process.exitCode = 1;
  } else {
    console.error("Usage: jarvis-dev <status|verify|checkpoint|context|harnesses|packet|run> [options]");
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => { console.error((error as Error).message); process.exitCode = 1; });
