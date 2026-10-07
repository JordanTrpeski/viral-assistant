import assert from "node:assert/strict";
import test from "node:test";
import { assertVoiceWavFormat, decodeWav, encodeVoiceWav, encodeWav } from "../src/voice/wav.js";

test("encodeWav/decodeWav round-trip 16kHz mono 16-bit PCM audio", () => {
  const pcm = Buffer.from(Int16Array.of(0, 100, -100, 32767, -32768).buffer);
  const wav = encodeWav(pcm, { sampleRateHz: 16_000, channels: 1, bitsPerSample: 16 });
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(34), 16);

  const decoded = decodeWav(wav);
  assert.equal(decoded.sampleRateHz, 16_000);
  assert.equal(decoded.channels, 1);
  assert.equal(decoded.bitsPerSample, 16);
  assert.deepEqual(decoded.data, pcm);
  assert.doesNotThrow(() => assertVoiceWavFormat(decoded));
});

test("assertVoiceWavFormat rejects non-16kHz or non-mono audio", () => {
  const pcm = Buffer.alloc(4);
  assert.throws(() => assertVoiceWavFormat(decodeWav(encodeWav(pcm, { sampleRateHz: 44_100, channels: 1, bitsPerSample: 16 }))), /16kHz/);
  assert.throws(() => assertVoiceWavFormat(decodeWav(encodeWav(pcm, { sampleRateHz: 16_000, channels: 2, bitsPerSample: 16 }))), /mono/);
  assert.throws(() => assertVoiceWavFormat(decodeWav(encodeWav(pcm, { sampleRateHz: 16_000, channels: 1, bitsPerSample: 8 }))), /16-bit/);
});

test("decodeWav rejects malformed or truncated buffers", () => {
  assert.throws(() => decodeWav(Buffer.alloc(10)), /too short/);
  assert.throws(() => decodeWav(Buffer.alloc(44, "X")), /RIFF/);
});

test("encodeVoiceWav fixes the mono 16-bit PCM shape for a given sample rate", () => {
  const decoded = decodeWav(encodeVoiceWav(Buffer.alloc(4), 16_000));
  assert.doesNotThrow(() => assertVoiceWavFormat(decoded));
});
