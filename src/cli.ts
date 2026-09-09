#!/usr/bin/env node
import { resolve } from "node:path";
import { generateCheckpoint } from "./checkpoint.js";
import { loadProjectContext } from "./context.js";
import { loadState } from "./state.js";
import { readTask } from "./tasks.js";
import { runVerification } from "./verification.js";

const root = resolve(process.env.JARVIS_ROOT ?? process.cwd());
const command = process.argv[2];
const json = process.argv.includes("--json");

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
  } else {
    console.error("Usage: jarvis-dev <status|verify|checkpoint|context> [--json]");
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => { console.error((error as Error).message); process.exitCode = 1; });

