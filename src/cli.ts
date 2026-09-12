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
import { createDefaultRuntime } from "./runtime/registry.js";
import { RuntimeService } from "./runtime/service.js";
import { createEfficiencyServices } from "./efficiency/registry.js";
import { formatHealthReport, runDoctor } from "./doctor.js";
import { DevelopmentFinalizer } from "./finalization.js";
import { formatSummary, formatTaskDetail, readTaskLogs, summarize } from "./efficiency/logs.js";
import { parseDuration } from "./voice/duration.js";
import { runListenSession } from "./voice/listen.js";
import { createVoiceRuntime } from "./voice/registry.js";

const root = resolve(process.env.VIRAL_ROOT ?? process.cwd());
const command = process.argv[2];
const json = process.argv.includes("--json");
const usage = "Usage: viral-dev <objective|finalize|doctor|status|verify|checkpoint|context|harnesses|packet|run|local-status|local-infer|local-classify|efficiency-plan|efficiency-run|efficiency-status|runtime-status|runtime-start|voice|summary|task-detail> [options]";
const voiceListenUsage = "Usage: viral-dev voice listen [--timeout <duration>] [--json]";
const objectiveUsage = 'Usage: viral-dev objective "<development objective>" [--plan-only] [--timeout-ms <milliseconds>] [--json]';
const finalizeUsage = "Usage: viral-dev finalize [task-id] [--json]";

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
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(usage);
  } else if (command === "doctor") {
    const report = await runDoctor(root, option("--data-dir"));
    console.log(json ? JSON.stringify(report, null, 2) : formatHealthReport(report));
    if (!report.healthy) process.exitCode = 1;
  } else if (command === "objective") {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
      console.log([objectiveUsage, "", 'Example: npm run viral-dev -- objective "Add a doctor command"', "", "Creates an OBJ task in the current approved milestone, applies the Efficiency Governor, and executes immediately unless --plan-only or policy blocks execution."].join("\n"));
    } else {
      const objective = process.argv[3];
      if (!objective || objective.startsWith("--")) throw new Error("objective requires natural-language text");
      const requestedTimeout = timeout(900_000);
      const result = await (await createEfficiencyServices(root)).objectives.submit(objective, { planOnly: process.argv.includes("--plan-only"), ...(requestedTimeout === undefined ? {} : { timeoutMs: requestedTimeout }) });
      const questions = result.decision.action === "OWNER_INPUT_REQUIRED" && result.decision.clarifyingQuestions?.length
        ? ["Questions:", ...result.decision.clarifyingQuestions.map((question) => `  - ${question}`), "Answer these and provide refined objective."]
        : [];
      console.log(json ? JSON.stringify(result, null, 2) : [
        `Task: ${result.taskId}`,
        `Selection: ${result.decision.tier} / ${result.decision.effort}`,
        `Decision: ${result.decision.reason}`,
        result.planOnly ? "Execution: planning only" : result.execution ? `Execution: ${result.execution.succeeded ? "started successfully" : "failed"}` : `Execution: ${result.decision.action}`,
        ...questions,
        ...(result.execution?.output ? [result.execution.output] : [])
      ].join("\n"));
      if (result.execution?.succeeded === false) process.exitCode = 1;
    }
  } else if (command === "finalize") {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
      console.log([finalizeUsage, "", "Publishes an already verified development task. A recovery journal resumes interrupted or failed pushes without rerunning the coding harness or duplicating commits."].join("\n"));
    } else {
      const taskId = await selectedTask(process.argv[3]);
      const result = await new DevelopmentFinalizer(root).finalize(taskId);
      console.log(json ? JSON.stringify(result, null, 2) : result.diagnostic);
      if (!result.succeeded) process.exitCode = 1;
    }
  } else if (command === "context") {
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
  } else if (command === "efficiency-plan" || command === "efficiency-run") {
    const taskId = await selectedTask(process.argv[3]);
    const services = await createEfficiencyServices(root);
    const failureValue = option("--failure-count");
    const requestedHarness = option("--harness");
    if (requestedHarness !== undefined && requestedHarness !== "codex" && requestedHarness !== "claude") throw new Error("--harness must be codex or claude");
    const riskValue = option("--risk");
    const retryAt = option("--retry-at");
    if (riskValue !== undefined && riskValue !== "routine" && riskValue !== "normal" && riskValue !== "high") throw new Error("--risk must be routine, normal, or high");
    const options = {
      ...(failureValue === undefined ? {} : { failureCount: Number(failureValue) }),
      ...(requestedHarness === undefined ? {} : { requestedHarness: requestedHarness as HarnessId }),
      ...(riskValue === undefined ? {} : { risk: riskValue as "routine" | "normal" | "high" }),
      ...(process.argv.includes("--architecture-change") ? { architectureChange: true } : {}),
      ...(process.argv.includes("--security-sensitive") ? { securitySensitive: true } : {}),
      ...(process.argv.includes("--approve-paid-switch") ? { paidSwitchApproved: true } : {}),
      ...(retryAt ? { earliestModelRetryAt: retryAt } : {})
    };
    if (command === "efficiency-plan") {
      const decision = await services.executor.planTask(taskId, options);
      console.log(json ? JSON.stringify(decision, null, 2) : `${decision.action}: ${decision.tier}${decision.harness ? `/${decision.harness}` : ""} ${decision.effort} — ${decision.reason}`);
    } else {
      const result = await services.executor.runTask(taskId, timeout(900_000) ?? 900_000, options);
      console.log(json ? JSON.stringify(result, null, 2) : result.launched ? `${result.decision.reason}\nRun: ${result.run?.succeeded ? "succeeded" : "failed"}` : `${result.decision.action}: ${result.decision.reason}`);
      if (!result.launched || !result.run?.succeeded) process.exitCode = 1;
    }
  } else if (command === "efficiency-status") {
    const snapshot = await (await createEfficiencyServices(root, option("--data-dir"))).telemetry.snapshot();
    const latest = snapshot.events.at(-1) ?? null;
    console.log(json ? JSON.stringify(snapshot, null, 2) : [`Efficiency events: ${snapshot.events.length}`, `Latest: ${latest ? `${latest.action} ${latest.tier} ${latest.effort} — ${latest.reason}` : "None"}`].join("\n"));  } else if (command === "runtime-status") {
    const snapshot = await (await createDefaultRuntime(root, option("--data-dir"))).getSnapshot();
    const counts = Object.fromEntries(snapshot.tasks.map((task) => task.state).filter((state, index, states) => states.indexOf(state) === index).map((state) => [state, snapshot.tasks.filter((task) => task.state === state).length]));
    console.log(json ? JSON.stringify(snapshot, null, 2) : [`Runtime tasks: ${snapshot.tasks.length}`, `Events: ${snapshot.events.length}`, ...Object.entries(counts).map(([state, count]) => `${state}: ${count}`)].join("\n"));
  } else if (command === "runtime-start") {
    const pollValue = option("--poll-ms");
    const pollMs = pollValue === undefined ? 1_000 : Number(pollValue);
    const service = new RuntimeService(await createDefaultRuntime(root, option("--data-dir")), pollMs);
    const shutdown = (): void => { void service.stop(); };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    console.log(`Viral runtime started; polling every ${pollMs}ms.`);
    await service.start();
    console.log("Viral runtime stopped cleanly.");
  } else if (command === "voice") {
    const subcommand = process.argv[3];
    if (subcommand !== "listen") throw new Error(voiceListenUsage);
    const timeoutIndex = process.argv.indexOf("--timeout");
    if (timeoutIndex !== -1 && (process.argv[timeoutIndex + 1] === undefined || process.argv[timeoutIndex + 1]!.startsWith("--"))) {
      throw new Error("--timeout requires a duration value, e.g. 30s");
    }
    const sessionTimeoutMs = parseDuration(timeoutIndex === -1 ? "30s" : process.argv[timeoutIndex + 1]!);
    const runtime = await createVoiceRuntime(root);
    const result = await runListenSession(
      { audio: runtime.audio, stt: runtime.stt, tts: runtime.tts, respond: runtime.respond },
      { sessionTimeoutMs, silenceTimeoutMs: runtime.config.silenceTimeoutMs, sampleRateHz: runtime.config.sampleRateHz, channels: runtime.config.channels }
    );
    console.log(json ? JSON.stringify(result, null, 2) : [
      `Listen session ended: ${result.endedReason}`,
      ...result.turns.map((turn) => `Turn ${turn.turn}: "${turn.transcript}" -> "${turn.response}"${turn.interrupted ? " (interrupted)" : ""}`)
    ].join("\n"));
  } else if (command === "summary") {
    const daysArg = process.argv[3];
    const days = daysArg && !daysArg.startsWith("--") ? Number(daysArg) : 1;
    if (!Number.isInteger(days) || days < 1) throw new Error("summary days must be a positive integer");
    const summary = summarize(await readTaskLogs(root, days));
    console.log(json ? JSON.stringify({ days, ...summary }, null, 2) : formatSummary(summary, days));
  } else if (command === "task-detail") {
    const taskId = process.argv[3];
    if (!taskId || taskId.startsWith("--")) throw new Error("task-detail requires a task id");
    const entries = await readTaskLogs(root, 3_650);
    console.log(json ? JSON.stringify({ taskId, history: entries.filter((entry) => entry.taskId === taskId) }, null, 2) : formatTaskDetail(entries, taskId));
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => { console.error((error as Error).message); process.exitCode = 1; });
