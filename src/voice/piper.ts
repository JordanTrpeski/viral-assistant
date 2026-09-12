import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHarnessCommand } from "../harness/resolve.js";
import type { ProcessRunner } from "../harness/types.js";
import { decodeWav } from "./wav.js";
import type { AudioFrame, TextToSpeechPort } from "./types.js";

export interface PiperAdapterOptions {
  binary: string;
  modelPath: string | null;
  processRunner: ProcessRunner;
  timeoutMs?: number;
}

/**
 * Shells out to a locally installed Piper CLI, feeding text on stdin and reading the
 * synthesized WAV file it writes. No network access and no cloud API.
 */
export class PiperTextToSpeech implements TextToSpeechPort {
  constructor(private readonly options: PiperAdapterOptions) {}

  async synthesize(text: string): Promise<AudioFrame> {
    const dir = await mkdtemp(join(tmpdir(), "viral-voice-tts-"));
    const outputPath = join(dir, `${randomUUID()}.wav`);
    try {
      const command = resolveHarnessCommand(this.options.binary);
      const args = [
        ...(command.prefixArgs ?? []),
        ...(this.options.modelPath ? ["--model", this.options.modelPath] : []),
        "--output_file", outputPath
      ];
      const result = await this.options.processRunner.run({
        executable: command.executable,
        args,
        cwd: dir,
        stdin: text,
        timeoutMs: this.options.timeoutMs ?? 60_000
      });
      if (result.error || result.exitCode !== 0) {
        throw new Error(result.error ?? `piper exited with code ${result.exitCode ?? "unknown"}: ${result.stderr}`);
      }
      const buffer = await readFile(outputPath);
      const decoded = decodeWav(buffer);
      return { sampleRateHz: decoded.sampleRateHz, channels: decoded.channels, samples: decoded.samples };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
