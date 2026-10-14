import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessRunner } from "../harness/types.js";
import type { VoiceEngineConfig } from "./config.js";
import type { SpeechToTextPort, TranscriptionResult } from "./types.js";

/** Shells out to a locally installed Whisper binary (e.g. whisper.cpp's `main`). Constructed at the
 *  edge; core voice logic depends only on SpeechToTextPort and is tested against fakes instead. */
export class WhisperSpeechToText implements SpeechToTextPort {
  readonly id = "whisper";

  constructor(private readonly config: VoiceEngineConfig, private readonly processRunner: ProcessRunner) {}

  async transcribe(wav: Buffer): Promise<TranscriptionResult> {
    const dir = await mkdtemp(join(tmpdir(), "viral-voice-stt-"));
    try {
      const inputPath = join(dir, `${randomUUID()}.wav`);
      await writeFile(inputPath, wav);
      const args = [...this.config.args, ...(this.config.modelPath ? ["-m", this.config.modelPath] : []), "-f", inputPath, "-nt"];
      const result = await this.processRunner.run({ executable: this.config.executable, args, cwd: dir, stdin: "", timeoutMs: 60_000 });
      if (result.exitCode !== 0 || result.error) throw new Error(`Whisper transcription failed: ${result.error ?? (result.stderr || "unknown error")}`);
      return { text: result.stdout.trim() };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
