import { join } from "node:path";
import { readJson } from "../files.js";
import type { HarnessId } from "../harness/types.js";
import type { EfficiencyConfig } from "./types.js";

type JsonObject = Record<string, unknown>;
const object = (value: unknown, label: string): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
};
const integer = (value: unknown, label: string, minimum: number): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${label} must be an integer of at least ${minimum}`);
  return value as number;
};
const ratio = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
  return value;
};

export function validateEfficiencyConfig(value: unknown): EfficiencyConfig {
  const data = object(value, "viral-dev.config.json.efficiencyGovernor");
  if (data.primaryHarness !== "codex" && data.primaryHarness !== "claude") throw new Error("efficiencyGovernor.primaryHarness must be codex or claude");
  if (typeof data.allowAutomaticPaidHarnessSwitch !== "boolean") throw new Error("efficiencyGovernor.allowAutomaticPaidHarnessSwitch must be boolean");
  const config: EfficiencyConfig = {
    primaryHarness: data.primaryHarness as HarnessId,
    allowAutomaticPaidHarnessSwitch: data.allowAutomaticPaidHarnessSwitch,
    maximumAttempts: integer(data.maximumAttempts, "efficiencyGovernor.maximumAttempts", 1),
    failuresPerEffortLevel: integer(data.failuresPerEffortLevel, "efficiencyGovernor.failuresPerEffortLevel", 1),
    initialContextCharacters: integer(data.initialContextCharacters, "efficiencyGovernor.initialContextCharacters", 1_000),
    maximumContextCharacters: integer(data.maximumContextCharacters, "efficiencyGovernor.maximumContextCharacters", 1_000),
    freshSessionCharacters: integer(data.freshSessionCharacters, "efficiencyGovernor.freshSessionCharacters", 1_000),
    freshSessionCompletedRatio: ratio(data.freshSessionCompletedRatio, "efficiencyGovernor.freshSessionCompletedRatio"),
    freshSessionNoiseRatio: ratio(data.freshSessionNoiseRatio, "efficiencyGovernor.freshSessionNoiseRatio"),
    maximumTelemetryEvents: integer(data.maximumTelemetryEvents, "efficiencyGovernor.maximumTelemetryEvents", 1)
  };
  if (config.maximumContextCharacters < config.initialContextCharacters) throw new Error("efficiencyGovernor.maximumContextCharacters must be at least initialContextCharacters");
  if (config.freshSessionCharacters > config.maximumContextCharacters) throw new Error("efficiencyGovernor.freshSessionCharacters must not exceed maximumContextCharacters");
  if (config.maximumAttempts < config.failuresPerEffortLevel * 2) throw new Error("efficiencyGovernor.maximumAttempts must permit bounded effort escalation");
  return config;
}

export async function loadEfficiencyConfig(root: string): Promise<EfficiencyConfig> {
  const config = object(await readJson(join(root, "viral-dev.config.json")), "viral-dev.config.json");
  return validateEfficiencyConfig(config.efficiencyGovernor);
}
