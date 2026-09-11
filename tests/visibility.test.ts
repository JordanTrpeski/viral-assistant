import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ViralRuntime } from "../src/runtime/engine.js";
import {
  TaskLogger, attachTaskLogger, formatSummary, formatTaskDetail, readTaskLogs, summarize, taskHistory,
  type TaskLogEntry
} from "../src/efficiency/logs.js";
import { FakeClock, MemoryRuntimeStore, handler } from "./runtime-helpers.js";

const workHandler = handler("work", async (task) => {
  const payload = task.payload as { fail?: boolean };
  if (payload.fail) return { type: "failed", error: "intentional failure" };
  return { type: "completed", result: { ok: true } };
});

async function fixtureRoot(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  return await mkdtemp(join(tmpdir(), "viral-visibility-"));
}

const near = new Date("2026-01-01T02:00:00.000Z"); // a "now" within a day of the FakeClock timestamps

test("running tasks writes an append-only JSONL log with the correct lifecycle events and fields", async () => {
  const root = await fixtureRoot();
  const clock = new FakeClock();
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [workHandler], [], clock);
  const logger = new TaskLogger(root);
  attachTaskLogger(runtime, logger);

  await runtime.enqueue({ id: "T1", type: "work", payload: { fail: false } });
  await runtime.enqueue({ id: "T2", type: "work", payload: { fail: true }, retryPolicy: { maxAttempts: 2, initialBackoffMs: 1_000, backoffMultiplier: 2, maxBackoffMs: 60_000 } });
  await runtime.enqueue({ id: "T3", type: "work", payload: { fail: false } });

  await runtime.tick();            // T1 completes, T2 fails (retry scheduled), T3 completes
  clock.advance(1_000);
  await runtime.tick();            // T2 retried, exhausts attempts, FAILS
  await logger.flush();

  const raw = await readFile(join(root, ".viral", "logs", "tasks-2026-01-01.jsonl"), "utf8");
  const lines = raw.trim().split("\n");
  for (const line of lines) JSON.parse(line);                       // every line is valid JSON (append-only jsonl)

  const entries = await readTaskLogs(root, 1, near);
  const statuses = new Set(entries.map((entry) => entry.status));
  for (const expected of ["TASK_QUEUED", "TASK_EXECUTING", "TASK_COMPLETED", "TASK_RETRY_SCHEDULED", "TASK_FAILED"]) {
    assert.ok(statuses.has(expected as TaskLogEntry["status"]), `missing ${expected}`);
  }
  const sample = entries.find((entry) => entry.status === "TASK_COMPLETED")!;
  assert.deepEqual(Object.keys(sample).sort(), ["attempt", "durationMs", "error", "maxAttempts", "status", "taskId", "timestamp"]);
  const failed = entries.find((entry) => entry.taskId === "T2" && entry.status === "TASK_FAILED")!;
  assert.equal(failed.attempt, 2);
  assert.equal(failed.maxAttempts, 2);
  assert.equal(failed.error, "intentional failure");

  const summary = summarize(entries);
  assert.equal(summary.completed, 2);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.failures, [{ taskId: "T2", attempt: 2, maxAttempts: 2 }]);
});

test("summary output matches the documented human-readable format", () => {
  const entry = (taskId: string, status: TaskLogEntry["status"], extra: Partial<TaskLogEntry> = {}): TaskLogEntry => ({
    timestamp: "2026-01-01T00:00:00.000Z", taskId, status, attempt: 1, maxAttempts: null, error: null, durationMs: null, ...extra
  });
  const entries: TaskLogEntry[] = [
    entry("a", "TASK_COMPLETED"), entry("b", "TASK_COMPLETED"), entry("c", "TASK_COMPLETED"),
    entry("email-validator", "TASK_FAILED", { attempt: 3, maxAttempts: 3, error: "bad assertion" }),
    entry("d", "TASK_EXECUTING"), entry("e", "TASK_QUEUED")
  ];
  const summary = summarize(entries);
  assert.deepEqual([summary.completed, summary.failed, summary.waiting], [3, 1, 2]);
  assert.equal(formatSummary(summary, 1), "Last 24h: 3 completed, 1 failed, 2 waiting. Failed: email-validator (attempt 3/3).");
  assert.equal(formatSummary(summarize([entry("a", "TASK_COMPLETED")]), 2), "Last 48h: 1 completed, 0 failed, 0 waiting.");
});

test("task-detail shows the full retry history and final status for a failed task", async () => {
  const root = await fixtureRoot();
  const clock = new FakeClock();
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [workHandler], [], clock);
  const logger = new TaskLogger(root);
  attachTaskLogger(runtime, logger);

  await runtime.enqueue({ id: "flaky", type: "work", payload: { fail: true }, retryPolicy: { maxAttempts: 3, initialBackoffMs: 1_000, backoffMultiplier: 2, maxBackoffMs: 60_000 } });
  await runtime.tick();
  clock.advance(1_000);
  await runtime.tick();
  clock.advance(2_000);
  await runtime.tick();
  await logger.flush();

  const entries = await readTaskLogs(root, 1, near);
  const history = taskHistory(entries, "flaky");
  assert.equal(history.filter((entry) => entry.status === "TASK_EXECUTING").length, 3);
  assert.equal(history.filter((entry) => entry.status === "TASK_RETRY_SCHEDULED").length, 2);
  assert.equal(history.filter((entry) => entry.status === "TASK_FAILED").length, 1);

  const detail = formatTaskDetail(entries, "flaky");
  assert.match(detail, /Task flaky/);
  assert.match(detail, /TASK_RETRY_SCHEDULED/);
  assert.match(detail, /Final status: TASK_FAILED/);
  assert.match(detail, /intentional failure/);
  assert.equal(formatTaskDetail(entries, "does-not-exist"), "No log history for task does-not-exist.");
});
