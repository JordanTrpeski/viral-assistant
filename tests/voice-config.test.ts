import assert from "node:assert/strict";
import test from "node:test";
import { defaultVoiceConfig, validateVoiceConfig } from "../src/voice/config.js";

test("voice config falls back to 16kHz mono defaults with a 2s silence timeout when absent", () => {
  assert.deepEqual(validateVoiceConfig(undefined), defaultVoiceConfig);
});

test("voice config accepts a fully specified section", () => {
  const config = validateVoiceConfig({
    sampleRateHz: 16_000,
    channels: 1,
    silenceTimeoutMs: 2_500,
    stt: { engine: "whisper", binary: "custom-whisper", modelPath: "models/base.bin" },
    tts: { engine: "piper", binary: "custom-piper", modelPath: "models/voice.onnx" }
  });
  assert.equal(config.silenceTimeoutMs, 2_500);
  assert.equal(config.stt.binary, "custom-whisper");
  assert.equal(config.stt.modelPath, "models/base.bin");
  assert.equal(config.tts.binary, "custom-piper");
});

test("voice config rejects invalid values", () => {
  assert.throws(() => validateVoiceConfig("nope"), /must be an object/);
  assert.throws(() => validateVoiceConfig({ sampleRateHz: 0 }), /sampleRateHz/);
  assert.throws(() => validateVoiceConfig({ sampleRateHz: 16_000, channels: 2 }), /channels must equal 1/);
  assert.throws(() => validateVoiceConfig({ silenceTimeoutMs: -1 }), /silenceTimeoutMs/);
  assert.throws(() => validateVoiceConfig({ stt: { engine: "google" } }), /engine must equal "whisper"/);
  assert.throws(() => validateVoiceConfig({ tts: { engine: "cloud-tts" } }), /engine must equal "piper"/);
});
