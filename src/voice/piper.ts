import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessRunner } from "../harness/types.js";
import type { VoiceEngineConfig } from "./config.js";
import type { SynthesisResult, TextToSpeechPort } from "./types.js";

/** Shells out to a locally installed Piper binary. Constructed at the edge; core voice logic depends
 *  only on TextToSpeechPort and is tested against fakes instead. */
export class PiperTextToSpeech implements TextToSpeechPort {
  readonly id = "piper";

  constructor(private readonly config: VoiceEngineConfig, private readonly processRunner: ProcessRunner) {}

  async synthesize(text: string): Promise<SynthesisResult> {
    const dir = await mkdtemp(join(tmpdir(), "viral-voice-tts-"));
    try {
      const outputPath = join(dir, `${randomUUID()}.wav`);
      const args = [...this.config.args, ...(this.config.modelPath ? ["--model", this.config.modelPath] : []), "--output_file", outputPath];
      const result = await this.processRunner.run({ executable: this.config.executable, args, cwd: dir, stdin: text, timeoutMs: 60_000 });
      if (result.exitCode !== 0 || result.error) throw new Error(`Piper synthesis failed: ${result.error ?? (result.stderr || "unknown error")}`);
      return { wav: await readFile(outputPath) };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
