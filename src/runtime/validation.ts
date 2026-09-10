import { runtimeEventTypes, runtimeTaskStates, type JsonValue, type RetryPolicy, type RuntimeConditionSpec, type RuntimeEvent, type RuntimeSnapshot, type RuntimeTask } from "./types.js";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown, label: string): ObjectValue => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as ObjectValue;
};
const string = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
};
const nullableString = (value: unknown, label: string): string | null => value === null ? null : string(value, label);
const integer = (value: unknown, label: string, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${label} must be an integer of at least ${minimum}`);
  return value as number;
};
const finite = (value: unknown, label: string, minimum: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) throw new Error(`${label} must be a finite number of at least ${minimum}`);
  return value;
};
const timestamp = (value: unknown, label: string): string => {
  const result = string(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp`);
  return result;
};

export function validateJson(value: unknown, label: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => validateJson(item, `${label}[${index}]`));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, validateJson(item, `${label}.${key}`)]));
  throw new Error(`${label} must be JSON-compatible`);
}

export function validateRetryPolicy(value: unknown, label = "retryPolicy"): RetryPolicy {
  const data = object(value, label);
  const policy = {
    maxAttempts: integer(data.maxAttempts, `${label}.maxAttempts`, 1),
    initialBackoffMs: integer(data.initialBackoffMs, `${label}.initialBackoffMs`, 1),
    backoffMultiplier: finite(data.backoffMultiplier, `${label}.backoffMultiplier`, 1),
    maxBackoffMs: integer(data.maxBackoffMs, `${label}.maxBackoffMs`, 1)
  };
  if (policy.maxBackoffMs < policy.initialBackoffMs) throw new Error(`${label}.maxBackoffMs must be at least initialBackoffMs`);
  return policy;
}

export function validateCondition(value: unknown, label = "condition"): RuntimeConditionSpec {
  const data = object(value, label);
  return { type: string(data.type, `${label}.type`), parameters: validateJson(data.parameters, `${label}.parameters`) as { [key: string]: JsonValue } };
}

export function validateRuntimeTask(value: unknown, label = "runtime task"): RuntimeTask {
  const data = object(value, label);
  if (data.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must equal 1`);
  const state = string(data.state, `${label}.state`);
  if (!runtimeTaskStates.includes(state as RuntimeTask["state"])) throw new Error(`${label}.state is invalid: ${state}`);
  const recurrence = data.recurrence === null ? null : object(data.recurrence, `${label}.recurrence`);
  const owner = data.ownerInputRequired === null ? null : object(data.ownerInputRequired, `${label}.ownerInputRequired`);
  const resumeState = data.resumeState === null ? null : string(data.resumeState, `${label}.resumeState`);
  if (resumeState !== null && !runtimeTaskStates.includes(resumeState as RuntimeTask["state"])) throw new Error(`${label}.resumeState is invalid: ${resumeState}`);
  if (!Array.isArray(data.dependencies) || data.dependencies.some((item) => typeof item !== "string" || !item)) throw new Error(`${label}.dependencies must be an array of ids`);
  return {
    schemaVersion: 1, id: string(data.id, `${label}.id`), type: string(data.type, `${label}.type`), payload: validateJson(data.payload, `${label}.payload`),
    state: state as RuntimeTask["state"], createdAt: timestamp(data.createdAt, `${label}.createdAt`), updatedAt: timestamp(data.updatedAt, `${label}.updatedAt`),
    runAt: data.runAt === null ? null : timestamp(data.runAt, `${label}.runAt`),
    recurrence: recurrence === null ? null : { intervalMs: integer(recurrence.intervalMs, `${label}.recurrence.intervalMs`, 1) },
    retryPolicy: validateRetryPolicy(data.retryPolicy, `${label}.retryPolicy`), attemptCount: integer(data.attemptCount, `${label}.attemptCount`),
    failureCount: integer(data.failureCount, `${label}.failureCount`), nextAttemptAt: data.nextAttemptAt === null ? null : timestamp(data.nextAttemptAt, `${label}.nextAttemptAt`),
    dependencies: data.dependencies as string[], condition: data.condition === null ? null : validateCondition(data.condition, `${label}.condition`),
    ownerInputRequired: owner === null ? null : { prompt: string(owner.prompt, `${label}.ownerInputRequired.prompt`), requestedAt: timestamp(owner.requestedAt, `${label}.ownerInputRequired.requestedAt`) },
    ownerInputProvided: typeof data.ownerInputProvided === "boolean" ? data.ownerInputProvided : (() => { throw new Error(`${label}.ownerInputProvided must be boolean`); })(),
    ownerInputResponse: validateJson(data.ownerInputResponse, `${label}.ownerInputResponse`), resumeState: resumeState as RuntimeTask["resumeState"],
    result: validateJson(data.result, `${label}.result`), lastError: nullableString(data.lastError, `${label}.lastError`),
    occurrenceCount: integer(data.occurrenceCount, `${label}.occurrenceCount`), lastCompletedAt: data.lastCompletedAt === null ? null : timestamp(data.lastCompletedAt, `${label}.lastCompletedAt`),
    scheduledStartPending: typeof data.scheduledStartPending === "boolean" ? data.scheduledStartPending : (() => { throw new Error(`${label}.scheduledStartPending must be boolean`); })()
  };
}

function validateEvent(value: unknown, label: string): RuntimeEvent {
  const data = object(value, label);
  if (data.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must equal 1`);
  const type = string(data.type, `${label}.type`);
  if (!runtimeEventTypes.includes(type as RuntimeEvent["type"])) throw new Error(`${label}.type is invalid: ${type}`);
  return { schemaVersion: 1, id: string(data.id, `${label}.id`), type: type as RuntimeEvent["type"], taskId: string(data.taskId, `${label}.taskId`), occurredAt: timestamp(data.occurredAt, `${label}.occurredAt`), data: validateJson(data.data, `${label}.data`) };
}

export function validateRuntimeSnapshot(value: unknown): RuntimeSnapshot {
  const data = object(value, "runtime snapshot");
  if (data.schemaVersion !== 1) throw new Error("runtime snapshot.schemaVersion must equal 1");
  if (!Array.isArray(data.tasks) || !Array.isArray(data.events)) throw new Error("runtime snapshot tasks and events must be arrays");
  const tasks = data.tasks.map((task, index) => validateRuntimeTask(task, `runtime snapshot.tasks[${index}]`));
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error("runtime snapshot contains duplicate task ids");
  return {
    schemaVersion: 1, updatedAt: timestamp(data.updatedAt, "runtime snapshot.updatedAt"),
    nextEventSequence: integer(data.nextEventSequence, "runtime snapshot.nextEventSequence"), tasks,
    events: data.events.map((event, index) => validateEvent(event, `runtime snapshot.events[${index}]`))
  };
}
