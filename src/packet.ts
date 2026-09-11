import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EfficiencyContextPlanner, type ContextBudget } from "./efficiency/context.js";
import type { ContextSection } from "./efficiency/types.js";
import { inspectGit } from "./git.js";
import { loadState } from "./state.js";
import { readTask } from "./tasks.js";
import type { HarnessSelectionRecord, PersistedHarnessRun } from "./harness/types.js";
import type { VerificationReport } from "./types.js";

const packetCharacterLimit = 24_000;
// When no governor budget is supplied (e.g. direct portability/packet inspection) the planner keeps
// every section, matching the original fixed-template behavior while still applying deterministic ranking.
const defaultContextBudget: ContextBudget = { initialContextCharacters: packetCharacterLimit, maximumContextCharacters: packetCharacterLimit };

export const operatingConstraints = [
  "- Work only on the active milestone and selected task.",
  "- Do not use OpenAI or Anthropic API keys, direct APIs, or API billing.",
  "- Do not expose, copy, or persist credentials or private owner data.",
  "- Do not merge into main, force-push, rewrite published history, or begin a later milestone.",
  "- Preserve progress in repository-visible task, state, verification, run, and checkpoint files.",
  "- Before ending, run relevant verification and generate a checkpoint suitable for a different harness."
];

const requiredReading = [
  "AGENTS.md", "PRODUCT.md", "PRINCIPLES.md", "RULES.md", "EFFICIENCY.md", "ARCHITECTURE.md",
  "ROADMAP.md", "DECISIONS.md", "STATE.json", "STATE.md", "CHECKPOINT.md"
];

async function optionalJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch { return null; }
}

export async function prepareTaskPacket(root: string, taskId: string, write = true, selection?: HarnessSelectionRecord, budget: ContextBudget = defaultContextBudget): Promise<{ path: string; content: string; contextPlan: { includedIds: string[]; excludedIds: string[]; budgetCharacters: number; packetCharacters: number; overBudget: boolean } }> {
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
  // Authoritative sections are mandatory (always retained); situational sections are ranked and trimmed
  // to the configured budget by the EfficiencyContextPlanner rather than emitted by a fixed template.
  const sections: ContextSection[] = [
    { id: "Required Reading", mandatory: true, authority: 1, content: reading.map((file) => `- ${file}`).join("\n") },
    {
      id: "Task", mandatory: true, authority: 1,
      content: [`- ID: ${task.id}`, `- Milestone: ${task.milestone}`, `- Objective: ${task.objective}`, `- Status: ${task.status}`,
        "", "### Acceptance Criteria", ...acceptance, "", "### Relevant Files", ...relevant].join("\n")
    },
    {
      id: "Current State", mandatory: true, authority: 0.9,
      content: [`- Milestone status: ${state.milestoneStatus}`, `- Next action: ${state.nextAction}`, "", "### Blockers", ...blockers].join("\n")
    },
    ...(selection ? [{
      id: "Efficiency Selection", mandatory: true, authority: 0.85,
      content: [`- Harness: ${selection.harness}`, `- Model: ${selection.model ?? "Harness default"}`, `- Reasoning effort: ${selection.effort}`, `- Practical reason: ${selection.reason}`].join("\n")
    } satisfies ContextSection] : []),
    {
      id: "Git", relevance: 0.7, recency: 0.9,
      content: [`- Branch: ${git.branch}`, `- HEAD: ${git.head}`, `- Working tree: ${git.workingTreeStatus}`, "", "### Changed Files", ...changed].join("\n")
    },
    { id: "Latest Verification", relevance: 0.7, recency: 0.6, content: verificationLines.join("\n") },
    { id: "Previous Harness Run", relevance: 0.6, recency: 0.5, content: runLines.join("\n") },
    { id: "Operating Constraints", mandatory: true, authority: 1, content: operatingConstraints.join("\n") }
  ];
  const plan = await new EfficiencyContextPlanner(budget).plan(task.objective, sections);
  const content = [
    "# Development Task Packet", "",
    "This packet is generated from repository state. Do not rely on any earlier chat or model session.", "",
    plan.content
  ].join("\n");
  if (content.length > packetCharacterLimit) throw new Error(`Task packet exceeds the ${packetCharacterLimit}-character bootstrap limit (${content.length})`);
  const relativePath = `packets/${task.id}.md`;
  if (write) {
    await mkdir(join(root, "packets"), { recursive: true });
    await writeFile(join(root, relativePath), content, "utf8");
  }
  return {
    path: relativePath, content,
    contextPlan: { includedIds: plan.includedIds, excludedIds: plan.excludedIds, budgetCharacters: plan.budgetCharacters, packetCharacters: plan.packetCharacters, overBudget: plan.overBudget }
  };
}
