import { join } from "node:path";
import { readJson } from "../files.js";
import type { VoiceConfig, VoiceEngineConfig } from "./types.js";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const defaultVoiceConfig: VoiceConfig = {
  sampleRateHz: 16_000,
  channels: 1,
  silenceTimeoutMs: 2_000,
  stt: { engine: "whisper", binary: "whisper-cli", modelPath: null },
  tts: { engine: "piper", binary: "piper", modelPath: null }
};

function validateEngine(value: unknown, label: string, expectedEngine: string, fallback: VoiceEngineConfig): VoiceEngineConfig {
  if (value === undefined) return fallback;
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  if (value.engine !== undefined && value.engine !== expectedEngine) throw new Error(`${label}.engine must equal "${expectedEngine}" for M05`);
  if (value.binary !== undefined && typeof value.binary !== "string") throw new Error(`${label}.binary must be a string`);
  if (value.modelPath !== undefined && value.modelPath !== null && typeof value.modelPath !== "string") throw new Error(`${label}.modelPath must be a string or null`);
  return {
    engine: expectedEngine,
    binary: typeof value.binary === "string" ? value.binary : fallback.binary,
    modelPath: value.modelPath === undefined ? fallback.modelPath : (value.modelPath as string | null)
  };
}

export function validateVoiceConfig(value: unknown): VoiceConfig {
  if (value === undefined) return defaultVoiceConfig;
  if (!isObject(value)) throw new Error("viral-dev.config.json.voice must be an object");
  const sampleRateHz = value.sampleRateHz === undefined ? defaultVoiceConfig.sampleRateHz : value.sampleRateHz;
  if (!Number.isSafeInteger(sampleRateHz) || (sampleRateHz as number) <= 0) throw new Error("voice.sampleRateHz must be a positive integer");
  if (value.channels !== undefined && value.channels !== 1) throw new Error("voice.channels must equal 1 for M05 (mono)");
  const silenceTimeoutMs = value.silenceTimeoutMs === undefined ? defaultVoiceConfig.silenceTimeoutMs : value.silenceTimeoutMs;
  if (!Number.isSafeInteger(silenceTimeoutMs) || (silenceTimeoutMs as number) <= 0) throw new Error("voice.silenceTimeoutMs must be a positive integer");
  return {
    sampleRateHz: sampleRateHz as number,
    channels: 1,
    silenceTimeoutMs: silenceTimeoutMs as number,
    stt: validateEngine(value.stt, "voice.stt", "whisper", defaultVoiceConfig.stt),
    tts: validateEngine(value.tts, "voice.tts", "piper", defaultVoiceConfig.tts)
  };
}

export async function loadVoiceConfig(root: string): Promise<VoiceConfig> {
  const config = await readJson(join(root, "viral-dev.config.json"));
  if (!isObject(config)) throw new Error("viral-dev.config.json must be an object");
  return validateVoiceConfig(config.voice);
}
