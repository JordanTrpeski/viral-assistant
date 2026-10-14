import { spawn } from "node:child_process";
import type { AudioCaptureSession, AudioFrame, AudioPlayback, AudioPort, PlaybackOutcome } from "./types.js";

const frameDurationMs = 20;

function frameByteLength(sampleRateHz: number): number {
  return Math.round((sampleRateHz * frameDurationMs) / 1_000) * 2;
}

function frameEnergy(pcm: Buffer): number {
  if (pcm.length < 2) return 0;
  let sumSquares = 0;
  const sampleCount = pcm.length / 2;
  for (let offset = 0; offset < pcm.length; offset += 2) {
    const sample = pcm.readInt16LE(offset);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / sampleCount);
}

export interface ProcessAudioConfig {
  sampleRateHz: number;
  captureCommand: string;
  captureArgs: string[];
  playbackCommand: string;
  playbackArgs: string[];
  speechThreshold: number;
}

/** Shells out to locally installed capture/playback commands (e.g. sox) that stream raw 16-bit mono
 *  PCM. Constructed at the edge; core voice logic depends only on AudioPort and is tested with fakes. */
export class ProcessAudioPort implements AudioPort {
  readonly sampleRateHz: number;

  constructor(private readonly config: ProcessAudioConfig) {
    this.sampleRateHz = config.sampleRateHz;
  }

  startCapture(): AudioCaptureSession {
    const frameBytes = frameByteLength(this.sampleRateHz);
    const child = spawn(this.config.captureCommand, this.config.captureArgs, { stdio: ["ignore", "pipe", "ignore"] });
    let buffer = Buffer.alloc(0);
    const queue: Array<AudioFrame | null> = [];
    const waiters: Array<(value: AudioFrame | null) => void> = [];
    let ended = false;

    const push = (frame: AudioFrame | null): void => {
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queue.push(frame);
    };
    const finish = (): void => {
      if (ended) return;
      ended = true;
      push(null);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= frameBytes) {
        const pcm = Buffer.from(buffer.subarray(0, frameBytes));
        buffer = buffer.subarray(frameBytes);
        push({ pcm, durationMs: frameDurationMs, speech: frameEnergy(pcm) >= this.config.speechThreshold });
      }
    });
    child.once("close", finish);
    child.once("error", finish);

    return {
      nextFrame: (): Promise<AudioFrame | null> => {
        if (queue.length > 0) return Promise.resolve(queue.shift() ?? null);
        if (ended) return Promise.resolve(null);
        return new Promise((resolve) => waiters.push(resolve));
      },
      stop: (): void => {
        if (!child.killed) child.kill();
        finish();
      }
    };
  }

  play(wav: Buffer): AudioPlayback {
    const child = spawn(this.config.playbackCommand, this.config.playbackArgs, { stdio: ["pipe", "ignore", "ignore"] });
    let settled = false;
    let resolveFinished!: (outcome: PlaybackOutcome) => void;
    const finished = new Promise<PlaybackOutcome>((resolve) => { resolveFinished = resolve; });
    const settle = (outcome: PlaybackOutcome): void => {
      if (settled) return;
      settled = true;
      resolveFinished(outcome);
    };
    child.once("close", () => settle("completed"));
    child.once("error", () => settle("completed"));
    child.stdin.on("error", () => undefined);
    child.stdin.end(wav);
    return {
      finished,
      interrupt: (): void => {
        settle("interrupted");
        if (!child.killed) child.kill();
      }
    };
  }
}
