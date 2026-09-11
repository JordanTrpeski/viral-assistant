import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateCheckpoint } from "../checkpoint.js";
import { loadProjectContext } from "../context.js";
import { loadEfficiencyConfig } from "../efficiency/config.js";
import { EfficiencySessionPlanner, deriveSessionMetrics, type FreshSessionThresholds } from "../efficiency/session.js";
import type { EfficiencyConfig } from "../efficiency/types.js";
import { writeJson } from "../files.js";
import { inspectGit } from "../git.js";
import { operatingConstraints, prepareTaskPacket } from "../packet.js";
import { loadState, saveState } from "../state.js";
import { readTask } from "../tasks.js";
import type { VerificationReport } from "../types.js";
import type { DevelopmentHarness, HarnessSelectionRecord, PersistedHarnessRun } from "./types.js";

export interface HarnessExecutionOptions {
  reasoningEffort?: "low" | "medium" | "high";
  model?: string;
  selection?: HarnessSelectionRecord;
  freshSessionRecommended?: boolean;
}

const zeroThresholds: FreshSessionThresholds = { freshSessionCharacters: 0, freshSessionCompletedRatio: 0, freshSessionNoiseRatio: 0 };

async function loadConfigSafe(root: string): Promise<EfficiencyConfig | null> {
  try { return await loadEfficiencyConfig(root); }
  catch { return null; }
}

async function optionalJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch { return null; }
}

/**
 * Builds a compact, repository-derived fresh-session handoff (instead of the full task packet) when the
 * governor recommends starting a new session. The handoff reconstructs current state from durable files
 * only — no conversation replay — and still carries the mandatory operating constraints and the selection.
 */
async function prepareSessionHandoff(root: string, taskId: string, thresholds: FreshSessionThresholds, selection?: HarnessSelectionRecord): Promise<{ path: string; content: string }> {
  const [state, task, git, verification] = await Promise.all([
    loadState(root), readTask(root, taskId), inspectGit(root),
    optionalJson<VerificationReport>(join(root, "verification", "latest.json"))
  ]);
  const metrics = deriveSessionMetrics(task);
  const sessionState = {
    objective: task.objective,
    currentState: `${state.milestoneStatus}: ${state.nextAction}`,
    completedWork: state.completedTasks,
    unresolvedIssues: state.blockers,
    relevantFiles: task.relevantFiles,
    verification: verification?.results.map((result) => `${result.passed ? "PASS" : "FAIL"} — ${result.name}`) ?? [],
    gitState: `${git.branch} (${git.workingTreeStatus}; HEAD ${git.head.slice(0, 12)})`,
    nextAction: state.nextAction,
    contextCharacters: metrics.contextCharacters,
    completedContextRatio: metrics.completedContextRatio,
    noiseRatio: metrics.contextNoiseRatio
  };
  const plan = new EfficiencySessionPlanner(thresholds).plan(sessionState);
  const content = [
    plan.handoff, "", "## Operating Constraints", ...operatingConstraints,
    ...(selection ? ["", "## Efficiency Selection", `- Harness: ${selection.harness}`, `- Model: ${selection.model ?? "Harness default"}`, `- Reasoning effort: ${selection.effort}`, `- Practical reason: ${selection.reason}`] : [])
  ].join("\n");
  const relativePath = `packets/${task.id}.md`;
  await mkdir(join(root, "packets"), { recursive: true });
  await writeFile(join(root, relativePath), content, "utf8");
  return { path: relativePath, content };
}

export async function launchTask(root: string, harness: DevelopmentHarness, taskId: string, timeoutMs: number, options: HarnessExecutionOptions = {}): Promise<PersistedHarnessRun> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) throw new Error("timeoutMs must be an integer of at least 1000");
  await loadProjectContext(root);
  const config = await loadConfigSafe(root);
  const packet = options.freshSessionRecommended
    ? await prepareSessionHandoff(root, taskId, config ?? zeroThresholds, options.selection)
    : await prepareTaskPacket(root, taskId, true, options.selection,
        config ? { initialContextCharacters: config.initialContextCharacters, maximumContextCharacters: config.maximumContextCharacters } : undefined);
  const result = await harness.launch({ root, packet: packet.content, timeoutMs, ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}), ...(options.model ? { model: options.model } : {}) });
  const timestamp = result.startedAt.replace(/[^0-9]/g, "").slice(0, 17);
  const runId = `${timestamp}-${harness.id}-${taskId}`;
  const relativePath = `runs/${runId}.json`;
  const record: PersistedHarnessRun = { schemaVersion: 1, runId, taskId, packetPath: packet.path, ...result, ...(options.selection ? { selection: options.selection } : {}) };
  await mkdir(join(root, "runs"), { recursive: true });
  await writeJson(join(root, relativePath), record);
  const state = await loadState(root);
  await saveState(root, { ...state, lastHarnessRun: relativePath });
  await generateCheckpoint(root);
  return record;
}
