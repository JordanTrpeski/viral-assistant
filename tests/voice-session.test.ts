import assert from "node:assert/strict";
import test from "node:test";
import { runVoiceSession } from "../src/voice/session.js";
import type {
  AudioCaptureSession, AudioFrame, AudioPlayback, AudioPort, PlaybackOutcome,
  SpeechToTextPort, SynthesisResult, TextToSpeechPort, TranscriptionResult
} from "../src/voice/types.js";

function frame(speech: boolean, durationMs = 1_000): AudioFrame {
  return { pcm: Buffer.alloc(2), durationMs, speech };
}

class FakeCapture implements AudioCaptureSession {
  private index = 0;
  private stopped = false;
  constructor(private readonly frames: AudioFrame[]) {}
  async nextFrame(): Promise<AudioFrame | null> {
    if (this.stopped || this.index >= this.frames.length) return null;
    return this.frames[this.index++] ?? null;
  }
  stop(): void { this.stopped = true; }
}

class FakeAudioPort implements AudioPort {
  readonly sampleRateHz = 16_000;
  readonly playbacks: Array<{ wav: Buffer; interrupted: boolean }> = [];
  constructor(private readonly captureQueue: AudioFrame[][], private readonly autoComplete = true) {}

  startCapture(): AudioCaptureSession {
    return new FakeCapture(this.captureQueue.shift() ?? []);
  }

  play(wav: Buffer): AudioPlayback {
    let resolveFinished!: (outcome: PlaybackOutcome) => void;
    const finished = new Promise<PlaybackOutcome>((resolve) => { resolveFinished = resolve; });
    const record = { wav, interrupted: false };
    this.playbacks.push(record);
    if (this.autoComplete) queueMicrotask(() => resolveFinished("completed"));
    return {
      finished,
      interrupt: (): void => {
        record.interrupted = true;
        resolveFinished("interrupted");
      }
    };
  }
}

class FakeStt implements SpeechToTextPort {
  readonly id = "fake-stt";
  constructor(private readonly text: string) {}
  async transcribe(): Promise<TranscriptionResult> { return { text: this.text }; }
}

class FakeTts implements TextToSpeechPort {
  readonly id = "fake-tts";
  async synthesize(text: string): Promise<SynthesisResult> { return { wav: Buffer.from(text) }; }
}

test("a 2s silence timeout ends a turn and produces a transcript/reply pair", async () => {
  const audio = new FakeAudioPort([
    [frame(true), frame(true), frame(false), frame(false)],
    []
  ]);
  const result = await runVoiceSession(
    { stt: new FakeStt("hello there"), tts: new FakeTts(), audio },
    { overallTimeoutMs: 60_000, silenceTimeoutMs: 2_000, maxTurns: 1 }
  );
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0]?.silenceTimedOut, true);
  assert.equal(result.turns[0]?.transcript, "hello there");
  assert.match(result.turns[0]?.replyText ?? "", /hello there/);
  assert.equal(result.turns[0]?.interrupted, false);
  assert.equal(result.turns[0]?.capturedMs, 4_000);
});

test("speech detected during playback interrupts the response (barge-in)", async () => {
  const audio = new FakeAudioPort([
    [frame(true), frame(false), frame(false)],
    [frame(true)]
  ], false);
  const result = await runVoiceSession(
    { stt: new FakeStt("stop"), tts: new FakeTts(), audio },
    { overallTimeoutMs: 60_000, silenceTimeoutMs: 2_000, maxTurns: 1 }
  );
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0]?.interrupted, true);
  assert.equal(audio.playbacks[0]?.interrupted, true);
});

test("an empty capture ends the session without a transcript", async () => {
  const audio = new FakeAudioPort([[]]);
  const result = await runVoiceSession(
    { stt: new FakeStt("unused"), tts: new FakeTts(), audio },
    { overallTimeoutMs: 60_000, silenceTimeoutMs: 2_000 }
  );
  assert.equal(result.turns.length, 0);
  assert.equal(result.endedReason, "no-speech");
});

test("maxTurns bounds the session deterministically without touching the ports", async () => {
  const audio = new FakeAudioPort([]);
  const result = await runVoiceSession(
    { stt: new FakeStt("unused"), tts: new FakeTts(), audio },
    { overallTimeoutMs: 60_000, silenceTimeoutMs: 2_000, maxTurns: 0 }
  );
  assert.equal(result.turns.length, 0);
  assert.equal(result.endedReason, "max-turns");
  assert.equal(audio.playbacks.length, 0);
});

test("a custom responder overrides the default echo reply", async () => {
  const audio = new FakeAudioPort([
    [frame(true), frame(false), frame(false)],
    []
  ]);
  const result = await runVoiceSession(
    { stt: new FakeStt("turn the lights on"), tts: new FakeTts(), audio },
    { overallTimeoutMs: 60_000, silenceTimeoutMs: 2_000, maxTurns: 1, respond: (transcript) => `Done: ${transcript}` }
  );
  assert.equal(result.turns[0]?.replyText, "Done: turn the lights on");
});
