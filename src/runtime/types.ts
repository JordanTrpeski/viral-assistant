export const runtimeTaskStates = [
  "QUEUED", "RUNNING", "SCHEDULED", "WAITING_FOR_TIME", "WAITING_FOR_CONDITION", "WAITING_FOR_MODEL",
  "WAITING_FOR_OWNER", "PAUSED", "VERIFYING", "COMPLETED", "FAILED"
] as const;
export type RuntimeTaskState = (typeof runtimeTaskStates)[number];

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface RetryPolicy {
  maxAttempts: number;
  initialBackoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

export interface Recurrence { intervalMs: number; }
export interface RuntimeConditionSpec { type: string; parameters: { [key: string]: JsonValue }; }
export interface OwnerInputRequirement { prompt: string; requestedAt: string; }

export interface RuntimeTask {
  schemaVersion: 1;
  id: string;
  type: string;
  payload: JsonValue;
  state: RuntimeTaskState;
  createdAt: string;
  updatedAt: string;
  runAt: string | null;
  recurrence: Recurrence | null;
  retryPolicy: RetryPolicy;
  attemptCount: number;
  failureCount: number;
  nextAttemptAt: string | null;
  dependencies: string[];
  condition: RuntimeConditionSpec | null;
  ownerInputRequired: OwnerInputRequirement | null;
  ownerInputProvided: boolean;
  ownerInputResponse: JsonValue;
  resumeState: RuntimeTaskState | null;
  result: JsonValue;
  lastError: string | null;
  occurrenceCount: number;
  lastCompletedAt: string | null;
  scheduledStartPending: boolean;
}

export const runtimeEventTypes = [
  "TASK_COMPLETED", "TASK_FAILED", "OWNER_INPUT_REQUIRED", "WAITING_FOR_MODEL", "SCHEDULED_TASK_STARTED",
  "TASK_RETRY_SCHEDULED", "TASK_PAUSED", "TASK_RESUMED", "TASK_RECOVERED"
] as const;
export type RuntimeEventType = (typeof runtimeEventTypes)[number];

export interface RuntimeEvent {
  schemaVersion: 1;
  id: string;
  type: RuntimeEventType;
  taskId: string;
  occurredAt: string;
  data: JsonValue;
}

export interface RuntimeSnapshot {
  schemaVersion: 1;
  updatedAt: string;
  nextEventSequence: number;
  tasks: RuntimeTask[];
  events: RuntimeEvent[];
}

export interface RuntimeStore {
  load(): Promise<RuntimeSnapshot | null>;
  save(snapshot: RuntimeSnapshot): Promise<void>;
}

export interface EnqueueRequest {
  id: string;
  type: string;
  payload?: JsonValue;
  runAt?: string;
  recurrence?: Recurrence;
  retryPolicy?: Partial<RetryPolicy>;
  dependencies?: string[];
}

export type HandlerOutcome =
  | { type: "completed"; result: JsonValue }
  | { type: "failed"; error: string }
  | { type: "owner_input_required"; prompt: string }
  | { type: "waiting_for_condition"; condition: RuntimeConditionSpec }
  | { type: "waiting_for_model"; condition: RuntimeConditionSpec };

export interface HandlerContext { signal: AbortSignal; now: string; }
export interface VerificationOutcome { passed: boolean; error: string | null; }

export interface RuntimeTaskHandler {
  readonly type: string;
  execute(task: RuntimeTask, context: HandlerContext): Promise<HandlerOutcome>;
  verify?(task: RuntimeTask, result: JsonValue, context: HandlerContext): Promise<VerificationOutcome>;
}

export interface RuntimeCondition {
  readonly type: string;
  evaluate(spec: RuntimeConditionSpec, task: RuntimeTask): Promise<boolean>;
}

export interface RuntimeClock { now(): Date; }
export interface RuntimeSleeper { wait(milliseconds: number, signal: AbortSignal): Promise<void>; }
export type RuntimeEventListener = (event: RuntimeEvent) => void;
