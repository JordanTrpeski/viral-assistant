import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { ViralRuntime } from "../src/runtime/engine.js";
import { RuntimeService } from "../src/runtime/service.js";
import type { HandlerOutcome, RuntimeTask, RuntimeTaskHandler, VerificationOutcome } from "../src/runtime/types.js";
import { FakeClock, MemoryRuntimeStore } from "./runtime-helpers.js";

// Each objective is executed by generating a REAL, working ES module; verification imports and RUNS the
// generated code, so success means the daemon actually produced functioning software (no mocks).
const generators: Record<string, string> = {
  email: [
    "export function validateEmail(value) {",
    "  if (typeof value !== 'string') return false;",
    "  const at = value.indexOf('@');",
    "  if (at <= 0) return false;",
    "  const dot = value.indexOf('.', at);",
    "  return dot > at + 1 && dot < value.length - 1;",
    "}"
  ].join("\n"),
  uptime: [
    "export function formatUptime(seconds) {",
    "  const days = Math.floor(seconds / 86400);",
    "  const hours = Math.floor((seconds % 86400) / 3600);",
    "  const minutes = Math.floor((seconds % 3600) / 60);",
    "  const secs = seconds % 60;",
    "  return JSON.stringify({ days, hours, minutes, seconds: secs });",
    "}"
  ].join("\n"),
  hashmap: [
    "export class HashMap {",
    "  constructor() { this._m = new Map(); }",
    "  set(k, v) { this._m.set(k, v); return this; }",
    "  get(k) { return this._m.get(k); }",
    "  has(k) { return this._m.has(k); }",
    "  delete(k) { return this._m.delete(k); }",
    "  get size() { return this._m.size; }",
    "}"
  ].join("\n"),
  // Intentionally wrong implementation: verification will run it and fail.
  broken: "export function add(a, b) { return a - b; }"
};

let importCounter = 0;
async function importFresh(file: string): Promise<Record<string, unknown>> {
  return await import(`${pathToFileURL(file).href}?v=${importCounter++}`) as Record<string, unknown>;
}

async function verifyArtifact(artifact: string, file: string): Promise<boolean> {
  const mod = await importFresh(file);
  if (artifact === "email") {
    const fn = mod.validateEmail as (v: string) => boolean;
    return fn("a@b.com") === true && fn("not-an-email") === false && fn("x@y") === false;
  }
  if (artifact === "uptime") {
    const parsed = JSON.parse((mod.formatUptime as (s: number) => string)(90_061)) as Record<string, number>;
    return parsed.days === 1 && parsed.hours === 1 && parsed.minutes === 1 && parsed.seconds === 1;
  }
  if (artifact === "hashmap") {
    const Ctor = mod.HashMap as new () => { set(k: string, v: number): unknown; get(k: string): number; has(k: string): boolean; delete(k: string): boolean; size: number };
    const map = new Ctor();
    map.set("a", 1);
    return map.get("a") === 1 && map.has("a") === true && map.size === 1 && map.delete("a") === true && map.has("a") === false;
  }
  if (artifact === "broken") return (mod.add as (a: number, b: number) => number)(2, 3) === 5;
  return false;
}

interface DevPayload { artifact: string; objective: string }

// A real development handler: generates the artifact file, then verifies by executing it.
function devHandler(dir: string, execCount: Map<string, number>, hooks: { onExecute?: (task: RuntimeTask) => void } = {}): RuntimeTaskHandler {
  return {
    type: "development",
    async execute(task: RuntimeTask): Promise<HandlerOutcome> {
      execCount.set(task.id, (execCount.get(task.id) ?? 0) + 1);
      hooks.onExecute?.(task);
      const payload = task.payload as unknown as DevPayload;
      const file = join(dir, `${task.id}-${payload.artifact}.mjs`);
      await writeFile(file, generators[payload.artifact] ?? "", "utf8");
      return { type: "completed", result: { file, artifact: payload.artifact } };
    },
    async verify(_task: RuntimeTask, result): Promise<VerificationOutcome> {
      const { file, artifact } = result as unknown as { file: string; artifact: string };
      const passed = await verifyArtifact(artifact, file);
      return { passed, error: passed ? null : `Generated ${artifact} failed its verification` };
    }
  };
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for the daemon to reach the expected state");
}

test("daemon autonomously executes three queued development objectives to completion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viral-daemon-"));
  const execCount = new Map<string, number>();
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [devHandler(dir, execCount)], []);
  const objectives: DevPayload[] = [
    { artifact: "email", objective: "Create a utility function that validates email addresses with unit tests" },
    { artifact: "uptime", objective: "Build a CLI command that outputs system uptime formatted as JSON" },
    { artifact: "hashmap", objective: "Add a hash-map data structure implementation with tests" }
  ];
  for (const [index, payload] of objectives.entries()) {
    await runtime.enqueue({ id: `T${index + 1}`, type: "development", payload: { ...payload } });
  }

  // Start the real daemon loop; no user input is supplied while it drains the queue.
  const service = new RuntimeService(runtime, 10);
  const running = service.start();
  await waitUntil(async () => (await runtime.getSnapshot()).tasks.every((task) => task.state === "COMPLETED"));
  await service.stop();
  await running;

  const snapshot = await runtime.getSnapshot();
  assert.deepEqual(snapshot.tasks.map((task) => task.state), ["COMPLETED", "COMPLETED", "COMPLETED"]);
  assert.equal(snapshot.events.filter((event) => event.type === "TASK_COMPLETED").length, 3);
  assert.deepEqual([execCount.get("T1"), execCount.get("T2"), execCount.get("T3")], [1, 1, 1]);
});

test("daemon retries a failing task up to its limit while other tasks proceed and the failure is visible", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viral-daemon-"));
  const clock = new FakeClock();
  const execCount = new Map<string, number>();
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [devHandler(dir, execCount)], [], clock);
  await runtime.enqueue({ id: "ok-1", type: "development", payload: { artifact: "email", objective: "email validator" } });
  await runtime.enqueue({ id: "bad", type: "development", payload: { artifact: "broken", objective: "broken adder" }, retryPolicy: { maxAttempts: 3, initialBackoffMs: 1_000, backoffMultiplier: 2, maxBackoffMs: 60_000 } });
  await runtime.enqueue({ id: "ok-2", type: "development", payload: { artifact: "hashmap", objective: "hashmap" } });

  await runtime.tick();                 // ok-1 completes, bad fails (attempt 1), ok-2 completes
  clock.advance(1_000);
  await runtime.tick();                 // bad retry (attempt 2) -> fails again
  clock.advance(2_000);
  await runtime.tick();                 // bad retry (attempt 3) -> exhausts and FAILS

  const snapshot = await runtime.getSnapshot();
  const byId = Object.fromEntries(snapshot.tasks.map((task) => [task.id, task]));
  assert.equal(byId["ok-1"]!.state, "COMPLETED");
  assert.equal(byId["ok-2"]!.state, "COMPLETED");                 // unrelated tasks are not stuck behind the failure
  assert.equal(byId["bad"]!.state, "FAILED");
  assert.equal(byId["bad"]!.attemptCount, 3);                     // initial + 2 retries
  assert.equal(byId["bad"]!.failureCount, 3);
  assert.equal(snapshot.events.filter((e) => e.type === "TASK_RETRY_SCHEDULED" && e.taskId === "bad").length, 2);
  const failed = snapshot.events.filter((e) => e.type === "TASK_FAILED" && e.taskId === "bad");
  assert.equal(failed.length, 1);                                // failure is logged/visible as an event
  assert.match(byId["bad"]!.lastError ?? "", /failed its verification/);
});

test("daemon interrupted mid-task resumes from the persisted checkpoint and finishes the queue", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viral-daemon-"));
  const store = new MemoryRuntimeStore();
  const execCount = new Map<string, number>();
  const kill = new AbortController();
  // The shared handler interrupts the daemon during the SECOND task (B) on its first attempt only.
  const handler = devHandler(dir, execCount, { onExecute: (task) => { if (task.id === "B" && (execCount.get("B") ?? 0) === 1) kill.abort(); } });

  const runtime = new ViralRuntime(store, [handler], []);
  await runtime.enqueue({ id: "A", type: "development", payload: { artifact: "email", objective: "email" } });
  await runtime.enqueue({ id: "B", type: "development", payload: { artifact: "hashmap", objective: "hashmap" } });
  await runtime.enqueue({ id: "C", type: "development", payload: { artifact: "uptime", objective: "uptime" } });

  await runtime.tick(kill.signal);      // A completes; B starts then the daemon is "killed"; C not reached
  const mid = await runtime.getSnapshot();
  assert.equal(mid.tasks.find((t) => t.id === "A")!.state, "COMPLETED");
  assert.equal(mid.tasks.find((t) => t.id === "B")!.state, "RUNNING");   // interrupted mid-flight, persisted
  assert.equal(mid.tasks.find((t) => t.id === "C")!.state, "QUEUED");

  // Restart the daemon against the same persisted store.
  const restarted = new ViralRuntime(store, [handler], []);
  await restarted.initialize();         // recovers the interrupted RUNNING task back to QUEUED
  await restarted.tick();

  const snapshot = await restarted.getSnapshot();
  assert.deepEqual(snapshot.tasks.map((t) => t.state).sort(), ["COMPLETED", "COMPLETED", "COMPLETED"]);
  assert.ok(snapshot.events.some((e) => e.type === "TASK_RECOVERED" && e.taskId === "B"));
  // A ran exactly once (not restarted from zero); B ran twice (interrupted + resumed); C ran once.
  assert.deepEqual([execCount.get("A"), execCount.get("B"), execCount.get("C")], [1, 2, 1]);
});
