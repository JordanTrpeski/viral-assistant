import { join } from "node:path";
import { readJson } from "../files.js";
import type { LocalModelConfig } from "./types.js";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertLoopbackUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("localBrain.baseUrl must be a valid URL"); }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !loopbackHosts.has(url.hostname)) {
    throw new Error("localBrain.baseUrl must use an HTTP(S) loopback address");
  }
  return url.toString().replace(/\/$/, "");
}

export function validateLocalModelConfig(value: unknown): LocalModelConfig {
  if (!isObject(value)) throw new Error("jarvis-dev.config.json.localBrain must be an object");
  if (value.provider !== "ollama") throw new Error("localBrain.provider must equal ollama for M02");
  if (typeof value.baseUrl !== "string") throw new Error("localBrain.baseUrl must be a string");
  if (value.preferredModel !== null && typeof value.preferredModel !== "string") throw new Error("localBrain.preferredModel must be a string or null");
  if (!Number.isSafeInteger(value.defaultTimeoutMs) || (value.defaultTimeoutMs as number) < 1_000) {
    throw new Error("localBrain.defaultTimeoutMs must be an integer of at least 1000");
  }
  const environmentModel = process.env.JARVIS_LOCAL_MODEL?.trim();
  return {
    provider: "ollama",
    baseUrl: assertLoopbackUrl(value.baseUrl),
    preferredModel: environmentModel || (value.preferredModel as string | null),
    defaultTimeoutMs: value.defaultTimeoutMs as number
  };
}

export async function loadLocalModelConfig(root: string): Promise<LocalModelConfig> {
  const config = await readJson(join(root, "jarvis-dev.config.json"));
  if (!isObject(config)) throw new Error("jarvis-dev.config.json must be an object");
  return validateLocalModelConfig(config.localBrain);
}
