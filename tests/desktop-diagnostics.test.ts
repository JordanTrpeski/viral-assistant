import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { saveTask } from "../src/tasks.js";
import { loadState, saveState } from "../src/state.js";
import type { DevelopmentTask } from "../src/types.js";
import type { HealthReport } from "../src/doctor.js";
import type { EfficiencySnapshot } from "../src/efficiency/types.js";
import { projectDiagnostics } from "../src/desktop/diagnostics.js";
import { fixture } from "./helpers.js";

function task(id: string, status: DevelopmentTask["status"], nextAction: string): DevelopmentTask {
  return { schemaVersion: 1, id, milestone: "M06_VIRAL_DESKTOP", objective: "o", status, acceptanceCriteria: [], dependencies: [], relevantFiles: [], notes: [], nextAction, verificationResult: null };
}

const healthyReport: HealthReport = { schemaVersion: 1, healthy: true, checks: [{ name: "Git", passed: true, detail: "ok" }] };
const telemetrySnapshot = (events: EfficiencySnapshot["events"]): EfficiencySnapshot => ({ schemaVersion: 1, updatedAt: "2026-09-12T00:00:00.000Z", nextSequence: events.length + 1, events });

test("projectDiagnostics combines task progress, token-usage proxy, health, logs, and errors", async () => {
  const root = await fixture();
  await saveTask(root, task("OBJ-1", "blocked", "Waiting on owner input."));
  await saveTask(root, task("OBJ-2", "complete", "Done."));
  await saveState(root, { ...(await loadState(root)), blockers: ["Awaiting owner decision on scope."] });

  await mkdir(join(root, ".viral", "logs"), { recursive: true });
  await writeFile(join(root, ".viral", "logs", "tasks-2026-09-12.jsonl"), `${JSON.stringify({ timestamp: "2026-09-12T00:00:00.000Z", taskId: "OBJ-2", status: "TASK_COMPLETED", attempt: 1, maxAttempts: 6, error: null, durationMs: 500 })}\n`, "utf8");

  const events = [{ schemaVersion: 1 as const, id: "eff-000001", occurredAt: "2026-09-12T00:00:00.000Z", type: "SELECTION" as const, taskId: "OBJ-2", tier: "CODING_HARNESS" as const, action: "EXECUTE" as const, effort: "MEDIUM" as const, harness: "claude" as const, model: null, reason: "Coding work requires Claude.", contextCharacters: 4200, contextBudgetCharacters: 12000, failureCount: 0, durationMs: null, succeeded: null }];

  const snapshot = await projectDiagnostics({
    root,
    doctor: async () => healthyReport,
    telemetry: { snapshot: async () => telemetrySnapshot(events) },
    now: () => new Date("2026-09-12T01:00:00.000Z")
  });

  assert.equal(snapshot.systemHealth.healthy, true);
  assert.equal(snapshot.tokenUsage.contextCharacters, 4200);
  assert.equal(snapshot.tokenUsage.contextBudgetCharacters, 12000);
  assert.equal(snapshot.tokenUsage.latestReason, "Coding work requires Claude.");
  assert.equal(snapshot.recentLogs.length, 1);
  assert.equal(snapshot.recentLogs[0]?.taskId, "OBJ-2");
  assert.deepEqual(snapshot.taskProgress.map((item) => item.id), ["OBJ-2", "OBJ-1"]);
  assert.deepEqual(snapshot.errors, ["Awaiting owner decision on scope.", "OBJ-1: Waiting on owner input."]);
});

test("projectDiagnostics reports no token usage yet when telemetry is empty", async () => {
  const root = await fixture();
  const snapshot = await projectDiagnostics({ root, doctor: async () => healthyReport, telemetry: { snapshot: async () => telemetrySnapshot([]) } });
  assert.deepEqual(snapshot.tokenUsage, { contextCharacters: null, contextBudgetCharacters: null, latestReason: null });
  assert.deepEqual(snapshot.errors, []);
});
