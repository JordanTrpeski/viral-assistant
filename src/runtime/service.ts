import type { RuntimeSleeper } from "./types.js";
import { ViralRuntime } from "./engine.js";

export const systemSleeper: RuntimeSleeper = {
  wait: async (milliseconds, signal) => await new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, milliseconds);
    function done(): void { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
    signal.addEventListener("abort", done, { once: true });
  })
};

export class RuntimeService {
  private controller: AbortController | null = null;
  private active: Promise<void> | null = null;

  constructor(private readonly runtime: ViralRuntime, private readonly pollMs = 1_000, private readonly sleeper: RuntimeSleeper = systemSleeper) {
    if (!Number.isSafeInteger(pollMs) || pollMs < 10) throw new Error("pollMs must be an integer of at least 10");
  }

  start(): Promise<void> {
    if (this.active) throw new Error("Runtime service is already started");
    this.controller = new AbortController();
    this.active = this.loop(this.controller.signal).finally(() => { this.active = null; this.controller = null; });
    return this.active;
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    await this.active;
  }

  private async loop(signal: AbortSignal): Promise<void> {
    await this.runtime.initialize();
    while (!signal.aborted) {
      await this.runtime.tick(signal);
      if (!signal.aborted) await this.sleeper.wait(this.pollMs, signal);
    }
  }
}
