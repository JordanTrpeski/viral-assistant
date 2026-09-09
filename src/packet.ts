import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectGit } from "./git.js";
import { loadState } from "./state.js";
import { readTask } from "./tasks.js";
import type { PersistedHarnessRun } from "./harness/types.js";
import type { VerificationReport } from "./types.js";

const requiredReading = [
  "AGENTS.md", "PRODUCT.md", "PRINCIPLES.md", "RULES.md", "ARCHITECTURE.md",
  "ROADMAP.md", "DECISIONS.md", "STATE.json", "STATE.md", "CHECKPOINT.md"
];

async function optionalJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch { return null; }
}

export async function prepareTaskPacket(root: string, taskId: string, write = true): Promise<{ path: string; content: string }> {
  const [state, task, git, verification] = await Promise.all([
    loadState(root), readTask(root, taskId), inspectGit(root),
    optionalJson<VerificationReport>(join(root, "verification", "latest.json"))
  ]);
  if (task.milestone !== state.currentMilestone) throw new Error(`Task ${task.id} belongs to ${task.milestone}, not active milestone ${state.currentMilestone}`);
  const lastRun = state.lastHarnessRun ? await optionalJson<PersistedHarnessRun>(join(root, state.lastHarnessRun)) : null;
  const milestonePath = `milestones/${state.currentMilestone}.md`;
  const reading = [...requiredReading, milestonePath, `tasks/${task.id}.json`];
  const changed = git.changedFiles.length ? git.changedFiles.map((file) => `- ${file}`) : ["- None"];
  const blockers = state.blockers.length ? state.blockers.map((item) => `- ${item}`) : ["- None"];
  const acceptance = task.acceptanceCriteria.map((item) => `- ${item}`);
  const relevant = task.relevantFiles.map((file) => `- ${file}`);
  const verificationLines = verification?.results.map((result) => `- ${result.passed ? "PASS" : "FAIL"} — ${result.name}: \`${result.command}\``) ?? ["- No verification recorded."];
  const runLines = lastRun ? [
    `- Harness: ${lastRun.displayName}`,
    `- Result: ${lastRun.succeeded ? "succeeded" : "failed"}`,
    `- Exit: ${lastRun.exitCode ?? "none"}; timed out: ${lastRun.timedOut}`,
    `- Record: ${state.lastHarnessRun}`
  ] : ["- None"];
  const content = [
    "# Development Task Packet", "", "This packet is generated from repository state. Do not rely on any earlier chat or model session.", "",
    "## Required Reading", ...reading.map((file) => `- ${file}`), "", "## Task",
    `- ID: ${task.id}`, `- Milestone: ${task.milestone}`, `- Objective: ${task.objective}`, `- Status: ${task.status}`,
    "", "### Acceptance Criteria", ...acceptance, "", "### Relevant Files", ...relevant,
    "", "## Current State", `- Milestone status: ${state.milestoneStatus}`, `- Next action: ${state.nextAction}`,
    "", "### Blockers", ...blockers, "", "## Git", `- Branch: ${git.branch}`, `- HEAD: ${git.head}`,
    `- Working tree: ${git.workingTreeStatus}`, "", "### Changed Files", ...changed,
    "", "## Latest Verification", ...verificationLines, "", "## Previous Harness Run", ...runLines,
    "", "## Operating Constraints",
    "- Work only on the active milestone and selected task.",
    "- Do not use OpenAI or Anthropic API keys, direct APIs, or API billing.",
    "- Do not expose, copy, or persist credentials or private owner data.",
    "- Do not merge into main, force-push, rewrite published history, or begin a later milestone.",
    "- Preserve progress in repository-visible task, state, verification, run, and checkpoint files.",
    "- Before ending, run relevant verification and generate a checkpoint suitable for a different harness.", ""
  ].join("\n");
  if (content.length > 24_000) throw new Error(`Task packet exceeds the 24000-character bootstrap limit (${content.length})`);
  const relativePath = `packets/${task.id}.md`;
  if (write) {
    await mkdir(join(root, "packets"), { recursive: true });
    await writeFile(join(root, relativePath), content, "utf8");
  }
  return { path: relativePath, content };
}
