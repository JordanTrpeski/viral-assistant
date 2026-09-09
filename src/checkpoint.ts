import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectGit } from "./git.js";
import { loadState } from "./state.js";
import { readTask } from "./tasks.js";
import type { VerificationReport } from "./types.js";

async function verificationSummary(root: string): Promise<string[]> {
  try {
    const report = JSON.parse(await readFile(join(root, "verification", "latest.json"), "utf8")) as VerificationReport;
    return report.results.map((result) => `${result.passed ? "PASS" : "FAIL"} — ${result.name}: \`${result.command}\``);
  } catch { return ["No verification result recorded."]; }
}

export async function generateCheckpoint(root: string, write = true): Promise<string> {
  const state = await loadState(root);
  const git = await inspectGit(root);
  const task = state.activeTask ? await readTask(root, state.activeTask) : null;
  const changed = git.changedFiles.length ? git.changedFiles.map((file) => `- ${file}`) : ["- None"];
  const blockers = state.blockers.length ? state.blockers.map((item) => `- ${item}`) : ["- None"];
  const verification = (await verificationSummary(root)).map((item) => `- ${item}`);
  const text = [
    "# Development Checkpoint", "", `- Milestone: ${state.currentMilestone} (${state.milestoneStatus})`,
    `- Active task: ${task ? `${task.id} — ${task.objective}` : "None"}`, `- Branch: ${git.branch}`,
    `- HEAD: ${git.head}`, `- Working tree: ${git.workingTreeStatus}`, "", "## Files Changed", ...changed,
    "", "## Verification", ...verification, "", "## Blockers", ...blockers, "", "## Next Action", state.nextAction, ""
  ].join("\n");
  if (write) await writeFile(join(root, "CHECKPOINT.md"), text, "utf8");
  return text;
}

