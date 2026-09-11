import type {
  EnqueueRequest, HandlerOutcome, JsonValue, RetryPolicy, RuntimeClock, RuntimeCondition, RuntimeEvent,
  RuntimeEventListener, RuntimeSnapshot, RuntimeStore, RuntimeTask, RuntimeTaskHandler, RuntimeTaskState
} from "./types.js";
import { validateCondition, validateJson, validateRetryPolicy } from "./validation.js";

const defaultRetryPolicy: RetryPolicy = { maxAttempts: 1, initialBackoffMs: 1_000, backoffMultiplier: 2, maxBackoffMs: 60_000 };
const terminalStates = new Set<RuntimeTaskState>(["COMPLETED", "FAILED"]);
const maximumStoredEvents = 10_000;
export const systemClock: RuntimeClock = { now: () => new Date() };

function due(timestamp: string | null, now: number): boolean { return timestamp !== null && Date.parse(timestamp) <= now; }
function requireText(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must be non-empty`);
  return value;
}

export class ViralRuntime {
  private snapshot: RuntimeSnapshot | null = null;
  private readonly handlers: Map<string, RuntimeTaskHandler>;
  private readonly conditions: Map<string, RuntimeCondition>;
  private readonly listeners = new Set<RuntimeEventListener>();
  private ticking = false;

  constructor(private readonly store: RuntimeStore, handlers: RuntimeTaskHandler[], conditions: RuntimeCondition[], private readonly clock: RuntimeClock = systemClock) {
    this.handlers = new Map(handlers.map((handler) => [handler.type, handler]));
    this.conditions = new Map(conditions.map((condition) => [condition.type, condition]));
    if (this.handlers.size !== handlers.length) throw new Error("Runtime handler types must be unique");
    if (this.conditions.size !== conditions.length) throw new Error("Runtime condition types must be unique");
  }

  async initialize(): Promise<void> {
    if (this.snapshot) return;
    const now = this.clock.now().toISOString();
    const loaded = await this.store.load();
    this.snapshot = loaded ?? { schemaVersion: 1, updatedAt: now, nextEventSequence: 1, tasks: [], events: [] };
    let recovered = false;
    for (const task of this.snapshot.tasks) {
      if (task.state === "RUNNING" || task.state === "VERIFYING") {
        task.state = "QUEUED";
        task.updatedAt = now;
        task.lastError = "Recovered after runtime interruption; handler execution may be retried.";
        this.emit("TASK_RECOVERED", task, { previousState: "interrupted", attempt: task.attemptCount });
        recovered = true;
      }
    }
    if (recovered || !loaded) await this.persist();
  }

  private state(): RuntimeSnapshot {
    if (!this.snapshot) throw new Error("Runtime is not initialized");
    return this.snapshot;
  }

  private now(): string { return this.clock.now().toISOString(); }

  private emit(type: RuntimeEvent["type"], task: RuntimeTask, data: JsonValue): RuntimeEvent {
    const state = this.state();
    const event: RuntimeEvent = {
      schemaVersion: 1, id: `event-${state.nextEventSequence++}`, type, taskId: task.id, occurredAt: this.now(), data
    };
    state.events.push(event);
    if (state.events.length > maximumStoredEvents) state.events.splice(0, state.events.length - maximumStoredEvents);
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch { /* Event consumers cannot stop the runtime. */ }
    }
    return event;
  }

  private async persist(): Promise<void> {
    const state = this.state();
    state.updatedAt = this.now();
    await this.store.save(state);
  }

  onEvent(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    await this.initialize();
    return structuredClone(this.state());
  }

  async enqueue(request: EnqueueRequest): Promise<RuntimeTask> {
    await this.initialize();
    const state = this.state();
    const id = requireText(request.id, "task id");
    const type = requireText(request.type, "task type");
    if (state.tasks.some((task) => task.id === id)) throw new Error(`Runtime task already exists: ${id}`);
    const dependencies = [...new Set(request.dependencies ?? [])];
    if (dependencies.includes(id)) throw new Error("A task cannot depend on itself");
    for (const dependency of dependencies) if (!state.tasks.some((task) => task.id === dependency)) throw new Error(`Unknown task dependency: ${dependency}`);
    const now = this.now();
    const runAt = request.runAt ?? null;
    if (runAt !== null && !Number.isFinite(Date.parse(runAt))) throw new Error("runAt must be an ISO timestamp");
    const recurrence = request.recurrence ?? null;
    if (recurrence && (!Number.isSafeInteger(recurrence.intervalMs) || recurrence.intervalMs < 1)) throw new Error("recurrence.intervalMs must be a positive integer");
    const retryPolicy = validateRetryPolicy({ ...defaultRetryPolicy, ...request.retryPolicy });
    const task: RuntimeTask = {
      schemaVersion: 1, id, type, payload: validateJson(request.payload ?? null, "task payload"),
      state: runAt !== null && Date.parse(runAt) > Date.parse(now) ? "SCHEDULED" : "QUEUED",
      createdAt: now, updatedAt: now, runAt, recurrence, retryPolicy, attemptCount: 0, failureCount: 0,
      nextAttemptAt: null, dependencies, condition: null, ownerInputRequired: null, ownerInputProvided: false,
      ownerInputResponse: null, resumeState: null, result: null, lastError: null, occurrenceCount: 0,
      lastCompletedAt: null, scheduledStartPending: runAt !== null && Date.parse(runAt) <= Date.parse(now)
    };
    state.tasks.push(task);
    this.emit("TASK_QUEUED", task, { attempt: task.attemptCount });
    await this.persist();
    return structuredClone(task);
  }

  async pause(taskId: string): Promise<RuntimeTask> {
    await this.initialize();
    const task = this.requireTask(taskId);
    if (terminalStates.has(task.state)) throw new Error(`Cannot pause task in ${task.state}`);
    if (task.state !== "PAUSED") {
      task.resumeState = task.state === "RUNNING" || task.state === "VERIFYING" ? "QUEUED" : task.state;
      task.state = "PAUSED";
      task.updatedAt = this.now();
      this.emit("TASK_PAUSED", task, null);
      await this.persist();
    }
    return structuredClone(task);
  }

  async resume(taskId: string): Promise<RuntimeTask> {
    await this.initialize();
    const task = this.requireTask(taskId);
    if (task.state !== "PAUSED") throw new Error("Only a paused task can be resumed");
    task.state = task.resumeState ?? "QUEUED";
    task.resumeState = null;
    task.updatedAt = this.now();
    this.emit("TASK_RESUMED", task, { state: task.state });
    await this.persist();
    return structuredClone(task);
  }

  async supplyOwnerInput(taskId: string, response: JsonValue): Promise<RuntimeTask> {
    await this.initialize();
    const task = this.requireTask(taskId);
    if (task.state !== "WAITING_FOR_OWNER" || !task.ownerInputRequired) throw new Error("Task is not waiting for owner input");
    task.ownerInputResponse = validateJson(response, "owner response");
    task.ownerInputProvided = true;
    task.ownerInputRequired = null;
    task.state = "QUEUED";
    task.updatedAt = this.now();
    await this.persist();
    return structuredClone(task);
  }

  private requireTask(taskId: string): RuntimeTask {
    const task = this.state().tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Unknown runtime task: ${taskId}`);
    return task;
  }

  private async fail(task: RuntimeTask, error: string): Promise<void> {
    task.failureCount += 1;
    task.lastError = error.slice(0, 2_000);
    task.updatedAt = this.now();
    if (task.failureCount < task.retryPolicy.maxAttempts) {
      const delay = Math.min(task.retryPolicy.initialBackoffMs * task.retryPolicy.backoffMultiplier ** (task.failureCount - 1), task.retryPolicy.maxBackoffMs);
      task.nextAttemptAt = new Date(this.clock.now().getTime() + delay).toISOString();
      task.state = "WAITING_FOR_TIME";
      this.emit("TASK_RETRY_SCHEDULED", task, { failureCount: task.failureCount, nextAttemptAt: task.nextAttemptAt, attempt: task.attemptCount, maxAttempts: task.retryPolicy.maxAttempts, error: task.lastError });
    } else {
      task.state = "FAILED";
      task.nextAttemptAt = null;
      this.emit("TASK_FAILED", task, { error: task.lastError, failureCount: task.failureCount, attempt: task.attemptCount, maxAttempts: task.retryPolicy.maxAttempts });
    }
    await this.persist();
  }

  private async complete(task: RuntimeTask, result: JsonValue): Promise<void> {
    const now = this.now();
    task.result = result;
    task.lastCompletedAt = now;
    task.occurrenceCount += 1;
    task.failureCount = 0;
    task.lastError = null;
    task.condition = null;
    task.nextAttemptAt = null;
    task.ownerInputRequired = null;
    this.emit("TASK_COMPLETED", task, { occurrence: task.occurrenceCount, attempt: task.attemptCount });
    if (task.recurrence) {
      const nowMs = this.clock.now().getTime();
      let next = (task.runAt ? Date.parse(task.runAt) : nowMs) + task.recurrence.intervalMs;
      while (next <= nowMs) next += task.recurrence.intervalMs;
      task.runAt = new Date(next).toISOString();
      task.state = "SCHEDULED";
      task.scheduledStartPending = false;
      task.ownerInputProvided = false;
      task.ownerInputResponse = null;
    } else task.state = "COMPLETED";
    task.updatedAt = now;
    await this.persist();
  }

  private async handleOutcome(task: RuntimeTask, handler: RuntimeTaskHandler, outcome: HandlerOutcome, signal: AbortSignal): Promise<void> {
    if (outcome.type === "failed") return await this.fail(task, outcome.error);
    if (outcome.type === "owner_input_required") {
      task.state = "WAITING_FOR_OWNER";
      task.ownerInputRequired = { prompt: requireText(outcome.prompt, "owner input prompt"), requestedAt: this.now() };
      task.ownerInputProvided = false;
      task.ownerInputResponse = null;
      task.updatedAt = this.now();
      this.emit("OWNER_INPUT_REQUIRED", task, { prompt: task.ownerInputRequired.prompt });
      return await this.persist();
    }
    if (outcome.type === "waiting_for_condition" || outcome.type === "waiting_for_model") {
      task.state = outcome.type === "waiting_for_model" ? "WAITING_FOR_MODEL" : "WAITING_FOR_CONDITION";
      task.condition = validateCondition(outcome.condition);
      task.updatedAt = this.now();
      if (outcome.type === "waiting_for_model") this.emit("WAITING_FOR_MODEL", task, { conditionType: task.condition.type });
      return await this.persist();
    }
    task.state = "VERIFYING";
    task.updatedAt = this.now();
    await this.persist();
    if (signal.aborted) return;
    if (handler.verify) {
      try {
        const verification = await handler.verify(structuredClone(task), outcome.result, { signal, now: this.now() });
        if (!verification.passed) return await this.fail(task, verification.error ?? "Task verification failed");
      } catch (error) {
        if (signal.aborted) return;
        return await this.fail(task, `Task verification threw: ${(error as Error).message}`);
      }
    }
    await this.complete(task, outcome.result);
  }

  async tick(signal: AbortSignal = new AbortController().signal): Promise<void> {
    await this.initialize();
    if (this.ticking || signal.aborted) return;
    this.ticking = true;
    try {
      for (const task of this.state().tasks) {
        if (signal.aborted) break;
        const nowMs = this.clock.now().getTime();
        if (task.state === "SCHEDULED" && due(task.runAt, nowMs)) {
          task.state = "QUEUED";
          task.scheduledStartPending = true;
          task.updatedAt = this.now();
        } else if (task.state === "WAITING_FOR_TIME" && due(task.nextAttemptAt, nowMs)) {
          task.state = "QUEUED";
          task.nextAttemptAt = null;
          task.updatedAt = this.now();
        } else if (task.state === "WAITING_FOR_CONDITION" || task.state === "WAITING_FOR_MODEL") {
          const condition = task.condition ? this.conditions.get(task.condition.type) : null;
          if (!condition || !task.condition) continue;
          let ready = false;
          try { ready = await condition.evaluate(task.condition, structuredClone(task)); }
          catch (error) { task.lastError = `Condition check failed: ${(error as Error).message}`; task.updatedAt = this.now(); await this.persist(); }
          if (!ready) continue;
          task.state = "QUEUED";
          task.condition = null;
          task.lastError = null;
          task.updatedAt = this.now();
        }
        if (task.state !== "QUEUED") continue;

        const dependencies = task.dependencies.map((id) => this.requireTask(id));
        const failedDependency = dependencies.find((dependency) => dependency.state === "FAILED");
        if (failedDependency) { await this.fail(task, `Dependency failed: ${failedDependency.id}`); continue; }
        if (dependencies.some((dependency) => dependency.state !== "COMPLETED")) continue;

        const handler = this.handlers.get(task.type);
        if (!handler) { await this.fail(task, `No runtime handler registered for type: ${task.type}`); continue; }
        task.state = "RUNNING";
        task.attemptCount += 1;
        task.updatedAt = this.now();
        this.emit("TASK_EXECUTING", task, { attempt: task.attemptCount, maxAttempts: task.retryPolicy.maxAttempts });
        if (task.scheduledStartPending) {
          task.scheduledStartPending = false;
          this.emit("SCHEDULED_TASK_STARTED", task, { runAt: task.runAt });
        }
        await this.persist();
        try {
          const outcome = await handler.execute(structuredClone(task), { signal, now: this.now() });
          if (signal.aborted) { await this.persist(); break; }
          await this.handleOutcome(task, handler, outcome, signal);
        } catch (error) {
          if (signal.aborted) { await this.persist(); break; }
          await this.fail(task, `Task handler threw: ${(error as Error).message}`);
        }
      }
    } finally { this.ticking = false; }
  }
}
