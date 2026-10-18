import { join } from "node:path";
import { readJson } from "../files.js";
import { isObject } from "./validation.js";

export interface DashboardConfig {
  host: string;
  port: number;
  /** Step for the budget − and + controls, in cents. */
  budgetStepCents: number;
  /** Largest amount a chat proposal may carry, in cents (sanity limit; default 5000 EUR). */
  chatMaxAmountCents: number;
}

export const loopbackHosts = ["127.0.0.1", "::1", "localhost"] as const;

export const defaultDashboardConfig: DashboardConfig = { host: "127.0.0.1", port: 4174, budgetStepCents: 1_000, chatMaxAmountCents: 500_000 };

export function validateDashboardConfig(value: unknown): DashboardConfig {
  if (value === undefined) return { ...defaultDashboardConfig };
  if (!isObject(value)) throw new Error("viral-dev.config.json.dashboard must be an object");
  const host = value.host ?? defaultDashboardConfig.host;
  if (typeof host !== "string" || !(loopbackHosts as readonly string[]).includes(host)) {
    throw new Error(`dashboard.host must be a loopback address (${loopbackHosts.join(", ")}); the dashboard is never exposed to the network`);
  }
  const port = value.port ?? defaultDashboardConfig.port;
  if (typeof port !== "number" || !Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("dashboard.port must be an integer from 0 to 65535");
  const budgetStepCents = value.budgetStepCents ?? defaultDashboardConfig.budgetStepCents;
  if (typeof budgetStepCents !== "number" || !Number.isSafeInteger(budgetStepCents) || budgetStepCents < 1) {
    throw new Error("dashboard.budgetStepCents must be a positive whole number of cents");
  }
  const chatMaxAmountCents = value.chatMaxAmountCents ?? defaultDashboardConfig.chatMaxAmountCents;
  if (typeof chatMaxAmountCents !== "number" || !Number.isSafeInteger(chatMaxAmountCents) || chatMaxAmountCents < 1) {
    throw new Error("dashboard.chatMaxAmountCents must be a positive whole number of cents");
  }
  return { host, port, budgetStepCents, chatMaxAmountCents };
}

export async function loadDashboardConfig(root: string): Promise<DashboardConfig> {
  const config = await readJson(join(root, "viral-dev.config.json"));
  if (!isObject(config)) throw new Error("viral-dev.config.json must be an object");
  return validateDashboardConfig(config.dashboard);
}
