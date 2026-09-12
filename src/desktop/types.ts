import type { DevelopmentTask, TaskStatus } from "../types.js";
import type { HealthCheck } from "../doctor.js";
import type { TaskLogEntry } from "../efficiency/logs.js";
import type { SelectionDecision } from "../efficiency/types.js";
import type { ObjectiveExecution } from "../objective.js";

export type ChatRole = "owner" | "viral";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
}

/** Snapshot returned after every chat start/answer call and pushed over the WebSocket. */
export interface ChatState {
  taskId: string | null;
  objective: string;
  pendingQuestions: string[];
  decision: SelectionDecision | null;
  execution: ObjectiveExecution | null;
  messages: ChatMessage[];
}

/**
 * Deterministic progress heuristic for the left-sidebar task queue: DevelopmentTask carries no explicit
 * percent field, so status maps to a fixed percent (blocked counts as stalled at the same point as
 * in-progress rather than 0, since work has started).
 */
export const taskProgressByStatus: Record<TaskStatus, number> = {
  pending: 0,
  in_progress: 50,
  blocked: 50,
  complete: 100
};

export interface DesktopTaskSummary {
  id: string;
  milestone: string;
  objective: string;
  status: TaskStatus;
  progressPercent: number;
  nextAction: string;
}

export function toDesktopTaskSummary(task: DevelopmentTask): DesktopTaskSummary {
  return {
    id: task.id,
    milestone: task.milestone,
    objective: task.objective,
    status: task.status,
    progressPercent: taskProgressByStatus[task.status],
    nextAction: task.nextAction
  };
}

export interface TokenUsageSnapshot {
  /** Best-effort proxy: EFFICIENCY.md section 13 token/compute telemetry is not yet implemented, so
   *  context-character counts from the most recent efficiency event stand in until real token counts exist. */
  contextCharacters: number | null;
  contextBudgetCharacters: number | null;
  latestReason: string | null;
}

export interface DiagnosticsSnapshot {
  generatedAt: string;
  taskProgress: DesktopTaskSummary[];
  tokenUsage: TokenUsageSnapshot;
  systemHealth: { healthy: boolean; checks: HealthCheck[] };
  recentLogs: TaskLogEntry[];
  errors: string[];
}

export const desktopServerEventTypes = ["chat", "tasks", "diagnostics"] as const;
export type DesktopServerEventType = (typeof desktopServerEventTypes)[number];

export type DesktopServerEvent =
  | { type: "chat"; chat: ChatState }
  | { type: "tasks"; tasks: DesktopTaskSummary[] }
  | { type: "diagnostics"; diagnostics: DiagnosticsSnapshot };
