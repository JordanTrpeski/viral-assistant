import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHarnessCommand } from "../harness/resolve.js";
import type { ProcessRunner } from "../harness/types.js";
import { decodeWav, encodeWav } from "./wav.js";
import type { AudioFrame, AudioIoPort, CaptureOptions, CaptureResult, PlaybackResult } from "./types.js";

export interface SoxAudioIoOptions {
  binary?: string;
  processRunner: ProcessRunner;
}

function inputDeviceArgs(): string[] {
  return process.platform === "win32" ? ["-t", "waveaudio", "default"] : ["-d"];
}

function outputDeviceArgs(): string[] {
  return process.platform === "win32" ? ["-t", "waveaudio", "default"] : ["-d"];
}

/**
 * Local SoX-based audio I/O adapter. Capture stops automatically after `silenceTimeoutMs` of
 * silence following the start of speech (SoX `silence` effect). Playback races a playback
 * process against a microphone monitor process so new speech barges in and stops output; this
 * needs live cross-process cancellation, which the fire-and-forget ProcessRunner contract does
 * not support, so it is implemented directly with node:child_process.
 */
export class SoxAudioIo implements AudioIoPort {
  private readonly binary: string;
  private readonly processRunner: ProcessRunner;

  constructor(options: SoxAudioIoOptions) {
    this.binary = options.binary ?? "sox";
    this.processRunner = options.processRunner;
  }

  async capture(options: CaptureOptions): Promise<CaptureResult> {
    const dir = await mkdtemp(join(tmpdir(), "viral-voice-capture-"));
    const wavPath = join(dir, `${randomUUID()}.wav`);
    const command = resolveHarnessCommand(this.binary);
    const silenceSeconds = (options.silenceTimeoutMs / 1_000).toFixed(2);
    const args = [
      ...(command.prefixArgs ?? []),
      "-q", ...inputDeviceArgs(), "-r", String(options.sampleRateHz), "-c", String(options.channels), "-b", "16", wavPath,
      "silence", "1", "0.1", "1%", "1", silenceSeconds, "1%"
    ];
    try {
      const result = await this.processRunner.run({ executable: command.executable, args, cwd: dir, stdin: "", timeoutMs: options.maxDurationMs });
      if (result.timedOut) return { audio: null, endedReason: "max_duration", durationMs: result.durationMs };
      if (result.error || result.exitCode !== 0) throw new Error(result.error ?? `sox exited with code ${result.exitCode ?? "unknown"}: ${result.stderr}`);
      const buffer = await readFile(wavPath).catch(() => null);
      if (!buffer || buffer.length <= 44) return { audio: null, endedReason: "no_speech", durationMs: result.durationMs };
      const decoded = decodeWav(buffer);
      return { audio: { sampleRateHz: decoded.sampleRateHz, channels: decoded.channels, samples: decoded.samples }, endedReason: "silence", durationMs: result.durationMs };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async play(audio: AudioFrame): Promise<PlaybackResult> {
    const dir = await mkdtemp(join(tmpdir(), "viral-voice-playback-"));
    const wavPath = join(dir, `${randomUUID()}.wav`);
    const started = Date.now();
    try {
      await writeFile(wavPath, encodeWav(audio.samples, audio.sampleRateHz, audio.channels));
      const playbackCommand = resolveHarnessCommand(this.binary);
      const playbackArgs = [...(playbackCommand.prefixArgs ?? []), "-q", wavPath, ...outputDeviceArgs()];
      const monitorCommand = resolveHarnessCommand(this.binary);
      const monitorArgs = [...(monitorCommand.prefixArgs ?? []), "-q", ...inputDeviceArgs(), "-n", "silence", "1", "0.05", "3%"];

      const interrupted = await new Promise<boolean>((resolvePromise, rejectPromise) => {
        let settled = false;
        const playback = spawn(playbackCommand.executable, playbackArgs, { windowsHide: true, stdio: "ignore" });
        const monitor = spawn(monitorCommand.executable, monitorArgs, { windowsHide: true, stdio: "ignore" });
        const finish = (result: boolean): void => {
          if (settled) return;
          settled = true;
          playback.kill();
          monitor.kill();
          resolvePromise(result);
        };
        const fail = (error: Error): void => {
          if (settled) return;
          settled = true;
          playback.kill();
          monitor.kill();
          rejectPromise(error);
        };
        playback.on("close", (code) => (code === 0 ? finish(false) : fail(new Error(`sox playback exited with code ${code ?? "unknown"}`))));
        playback.on("error", (error) => fail(new Error(`Cannot start sox for playback: ${error.message}`)));
        monitor.on("close", (code) => { if (code === 0) finish(true); });
        monitor.on("error", () => undefined);
      });

      return { interrupted, durationMs: Date.now() - started };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
