import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeEvent } from "../runtime/types.js";

export const taskLogStatuses = [
  "TASK_QUEUED", "TASK_EXECUTING", "TASK_COMPLETED", "TASK_FAILED", "TASK_RETRY_SCHEDULED", "TASK_RECOVERED"
] as const;
export type TaskLogStatus = (typeof taskLogStatuses)[number];
const loggedStatuses = new Set<string>(taskLogStatuses);
const terminalStatuses = new Set<TaskLogStatus>(["TASK_COMPLETED", "TASK_FAILED"]);

export interface TaskLogEntry {
  timestamp: string;
  taskId: string;
  status: TaskLogStatus;
  attempt: number;
  maxAttempts: number | null;
  error: string | null;
  durationMs: number | null;
}

function numberField(data: RuntimeEvent["data"], key: string): number | null {
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function stringField(data: RuntimeEvent["data"], key: string): string | null {
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function logFileFor(timestamp: string): string {
  const day = (Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp) : new Date()).toISOString().slice(0, 10);
  return `tasks-${day}.jsonl`;
}

/**
 * Append-only task execution log. One JSON object per line under .viral/logs/tasks-YYYY-MM-DD.jsonl.
 * Writes are serialized so lines never interleave; the writer never mutates or rewrites existing lines.
 */
export class TaskLogger {
  private readonly directory: string;
  private readonly starts = new Map<string, number>();
  private tail: Promise<void> = Promise.resolve();

  constructor(root: string) {
    this.directory = join(root, ".viral", "logs");
  }

  private toEntry(event: RuntimeEvent): TaskLogEntry | null {
    if (!loggedStatuses.has(event.type)) return null;
    const status = event.type as TaskLogStatus;
    const startedAt = Date.parse(event.occurredAt);
    if (status === "TASK_EXECUTING" && Number.isFinite(startedAt)) this.starts.set(event.taskId, startedAt);
    const start = this.starts.get(event.taskId);
    const durationMs = start !== undefined && Number.isFinite(startedAt) && status !== "TASK_EXECUTING" && status !== "TASK_QUEUED" && status !== "TASK_RECOVERED"
      ? startedAt - start
      : null;
    if (terminalStatuses.has(status)) this.starts.delete(event.taskId);
    return {
      timestamp: event.occurredAt,
      taskId: event.taskId,
      status,
      attempt: numberField(event.data, "attempt") ?? 0,
      maxAttempts: numberField(event.data, "maxAttempts"),
      error: stringField(event.data, "error"),
      durationMs
    };
  }

  /** Records a runtime event to the log if it is a task-lifecycle event; otherwise ignores it. */
  record(event: RuntimeEvent): void {
    const entry = this.toEntry(event);
    if (!entry) return;
    const line = `${JSON.stringify(entry)}\n`;
    const file = join(this.directory, logFileFor(entry.timestamp));
    this.tail = this.tail.then(async () => {
      await mkdir(this.directory, { recursive: true });
      await appendFile(file, line, "utf8");
    }).catch(() => { /* logging must never break the runtime */ });
  }

  /** Resolves once all queued appends have been written (useful for tests and clean shutdown). */
  async flush(): Promise<void> { await this.tail; }
}

/** Subscribes a TaskLogger to any event emitter exposing onEvent (e.g. ViralRuntime). Returns an unsubscribe. */
export function attachTaskLogger(emitter: { onEvent(listener: (event: RuntimeEvent) => void): () => void }, logger: TaskLogger): () => void {
  return emitter.onEvent((event) => logger.record(event));
}

/** Reads task log entries from the last `days` days, newest last. Read-only. */
export async function readTaskLogs(root: string, days = 1, now: Date = new Date()): Promise<TaskLogEntry[]> {
  const directory = join(root, ".viral", "logs");
  const cutoff = now.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1_000;
  let files: string[];
  try { files = (await readdir(directory)).filter((name) => name.startsWith("tasks-") && name.endsWith(".jsonl")); }
  catch { return []; }
  const entries: TaskLogEntry[] = [];
  for (const file of files.sort()) {
    let text: string;
    try { text = await readFile(join(directory, file), "utf8"); }
    catch { continue; }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as TaskLogEntry;
        if (loggedStatuses.has(entry.status) && Date.parse(entry.timestamp) >= cutoff) entries.push(entry);
      } catch { /* skip malformed lines rather than fail the whole read */ }
    }
  }
  return entries.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

export interface TaskSummary {
  completed: number;
  failed: number;
  waiting: number;
  failures: { taskId: string; attempt: number; maxAttempts: number | null }[];
}

/** Aggregates entries by the latest status per task. */
export function summarize(entries: TaskLogEntry[]): TaskSummary {
  const latest = new Map<string, TaskLogEntry>();
  for (const entry of entries) {
    const current = latest.get(entry.taskId);
    if (!current || Date.parse(entry.timestamp) >= Date.parse(current.timestamp)) latest.set(entry.taskId, entry);
  }
  const summary: TaskSummary = { completed: 0, failed: 0, waiting: 0, failures: [] };
  for (const entry of latest.values()) {
    if (entry.status === "TASK_COMPLETED") summary.completed += 1;
    else if (entry.status === "TASK_FAILED") {
      summary.failed += 1;
      summary.failures.push({ taskId: entry.taskId, attempt: entry.attempt, maxAttempts: entry.maxAttempts });
    } else summary.waiting += 1;
  }
  summary.failures.sort((left, right) => left.taskId.localeCompare(right.taskId));
  return summary;
}

export function formatSummary(summary: TaskSummary, days: number): string {
  const window = `Last ${Math.max(1, days) * 24}h`;
  const head = `${window}: ${summary.completed} completed, ${summary.failed} failed, ${summary.waiting} waiting.`;
  if (summary.failures.length === 0) return head;
  const failed = summary.failures.map((failure) => `${failure.taskId} (attempt ${failure.attempt}/${failure.maxAttempts ?? "?"})`).join(", ");
  return `${head} Failed: ${failed}.`;
}

export function taskHistory(entries: TaskLogEntry[], taskId: string): TaskLogEntry[] {
  return entries.filter((entry) => entry.taskId === taskId).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

export function formatTaskDetail(entries: TaskLogEntry[], taskId: string): string {
  const history = taskHistory(entries, taskId);
  if (history.length === 0) return `No log history for task ${taskId}.`;
  const lines = [`Task ${taskId} — ${history.length} event(s):`];
  for (const entry of history) {
    const parts = [`- ${entry.timestamp} ${entry.status} (attempt ${entry.attempt}${entry.maxAttempts ? `/${entry.maxAttempts}` : ""})`];
    if (entry.durationMs !== null) parts.push(`${entry.durationMs}ms`);
    if (entry.error) parts.push(`error: ${entry.error}`);
    lines.push(parts.join(" — "));
  }
  const final = history[history.length - 1]!;
  lines.push(`Final status: ${final.status}${final.error ? ` (${final.error})` : ""}`);
  return lines.join("\n");
}
