import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EfficiencyEvent, EfficiencyEventType, EfficiencyRecorder, EfficiencySnapshot, EfficiencyStore, SelectionDecision } from "./types.js";

function empty(now: string): EfficiencySnapshot { return { schemaVersion: 1, updatedAt: now, nextSequence: 1, events: [] }; }
function validateSnapshot(value: unknown): EfficiencySnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("efficiency snapshot must be an object");
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== 1 || typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error("efficiency snapshot header is invalid");
  if (!Number.isSafeInteger(data.nextSequence) || (data.nextSequence as number) < 1 || !Array.isArray(data.events)) throw new Error("efficiency snapshot sequence/events are invalid");
  for (const [index, event] of data.events.entries()) {
    if (typeof event !== "object" || event === null || Array.isArray(event)) throw new Error(`efficiency event ${index} must be an object`);
    const item = event as Record<string, unknown>;
    if (item.schemaVersion !== 1 || typeof item.id !== "string" || typeof item.occurredAt !== "string" || typeof item.reason !== "string") throw new Error(`efficiency event ${index} is invalid`);
    if ((item.reason as string).length > 300) throw new Error(`efficiency event ${index} reason exceeds 300 characters`);
  }
  return value as EfficiencySnapshot;
}

export class JsonEfficiencyStore implements EfficiencyStore {
  readonly path: string;
  constructor(private readonly directory: string) { this.path = join(directory, "state.json"); }
  async load(): Promise<EfficiencySnapshot | null> {
    try { return validateSnapshot(JSON.parse(await readFile(this.path, "utf8")) as unknown); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(`Cannot load efficiency telemetry at ${this.path}: ${(error as Error).message}`);
    }
  }
  async save(snapshot: EfficiencySnapshot): Promise<void> {
    const valid = validateSnapshot(snapshot);
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}

export class EfficiencyTelemetry implements EfficiencyRecorder {
  constructor(private readonly store: EfficiencyStore, private readonly maximumEvents: number, private readonly now = () => new Date()) {
    if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 1) throw new Error("maximumEvents must be a positive integer");
  }
  async snapshot(): Promise<EfficiencySnapshot> { return await this.store.load() ?? empty(this.now().toISOString()); }
  async record(decision: SelectionDecision, details: { type?: EfficiencyEventType; contextCharacters?: number; contextBudgetCharacters?: number; durationMs?: number; succeeded?: boolean } = {}): Promise<void> {
    const snapshot = await this.snapshot();
    const occurredAt = this.now().toISOString();
    const event: EfficiencyEvent = {
      schemaVersion: 1,
      id: `eff-${String(snapshot.nextSequence).padStart(6, "0")}`,
      occurredAt,
      type: details.type ?? (decision.action === "WAITING_FOR_MODEL" ? "WAITING_FOR_MODEL" : decision.freshSessionRecommended ? "SESSION_RESET" : decision.failureCount > 0 ? "ESCALATION" : "SELECTION"),
      taskId: decision.taskId,
      tier: decision.tier,
      action: decision.action,
      effort: decision.effort,
      harness: decision.harness,
      model: decision.model,
      reason: decision.reason.slice(0, 300),
      contextCharacters: details.contextCharacters ?? null,
      contextBudgetCharacters: details.contextBudgetCharacters ?? null,
      failureCount: decision.failureCount,
      durationMs: details.durationMs ?? null,
      succeeded: details.succeeded ?? null
    };
    snapshot.events.push(event);
    snapshot.events = snapshot.events.slice(-this.maximumEvents);
    snapshot.nextSequence += 1;
    snapshot.updatedAt = occurredAt;
    await this.store.save(snapshot);
  }
}
