/**
 * Renderer-side mirror of the desktop daemon's wire contract (src/desktop/types.ts on the daemon side).
 * Kept as an independent copy rather than a cross-project import: the renderer only ever depends on the
 * versioned HTTP/WebSocket connector, never on the daemon's internal source (ARCHITECTURE.md 5d).
 */

export type ChatRole = "owner" | "viral";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
}

export type GovernorAction = "EXECUTE" | "WAITING_FOR_MODEL" | "OWNER_INPUT_REQUIRED" | "UNSURE";
export type CapabilityTier = "DETERMINISTIC" | "LOCAL_MODEL" | "CODING_HARNESS";
export type ReasoningEffort = "LOW" | "MEDIUM" | "HIGH";

export interface SelectionDecision {
  action: GovernorAction;
  tier: CapabilityTier;
  effort: ReasoningEffort;
  harness: string | null;
  reason: string;
  clarifyingQuestions?: string[];
}

export interface ObjectiveExecution {
  kind: CapabilityTier;
  succeeded: boolean;
  output: string | null;
}

export interface ChatState {
  taskId: string | null;
  objective: string;
  pendingQuestions: string[];
  decision: SelectionDecision | null;
  execution: ObjectiveExecution | null;
  messages: ChatMessage[];
}

export type TaskStatus = "pending" | "in_progress" | "blocked" | "complete";

export interface DesktopTaskSummary {
  id: string;
  milestone: string;
  objective: string;
  status: TaskStatus;
  progressPercent: number;
  nextAction: string;
}

export interface HealthCheck { name: string; passed: boolean; detail: string; }

export interface TokenUsageSnapshot {
  contextCharacters: number | null;
  contextBudgetCharacters: number | null;
  latestReason: string | null;
}

export interface TaskLogEntry {
  timestamp: string;
  taskId: string;
  status: string;
  attempt: number;
  maxAttempts: number | null;
  error: string | null;
  durationMs: number | null;
}

export interface DiagnosticsSnapshot {
  generatedAt: string;
  taskProgress: DesktopTaskSummary[];
  tokenUsage: TokenUsageSnapshot;
  systemHealth: { healthy: boolean; checks: HealthCheck[] };
  recentLogs: TaskLogEntry[];
  errors: string[];
}

export type DesktopServerEvent =
  | { type: "chat"; chat: ChatState }
  | { type: "tasks"; tasks: DesktopTaskSummary[] }
  | { type: "diagnostics"; diagnostics: DiagnosticsSnapshot };
