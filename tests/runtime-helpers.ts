import type { RuntimeClock, RuntimeSnapshot, RuntimeStore, RuntimeTaskHandler } from "../src/runtime/types.js";

export class FakeClock implements RuntimeClock {
  constructor(private milliseconds = Date.parse("2026-01-01T00:00:00.000Z")) {}
  now(): Date { return new Date(this.milliseconds); }
  advance(milliseconds: number): void { this.milliseconds += milliseconds; }
}

export class MemoryRuntimeStore implements RuntimeStore {
  snapshot: RuntimeSnapshot | null = null;
  async load(): Promise<RuntimeSnapshot | null> { return this.snapshot ? structuredClone(this.snapshot) : null; }
  async save(snapshot: RuntimeSnapshot): Promise<void> { this.snapshot = structuredClone(snapshot); }
}

export function handler(type: string, execute: RuntimeTaskHandler["execute"], verify?: RuntimeTaskHandler["verify"]): RuntimeTaskHandler {
  return { type, execute, ...(verify ? { verify } : {}) };
}
