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
import { createLocalModel } from "./local/registry.js";
import { LocalBrain } from "./local/tasks.js";

const root = resolve(process.env.JARVIS_ROOT ?? process.cwd());
const command = process.argv[2];
const json = process.argv.includes("--json");

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function timeout(defaultValue?: number): number | undefined {
  const value = option("--timeout-ms");
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000) throw new Error("--timeout-ms must be an integer of at least 1000");
  return parsed;
}

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
  } else if (command === "local-status") {
    const probe = await (await createLocalModel(root)).probe();
    console.log(json ? JSON.stringify(probe, null, 2) : [
      `Ollama CLI installed: ${probe.installed}`,
      `Ollama service running: ${probe.running}`,
      `Available models: ${probe.models.length ? probe.models.join(", ") : "None"}`,
      `Preferred model: ${probe.preferredModel ?? "Not configured"}`,
      ...probe.diagnostics.map((item) => `Diagnostic: ${item}`)
    ].join("\n"));
    if (!probe.usable) process.exitCode = 1;
  } else if (command === "local-infer") {
    const input = process.argv[3];
    if (!input || input.startsWith("--")) throw new Error("local-infer requires input text");
    const model = await createLocalModel(root);
    const requestedModel = option("--model");
    const requestedTimeout = timeout();
    const result = await model.infer({ input, ...(requestedModel ? { model: requestedModel } : {}), ...(requestedTimeout === undefined ? {} : { timeoutMs: requestedTimeout }) });
    console.log(json ? JSON.stringify(result, null, 2) : result.succeeded ? result.output : `${result.error ?? "Local inference failed"}${result.diagnostics.length ? `\n${result.diagnostics.join("\n")}` : ""}`);
    if (!result.succeeded) process.exitCode = 1;
  } else if (command === "local-classify") {
    const input = process.argv[3];
    if (!input || input.startsWith("--")) throw new Error("local-classify requires input text");
    const requestedTimeout = timeout();
    const result = await new LocalBrain(await createLocalModel(root)).classify(input, requestedTimeout === undefined ? {} : { timeoutMs: requestedTimeout });
    console.log(json ? JSON.stringify(result, null, 2) : `${result.escalation}: ${result.value?.rationale ?? result.diagnostics.join(" ")}`);
    if (!result.succeeded) process.exitCode = 1;
  } else {
    console.error("Usage: jarvis-dev <status|verify|checkpoint|context|harnesses|packet|run|local-status|local-infer|local-classify> [options]");
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => { console.error((error as Error).message); process.exitCode = 1; });
