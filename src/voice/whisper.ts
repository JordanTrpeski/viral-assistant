import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHarnessCommand } from "../harness/resolve.js";
import type { ProcessRunner } from "../harness/types.js";
import { encodeWav } from "./wav.js";
import type { AudioFrame, SpeechToTextPort, TranscriptionResult } from "./types.js";

export interface WhisperAdapterOptions {
  binary: string;
  modelPath: string | null;
  processRunner: ProcessRunner;
  timeoutMs?: number;
}

/**
 * Shells out to a locally installed whisper.cpp-compatible CLI (`-m model -f file.wav -otxt -nt`).
 * No network access and no cloud API; the binary and model are entirely local.
 */
export class WhisperSpeechToText implements SpeechToTextPort {
  constructor(private readonly options: WhisperAdapterOptions) {}

  async transcribe(audio: AudioFrame): Promise<TranscriptionResult> {
    const dir = await mkdtemp(join(tmpdir(), "viral-voice-stt-"));
    const wavPath = join(dir, `${randomUUID()}.wav`);
    try {
      await writeFile(wavPath, encodeWav(audio.samples, audio.sampleRateHz, audio.channels));
      const command = resolveHarnessCommand(this.options.binary);
      const args = [
        ...(command.prefixArgs ?? []),
        ...(this.options.modelPath ? ["-m", this.options.modelPath] : []),
        "-f", wavPath, "-otxt", "-nt"
      ];
      const result = await this.options.processRunner.run({
        executable: command.executable,
        args,
        cwd: dir,
        stdin: "",
        timeoutMs: this.options.timeoutMs ?? 60_000
      });
      if (result.error || result.exitCode !== 0) {
        return { text: "", diagnostics: [result.error ?? `whisper exited with code ${result.exitCode ?? "unknown"}`, result.stderr].filter(Boolean) };
      }
      const transcriptText = await readFile(`${wavPath}.txt`, "utf8").catch(() => result.stdout);
      return { text: transcriptText.trim(), diagnostics: [] };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
