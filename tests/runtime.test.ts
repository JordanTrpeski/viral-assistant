import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LocalModel } from "../src/local/types.js";
import { ViralRuntime } from "../src/runtime/engine.js";
import { ModelAvailabilityCondition } from "../src/runtime/integrations.js";
import { JsonRuntimeStore } from "../src/runtime/store.js";
import { runtimeTaskStates, type RuntimeCondition, type RuntimeEvent, type RuntimeTaskHandler } from "../src/runtime/types.js";
import { FakeClock, MemoryRuntimeStore, handler } from "./runtime-helpers.js";

test("runtime exposes every required durable task state", () => {
  assert.deepEqual(runtimeTaskStates, [
    "QUEUED", "RUNNING", "SCHEDULED", "WAITING_FOR_TIME", "WAITING_FOR_CONDITION", "WAITING_FOR_MODEL",
    "WAITING_FOR_OWNER", "PAUSED", "VERIFYING", "COMPLETED", "FAILED"
  ]);
});

test("a scheduled task survives runtime reconstruction and executes after its due time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viral-runtime-"));
  const clock = new FakeClock();
  let executions = 0;
  const work = handler("work", async () => { executions += 1; return { type: "completed", result: { ok: true } }; });
  const first = new ViralRuntime(new JsonRuntimeStore(directory), [work], [], clock);
  await first.enqueue({ id: "future", type: "work", runAt: new Date(clock.now().getTime() + 1_000).toISOString() });
  await first.tick();
  assert.equal(executions, 0);

  clock.advance(1_001);
  const restarted = new ViralRuntime(new JsonRuntimeStore(directory), [work], [], clock);
  const observed: RuntimeEvent[] = [];
  restarted.onEvent((event) => observed.push(event));
  await restarted.tick();
  const snapshot = await restarted.getSnapshot();
  assert.equal(snapshot.tasks[0]?.state, "COMPLETED");
  assert.equal(executions, 1);
  assert.ok(snapshot.events.some((event) => event.type === "SCHEDULED_TASK_STARTED"));
  assert.ok(snapshot.events.some((event) => event.type === "TASK_COMPLETED"));
  assert.ok(observed.some((event) => event.type === "TASK_COMPLETED"));
  const persisted = await readFile(join(directory, "state.json"), "utf8");
  assert.doesNotThrow(() => JSON.parse(persisted));
});

test("recurring scheduling runs at fixed due times without busy execution", async () => {
  const clock = new FakeClock();
  let executions = 0;
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [handler("repeat", async () => { executions += 1; return { type: "completed", result: executions }; })], [], clock);
  await runtime.enqueue({ id: "repeat", type: "repeat", runAt: new Date(clock.now().getTime() + 100).toISOString(), recurrence: { intervalMs: 100 } });
  await runtime.tick();
  assert.equal(executions, 0);
  clock.advance(100);
  await runtime.tick();
  assert.equal(executions, 1);
  await runtime.tick();
  assert.equal(executions, 1);
  clock.advance(100);
  await runtime.tick();
  const task = (await runtime.getSnapshot()).tasks[0]!;
  assert.equal(executions, 2);
  assert.equal(task.occurrenceCount, 2);
  assert.equal(task.state, "SCHEDULED");
});

test("owner-dependent task pauses until an explicit response is supplied", async () => {
  let executions = 0;
  const ownerHandler = handler("owner", async (task) => {
    executions += 1;
    return task.ownerInputProvided ? { type: "completed", result: task.ownerInputResponse } : { type: "owner_input_required", prompt: "Choose yes or no" };
  });
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [ownerHandler], []);
  await runtime.enqueue({ id: "owner-task", type: "owner" });
  await runtime.tick();
  let task = (await runtime.getSnapshot()).tasks[0]!;
  assert.equal(task.state, "WAITING_FOR_OWNER");
  assert.equal(task.ownerInputRequired?.prompt, "Choose yes or no");
  await runtime.tick();
  assert.equal(executions, 1);
  await runtime.supplyOwnerInput(task.id, "yes");
  await runtime.tick();
  task = (await runtime.getSnapshot()).tasks[0]!;
  assert.equal(task.state, "COMPLETED");
  assert.equal(task.result, "yes");
  assert.ok((await runtime.getSnapshot()).events.some((event) => event.type === "OWNER_INPUT_REQUIRED"));
});

test("model waiting resumes on an injected availability condition and waiting spends no inference", async () => {
  let available = false;
  let executions = 0;
  let inferenceCalls = 0;
  const condition: RuntimeCondition = { type: "model_available", evaluate: async () => available };
  const modelTask = handler("model-work", async () => {
    executions += 1;
    if (executions === 1) return { type: "waiting_for_model", condition: { type: "model_available", parameters: {} } };
    inferenceCalls += 1;
    return { type: "completed", result: "local result" };
  });
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [modelTask], [condition]);
  await runtime.enqueue({ id: "model-task", type: "model-work" });
  await runtime.tick();
  assert.equal((await runtime.getSnapshot()).tasks[0]?.state, "WAITING_FOR_MODEL");
  await runtime.tick();
  await runtime.tick();
  assert.equal(executions, 1);
  assert.equal(inferenceCalls, 0);
  available = true;
  await runtime.tick();
  assert.equal((await runtime.getSnapshot()).tasks[0]?.state, "COMPLETED");
  assert.equal(inferenceCalls, 1);
  assert.ok((await runtime.getSnapshot()).events.some((event) => event.type === "WAITING_FOR_MODEL"));
});

test("the M02 model-availability integration probes only and never runs inference while waiting", async () => {
  let probes = 0;
  let inferences = 0;
  const model: LocalModel = {
    id: "ollama", displayName: "Fake Ollama",
    probe: async () => {
      probes += 1;
      return { provider: "ollama", displayName: "Fake Ollama", executable: "fake", installed: true, running: true, usable: true, version: "1", models: ["small:latest"], preferredModel: "small:latest", diagnostics: [] };
    },
    infer: async () => { inferences += 1; throw new Error("Inference must not run during a condition check"); }
  };
  const condition = new ModelAvailabilityCondition(model);
  const store = new MemoryRuntimeStore();
  const runtime = new ViralRuntime(store, [], [condition]);
  await runtime.initialize();
  const ready = await condition.evaluate({ type: "model_available", parameters: { model: "small:latest" } });
  assert.equal(ready, true);
  assert.equal(probes, 1);
  assert.equal(inferences, 0);
});

test("modular conditions hold and resume WAITING_FOR_CONDITION tasks", async () => {
  let ready = false;
  let executions = 0;
  const condition: RuntimeCondition = { type: "flag", evaluate: async (spec) => ready && spec.parameters.name === "ready" };
  const conditional = handler("conditional", async () => {
    executions += 1;
    return executions === 1
      ? { type: "waiting_for_condition", condition: { type: "flag", parameters: { name: "ready" } } }
      : { type: "completed", result: "done" };
  });
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [conditional], [condition]);
  await runtime.enqueue({ id: "conditional", type: "conditional" });
  await runtime.tick();
  assert.equal((await runtime.getSnapshot()).tasks[0]?.state, "WAITING_FOR_CONDITION");
  await runtime.tick();
  assert.equal(executions, 1);
  ready = true;
  await runtime.tick();
  assert.equal((await runtime.getSnapshot()).tasks[0]?.state, "COMPLETED");
});

test("pause and resume preserve a scheduled task without executing while paused", async () => {
  const clock = new FakeClock();
  let executions = 0;
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [handler("work", async () => { executions += 1; return { type: "completed", result: null }; })], [], clock);
  await runtime.enqueue({ id: "paused", type: "work", runAt: new Date(clock.now().getTime() + 100).toISOString() });
  await runtime.pause("paused");
  clock.advance(200);
  await runtime.tick();
  assert.equal(executions, 0);
  assert.equal((await runtime.getSnapshot()).tasks[0]?.state, "PAUSED");
  await runtime.resume("paused");
  await runtime.tick();
  assert.equal(executions, 1);
});

test("bounded retry backoff eventually fails and never loops forever", async () => {
  const clock = new FakeClock();
  let executions = 0;
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [handler("fail", async () => { executions += 1; throw new Error("controlled failure"); })], [], clock);
  await runtime.enqueue({ id: "failing", type: "fail", retryPolicy: { maxAttempts: 3, initialBackoffMs: 100, backoffMultiplier: 2, maxBackoffMs: 1_000 } });
  await runtime.tick();
  assert.equal((await runtime.getSnapshot()).tasks[0]?.state, "WAITING_FOR_TIME");
  await runtime.tick();
  assert.equal(executions, 1);
  clock.advance(100);
  await runtime.tick();
  clock.advance(199);
  await runtime.tick();
  assert.equal(executions, 2);
  clock.advance(1);
  await runtime.tick();
  const snapshot = await runtime.getSnapshot();
  assert.equal(executions, 3);
  assert.equal(snapshot.tasks[0]?.state, "FAILED");
  assert.equal(snapshot.tasks[0]?.failureCount, 3);
  assert.equal(snapshot.events.filter((event) => event.type === "TASK_RETRY_SCHEDULED").length, 2);
  assert.equal(snapshot.events.filter((event) => event.type === "TASK_FAILED").length, 1);
});

test("dependencies run in order and failed dependencies stop dependants", async () => {
  const order: string[] = [];
  const handlers: RuntimeTaskHandler[] = [
    handler("ok", async (task) => { order.push(task.id); return { type: "completed", result: null }; }),
    handler("bad", async () => ({ type: "failed", error: "permanent" }))
  ];
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), handlers, []);
  await runtime.enqueue({ id: "first", type: "ok" });
  await runtime.enqueue({ id: "second", type: "ok", dependencies: ["first"] });
  await runtime.enqueue({ id: "bad", type: "bad" });
  await runtime.enqueue({ id: "blocked", type: "ok", dependencies: ["bad"] });
  await runtime.tick();
  const snapshot = await runtime.getSnapshot();
  assert.deepEqual(order, ["first", "second"]);
  assert.equal(snapshot.tasks.find((task) => task.id === "blocked")?.state, "FAILED");
  assert.match(snapshot.tasks.find((task) => task.id === "blocked")?.lastError ?? "", /Dependency failed/);
});

test("successful tasks pass through deterministic verification before completion", async () => {
  let verifiedState = "";
  const work = handler(
    "verified", async () => ({ type: "completed", result: { value: 1 } }),
    async (task) => { verifiedState = task.state; return { passed: true, error: null }; }
  );
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [work], []);
  await runtime.enqueue({ id: "verified", type: "verified" });
  await runtime.tick();
  assert.equal(verifiedState, "VERIFYING");
  assert.equal((await runtime.getSnapshot()).tasks[0]?.state, "COMPLETED");
});

test("startup safely recovers interrupted RUNNING and VERIFYING tasks", async () => {
  const clock = new FakeClock();
  const store = new MemoryRuntimeStore();
  const work = handler("work", async () => ({ type: "completed", result: null }));
  const first = new ViralRuntime(store, [work], [], clock);
  await first.enqueue({ id: "running", type: "work" });
  await first.enqueue({ id: "verifying", type: "work" });
  store.snapshot!.tasks[0]!.state = "RUNNING";
  store.snapshot!.tasks[1]!.state = "VERIFYING";

  const restarted = new ViralRuntime(store, [work], [], clock);
  await restarted.initialize();
  let snapshot = await restarted.getSnapshot();
  assert.deepEqual(snapshot.tasks.map((task) => task.state), ["QUEUED", "QUEUED"]);
  assert.equal(snapshot.events.filter((event) => event.type === "TASK_RECOVERED").length, 2);
  await restarted.tick();
  snapshot = await restarted.getSnapshot();
  assert.deepEqual(snapshot.tasks.map((task) => task.state), ["COMPLETED", "COMPLETED"]);
});
