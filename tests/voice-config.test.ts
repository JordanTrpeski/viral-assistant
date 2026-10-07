import assert from "node:assert/strict";
import test from "node:test";
import { validateVoiceConfig } from "../src/voice/config.js";

test("voice config defaults to 16kHz mono with a 2s silence timeout", () => {
  const config = validateVoiceConfig(undefined);
  assert.equal(config.sampleRateHz, 16_000);
  assert.equal(config.channels, 1);
  assert.equal(config.silenceTimeoutMs, 2_000);
  assert.equal(config.stt.executable, "whisper");
  assert.equal(config.tts.executable, "piper");
  assert.equal(config.audio.captureCommand, "sox");
});

test("voice config accepts partial overrides and keeps unspecified fields at their defaults", () => {
  const config = validateVoiceConfig({
    silenceTimeoutMs: 1_500,
    stt: { executable: "whisper-cli", modelPath: "models/ggml-base.en.bin" },
    tts: { executable: "piper-bin", args: ["--speaker", "0"] }
  });
  assert.equal(config.silenceTimeoutMs, 1_500);
  assert.equal(config.sampleRateHz, 16_000);
  assert.equal(config.stt.executable, "whisper-cli");
  assert.equal(config.stt.modelPath, "models/ggml-base.en.bin");
  assert.deepEqual(config.tts.args, ["--speaker", "0"]);
  assert.equal(config.tts.modelPath, null);
});

test("voice config rejects invalid shapes", () => {
  assert.throws(() => validateVoiceConfig("nope"), /must be an object/);
  assert.throws(() => validateVoiceConfig({ channels: 2 }), /channels must equal 1/);
  assert.throws(() => validateVoiceConfig({ silenceTimeoutMs: 0 }), /silenceTimeoutMs/);
  assert.throws(() => validateVoiceConfig({ sampleRateHz: -1 }), /sampleRateHz/);
  assert.throws(() => validateVoiceConfig({ stt: { executable: "" } }), /executable/);
  assert.throws(() => validateVoiceConfig({ stt: { args: ["ok", 1] } }), /args must be an array of strings/);
  assert.throws(() => validateVoiceConfig({ audio: { speechThreshold: -1 } }), /speechThreshold/);
});
