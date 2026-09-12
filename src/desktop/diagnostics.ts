import type { HealthReport } from "../doctor.js";
import { readTaskLogs } from "../efficiency/logs.js";
import type { EfficiencyRecorder } from "../efficiency/types.js";
import { loadState } from "../state.js";
import { projectTaskQueue } from "./tasks.js";
import type { DiagnosticsSnapshot, TokenUsageSnapshot } from "./types.js";

export interface DiagnosticsDependencies {
  root: string;
  doctor(): Promise<HealthReport>;
  telemetry: Pick<EfficiencyRecorder, "snapshot">;
  now?: () => Date;
  recentLogDays?: number;
}

async function tokenUsage(telemetry: Pick<EfficiencyRecorder, "snapshot">): Promise<TokenUsageSnapshot> {
  const snapshot = await telemetry.snapshot();
  const latest = snapshot.events.at(-1) ?? null;
  return {
    contextCharacters: latest?.contextCharacters ?? null,
    contextBudgetCharacters: latest?.contextBudgetCharacters ?? null,
    latestReason: latest?.reason ?? null
  };
}

/** Assembles the right-sidebar diagnostic panel: task progress, best-effort token usage, system health
 *  (reusing the M00 doctor checks), recent task-lifecycle logs, and current blockers/failure notes. */
export async function projectDiagnostics(deps: DiagnosticsDependencies): Promise<DiagnosticsSnapshot> {
  const now = deps.now ?? (() => new Date());
  const [taskProgress, health, usage, state, logs] = await Promise.all([
    projectTaskQueue(deps.root),
    deps.doctor(),
    tokenUsage(deps.telemetry),
    loadState(deps.root),
    readTaskLogs(deps.root, deps.recentLogDays ?? 1, now())
  ]);
  const failureNotes = taskProgress.filter((task) => task.status === "blocked").map((task) => `${task.id}: ${task.nextAction}`);
  return {
    generatedAt: now().toISOString(),
    taskProgress,
    tokenUsage: usage,
    systemHealth: { healthy: health.healthy, checks: health.checks },
    recentLogs: logs.slice(-50),
    errors: [...state.blockers, ...failureNotes]
  };
}
