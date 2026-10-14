import assert from "node:assert/strict";
import test from "node:test";
import { validateVoiceConfig } from "../src/voice/config.js";
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
  constructor(private readonly frames: AudioFrame[], private readonly onDrained?: () => void) {}
  async nextFrame(): Promise<AudioFrame | null> {
    if (this.stopped) return null;
    if (this.index >= this.frames.length) {
      this.onDrained?.();
      return null;
    }
    return this.frames[this.index++] ?? null;
  }
  stop(): void { this.stopped = true; }
}

/** "auto" completes playback immediately; "on-drain" completes it only once the barge-in monitor has read
 *  every queued frame, so a test can prove those frames were all inspected without interrupting. */
type PlaybackCompletion = "auto" | "on-drain";

class FakeAudioPort implements AudioPort {
  readonly sampleRateHz = 16_000;
  readonly playbacks: Array<{ wav: Buffer; interrupted: boolean }> = [];
  captureCount = 0;
  private completeCurrent: (() => void) | undefined;
  constructor(private readonly captureQueue: AudioFrame[][], private readonly completion: PlaybackCompletion = "auto") {}

  startCapture(): AudioCaptureSession {
    this.captureCount += 1;
    return new FakeCapture(this.captureQueue.shift() ?? [], () => this.completeCurrent?.());
  }

  play(wav: Buffer): AudioPlayback {
    let resolveFinished!: (outcome: PlaybackOutcome) => void;
    const finished = new Promise<PlaybackOutcome>((resolve) => { resolveFinished = resolve; });
    const record = { wav, interrupted: false };
    this.playbacks.push(record);
    this.completeCurrent = () => resolveFinished("completed");
    if (this.completion === "auto") queueMicrotask(() => resolveFinished("completed"));
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

/** 20ms frames, matching the real ProcessAudioPort frame size. */
function frames(speech: boolean, count: number): AudioFrame[] {
  return Array.from({ length: count }, () => frame(speech, 20));
}

const oneTurn: AudioFrame[] = [frame(true), frame(false), frame(false)];

test("barge-in is off by default: no monitor capture runs and sustained speech does not interrupt playback", async () => {
  const audio = new FakeAudioPort([oneTurn, [...frames(false, 25), ...frames(true, 50)]]);
  const result = await runVoiceSession(
    { stt: new FakeStt("hello"), tts: new FakeTts(), audio },
    { overallTimeoutMs: 60_000, silenceTimeoutMs: 2_000, maxTurns: 1 }
  );
  assert.equal(validateVoiceConfig(undefined).bargeIn, false);
  assert.equal(validateVoiceConfig({}).bargeIn, false);
  assert.equal(audio.captureCount, 1, "only the turn capture should run; no barge-in monitor");
  assert.equal(result.turns[0]?.interrupted, false);
  assert.equal(audio.playbacks[0]?.interrupted, false);
});

test("a single speech frame after the grace period does not interrupt playback", async () => {
  const monitor = [...frames(false, 25), frame(true, 20), ...frames(false, 25)];
  const audio = new FakeAudioPort([oneTurn, monitor], "on-drain");
  const result = await runVoiceSession(
    { stt: new FakeStt("hello"), tts: new FakeTts(), audio },
    { overallTimeoutMs: 60_000, silenceTimeoutMs: 2_000, maxTurns: 1, bargeIn: true }
  );
  assert.equal(audio.captureCount, 2, "the barge-in monitor should have run");
  assert.equal(result.turns[0]?.interrupted, false);
  assert.equal(audio.playbacks[0]?.interrupted, false);
});

test("speech inside the 500ms grace period is ignored even when sustained", async () => {
  const monitor = [...frames(true, 25), ...frames(false, 10)];
  const audio = new FakeAudioPort([oneTurn, monitor], "on-drain");
  const result = await runVoiceSession(
    { stt: new FakeStt("hello"), tts: new FakeTts(), audio },
    { overallTimeoutMs: 60_000, silenceTimeoutMs: 2_000, maxTurns: 1, bargeIn: true }
  );
  assert.equal(result.turns[0]?.interrupted, false);
});

test("broken speech shorter than 200ms per run does not interrupt", async () => {
  const run = [...frames(true, 9), frame(false, 20)];
  const monitor = [...frames(false, 25), ...run, ...run, ...run];
  const audio = new FakeAudioPort([oneTurn, monitor], "on-drain");
  const result = await runVoiceSession(
    { stt: new FakeStt("hello"), tts: new FakeTts(), audio },
    { overallTimeoutMs: 60_000, silenceTimeoutMs: 2_000, maxTurns: 1, bargeIn: true }
  );
  assert.equal(result.turns[0]?.interrupted, false);
});

test("200ms of sustained speech after the grace period interrupts playback (barge-in)", async () => {
  const monitor = [...frames(false, 25), ...frames(true, 10), ...frames(false, 25)];
  const audio = new FakeAudioPort([oneTurn, monitor], "on-drain");
  const result = await runVoiceSession(
    { stt: new FakeStt("stop"), tts: new FakeTts(), audio },
    { overallTimeoutMs: 60_000, silenceTimeoutMs: 2_000, maxTurns: 1, bargeIn: true }
  );
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
