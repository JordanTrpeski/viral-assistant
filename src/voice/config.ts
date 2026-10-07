import { join } from "node:path";
import { readJson } from "../files.js";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface VoiceEngineConfig {
  executable: string;
  args: string[];
  modelPath: string | null;
}

export interface VoiceAudioConfig {
  captureCommand: string;
  captureArgs: string[];
  playbackCommand: string;
  playbackArgs: string[];
  speechThreshold: number;
}

export interface VoiceConfig {
  sampleRateHz: number;
  channels: number;
  silenceTimeoutMs: number;
  stt: VoiceEngineConfig;
  tts: VoiceEngineConfig;
  audio: VoiceAudioConfig;
}

const defaultVoiceConfig: VoiceConfig = {
  sampleRateHz: 16_000,
  channels: 1,
  silenceTimeoutMs: 2_000,
  stt: { executable: "whisper", args: [], modelPath: null },
  tts: { executable: "piper", args: [], modelPath: null },
  audio: {
    captureCommand: "sox",
    captureArgs: ["-d", "-q", "-t", "raw", "-r", "16000", "-e", "signed-integer", "-b", "16", "-c", "1", "-"],
    playbackCommand: "sox",
    playbackArgs: ["-q", "-t", "raw", "-r", "16000", "-e", "signed-integer", "-b", "16", "-c", "1", "-", "-d"],
    speechThreshold: 500
  }
};

function engineConfig(value: unknown, label: string, fallback: VoiceEngineConfig): VoiceEngineConfig {
  if (value === undefined) return fallback;
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const executable = value.executable === undefined ? fallback.executable : value.executable;
  if (typeof executable !== "string" || executable.trim() === "") throw new Error(`${label}.executable must be a non-empty string`);
  const args = value.args === undefined ? fallback.args : value.args;
  if (!Array.isArray(args) || args.some((item) => typeof item !== "string")) throw new Error(`${label}.args must be an array of strings`);
  const modelPath = value.modelPath === undefined ? fallback.modelPath : value.modelPath;
  if (modelPath !== null && typeof modelPath !== "string") throw new Error(`${label}.modelPath must be a string or null`);
  return { executable, args: args as string[], modelPath };
}

function audioConfig(value: unknown, label: string, fallback: VoiceAudioConfig): VoiceAudioConfig {
  if (value === undefined) return fallback;
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const string = (field: keyof VoiceAudioConfig): string => {
    const raw = value[field] === undefined ? fallback[field] : value[field];
    if (typeof raw !== "string" || raw.trim() === "") throw new Error(`${label}.${field} must be a non-empty string`);
    return raw;
  };
  const args = (field: "captureArgs" | "playbackArgs"): string[] => {
    const raw = value[field] === undefined ? fallback[field] : value[field];
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) throw new Error(`${label}.${field} must be an array of strings`);
    return raw as string[];
  };
  const speechThreshold = value.speechThreshold === undefined ? fallback.speechThreshold : value.speechThreshold;
  if (typeof speechThreshold !== "number" || !Number.isFinite(speechThreshold) || speechThreshold < 0) {
    throw new Error(`${label}.speechThreshold must be a non-negative number`);
  }
  return {
    captureCommand: string("captureCommand"), captureArgs: args("captureArgs"),
    playbackCommand: string("playbackCommand"), playbackArgs: args("playbackArgs"),
    speechThreshold
  };
}

export function validateVoiceConfig(value: unknown): VoiceConfig {
  if (value === undefined) return defaultVoiceConfig;
  if (!isObject(value)) throw new Error("viral-dev.config.json.voice must be an object");
  const rawSampleRateHz = value.sampleRateHz === undefined ? defaultVoiceConfig.sampleRateHz : value.sampleRateHz;
  if (!Number.isSafeInteger(rawSampleRateHz) || (rawSampleRateHz as number) <= 0) throw new Error("voice.sampleRateHz must be a positive integer");
  const channels = value.channels === undefined ? defaultVoiceConfig.channels : value.channels;
  if (channels !== 1) throw new Error("voice.channels must equal 1; only mono capture is supported");
  const rawSilenceTimeoutMs = value.silenceTimeoutMs === undefined ? defaultVoiceConfig.silenceTimeoutMs : value.silenceTimeoutMs;
  if (!Number.isSafeInteger(rawSilenceTimeoutMs) || (rawSilenceTimeoutMs as number) < 100) throw new Error("voice.silenceTimeoutMs must be an integer of at least 100");
  return {
    sampleRateHz: rawSampleRateHz as number,
    channels: 1,
    silenceTimeoutMs: rawSilenceTimeoutMs as number,
    stt: engineConfig(value.stt, "voice.stt", defaultVoiceConfig.stt),
    tts: engineConfig(value.tts, "voice.tts", defaultVoiceConfig.tts),
    audio: audioConfig(value.audio, "voice.audio", defaultVoiceConfig.audio)
  };
}

export async function loadVoiceConfig(root: string): Promise<VoiceConfig> {
  const config = await readJson(join(root, "viral-dev.config.json"));
  if (!isObject(config)) throw new Error("viral-dev.config.json must be an object");
  return validateVoiceConfig(config.voice);
}
