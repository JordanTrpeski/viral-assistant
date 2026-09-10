import assert from "node:assert/strict";
import test from "node:test";
import { ViralRuntime } from "../src/runtime/engine.js";
import { RuntimeService } from "../src/runtime/service.js";
import type { RuntimeSleeper } from "../src/runtime/types.js";
import { MemoryRuntimeStore, handler } from "./runtime-helpers.js";

test("long-running service stops cleanly and releases its wait", async () => {
  let waits = 0;
  let released = false;
  const sleeper: RuntimeSleeper = {
    wait: async (_milliseconds, signal) => await new Promise<void>((resolve) => {
      waits += 1;
      signal.addEventListener("abort", () => { released = true; resolve(); }, { once: true });
    })
  };
  const runtime = new ViralRuntime(new MemoryRuntimeStore(), [handler("noop", async () => ({ type: "completed", result: null }))], []);
  const service = new RuntimeService(runtime, 10, sleeper);
  const active = service.start();
  while (waits === 0) await new Promise((resolve) => setImmediate(resolve));
  await service.stop();
  await active;
  assert.equal(released, true);
  assert.equal(waits, 1);
});
