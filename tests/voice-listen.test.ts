import assert from "node:assert/strict";
import test from "node:test";
import { runListenSession } from "../src/voice/listen.js";
import type {
  AudioFrame, AudioIoPort, CaptureOptions, CaptureResult, PlaybackResult, ResponsePort, SpeechToTextPort, TextToSpeechPort, TranscriptionResult
} from "../src/voice/types.js";

const noSpeech: CaptureResult = { audio: null, endedReason: "no_speech", durationMs: 100 };
const silentFrame: AudioFrame = { sampleRateHz: 16_000, channels: 1, samples: Buffer.alloc(0) };

function frame(text: string): AudioFrame {
  return { sampleRateHz: 16_000, channels: 1, samples: Buffer.from(text, "utf8") };
}

class ScriptedAudio implements AudioIoPort {
  readonly captureCalls: CaptureOptions[] = [];
  readonly playCalls: AudioFrame[] = [];
  private captureIndex = 0;
  constructor(private readonly captures: CaptureResult[], private readonly playbacks: PlaybackResult[] = []) {}
  async capture(options: CaptureOptions): Promise<CaptureResult> {
    this.captureCalls.push(options);
    const result = this.captures[this.captureIndex];
    this.captureIndex += 1;
    if (!result) throw new Error("No scripted capture remaining");
    return result;
  }
  async play(audio: AudioFrame): Promise<PlaybackResult> {
    this.playCalls.push(audio);
    return this.playbacks[this.playCalls.length - 1] ?? { interrupted: false, durationMs: 10 };
  }
}

class EchoStt implements SpeechToTextPort {
  async transcribe(audio: AudioFrame): Promise<TranscriptionResult> {
    return { text: audio.samples.toString("utf8"), diagnostics: [] };
  }
}

class TagTts implements TextToSpeechPort {
  async synthesize(text: string): Promise<AudioFrame> {
    return frame(`spoken:${text}`);
  }
}

class EchoResponder implements ResponsePort {
  async respond(transcript: string): Promise<string> {
    return `heard ${transcript}`;
  }
}

test("a full turn transcribes, responds, and speaks the reply", async () => {
  const audio = new ScriptedAudio([{ audio: frame("hello there"), endedReason: "silence", durationMs: 500 }, noSpeech]);
  const result = await runListenSession(
    { audio, stt: new EchoStt(), tts: new TagTts(), respond: new EchoResponder(), now: () => 0 },
    { sessionTimeoutMs: 30_000, silenceTimeoutMs: 2_000, sampleRateHz: 16_000, channels: 1 }
  );
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0]!.transcript, "hello there");
  assert.equal(result.turns[0]!.response, "heard hello there");
  assert.equal(audio.playCalls[0]!.samples.toString("utf8"), "spoken:heard hello there");
});

test("silence with no captured speech ends the session without a turn", async () => {
  const audio = new ScriptedAudio([noSpeech]);
  const result = await runListenSession(
    { audio, stt: new EchoStt(), tts: new TagTts(), respond: new EchoResponder(), now: () => 0 },
    { sessionTimeoutMs: 30_000, silenceTimeoutMs: 2_000, sampleRateHz: 16_000, channels: 1 }
  );
  assert.equal(result.endedReason, "no_speech");
  assert.equal(result.turns.length, 0);
});

test("the overall session timeout ends the session once the deadline has passed", async () => {
  const audio = new ScriptedAudio([]);
  const steps = [0, 31_000];
  let index = 0;
  const now = (): number => steps[Math.min(index++, steps.length - 1)]!;
  const result = await runListenSession(
    { audio, stt: new EchoStt(), tts: new TagTts(), respond: new EchoResponder(), now },
    { sessionTimeoutMs: 30_000, silenceTimeoutMs: 2_000, sampleRateHz: 16_000, channels: 1 }
  );
  assert.equal(result.endedReason, "timeout");
  assert.equal(result.turns.length, 0);
  assert.equal(audio.captureCalls.length, 0);
});

test("a capture that hits the remaining session time is reported as a timeout, not silence", async () => {
  const audio = new ScriptedAudio([{ audio: null, endedReason: "max_duration", durationMs: 1_000 }]);
  const result = await runListenSession(
    { audio, stt: new EchoStt(), tts: new TagTts(), respond: new EchoResponder(), now: () => 0 },
    { sessionTimeoutMs: 1_000, silenceTimeoutMs: 2_000, sampleRateHz: 16_000, channels: 1 }
  );
  assert.equal(result.endedReason, "timeout");
});

test("interrupt (barge-in) stops playback and is recorded on the turn without ending the session", async () => {
  const audio = new ScriptedAudio(
    [
      { audio: frame("play music"), endedReason: "silence", durationMs: 400 },
      { audio: frame("stop"), endedReason: "silence", durationMs: 300 },
      noSpeech
    ],
    [{ interrupted: true, durationMs: 50 }, { interrupted: false, durationMs: 200 }]
  );
  const result = await runListenSession(
    { audio, stt: new EchoStt(), tts: new TagTts(), respond: new EchoResponder(), now: () => 0 },
    { sessionTimeoutMs: 30_000, silenceTimeoutMs: 2_000, sampleRateHz: 16_000, channels: 1 }
  );
  assert.equal(result.turns.length, 2);
  assert.equal(result.turns[0]!.interrupted, true);
  assert.equal(result.turns[1]!.interrupted, false);
});

test("an empty transcript ends the session as no_speech", async () => {
  const audio = new ScriptedAudio([{ audio: silentFrame, endedReason: "silence", durationMs: 100 }]);
  const result = await runListenSession(
    { audio, stt: { transcribe: async () => ({ text: "   ", diagnostics: [] }) }, tts: new TagTts(), respond: new EchoResponder(), now: () => 0 },
    { sessionTimeoutMs: 30_000, silenceTimeoutMs: 2_000, sampleRateHz: 16_000, channels: 1 }
  );
  assert.equal(result.endedReason, "no_speech");
  assert.equal(result.turns.length, 0);
});

test("maxTurns bounds the session even when time remains", async () => {
  const audio = new ScriptedAudio([
    { audio: frame("one"), endedReason: "silence", durationMs: 100 },
    { audio: frame("two"), endedReason: "silence", durationMs: 100 }
  ]);
  const result = await runListenSession(
    { audio, stt: new EchoStt(), tts: new TagTts(), respond: new EchoResponder(), now: () => 0 },
    { sessionTimeoutMs: 30_000, silenceTimeoutMs: 2_000, sampleRateHz: 16_000, channels: 1, maxTurns: 1 }
  );
  assert.equal(result.endedReason, "max_turns");
  assert.equal(result.turns.length, 1);
});
