import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import type { ProcessResult, ProcessRunner, ProcessSpec } from "../src/harness/types.js";
import { WhisperSpeechToText } from "../src/voice/whisper.js";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

class FakeRunner implements ProcessRunner {
  constructor(private readonly result: Partial<ProcessResult>) {}
  async run(_spec: ProcessSpec): Promise<ProcessResult> {
    return {
      startedAt: "", finishedAt: "", durationMs: 0, exitCode: 0, signal: null,
      timedOut: false, stdout: "", stderr: "", error: null, ...this.result
    };
  }
}

const engine = { executable: "whisper", args: [], modelPath: null };

test("a missing Whisper binary throws instead of returning an empty transcript", async () => {
  const stt = new WhisperSpeechToText(engine, new FakeRunner({ exitCode: null, error: "ENOENT: spawn whisper ENOENT" }));
  await assert.rejects(stt.transcribe(Buffer.alloc(44)), /Whisper transcription failed: ENOENT/);
});

test("a crashing Whisper process throws with its stderr", async () => {
  const stt = new WhisperSpeechToText(engine, new FakeRunner({ exitCode: 1, stderr: "failed to load model" }));
  await assert.rejects(stt.transcribe(Buffer.alloc(44)), /failed to load model/);
});

test("a timed-out Whisper process (killed, exit code null) throws", async () => {
  const stt = new WhisperSpeechToText(engine, new FakeRunner({ exitCode: null, signal: "SIGTERM", timedOut: true }));
  await assert.rejects(stt.transcribe(Buffer.alloc(44)), /Whisper transcription failed/);
});

test("voice listen exits with code 1 when Whisper is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "viral-voice-cli-"));
  try {
    // Capture is a Node one-liner emitting 200ms of loud 16-bit mono PCM and exiting, so the session reaches
    // transcription without SoX or a microphone; the configured Whisper executable does not exist.
    const emitSpeech = "const b=Buffer.alloc(6400);for(let i=0;i<b.length;i+=2)b.writeInt16LE(10000,i);process.stdout.write(b);";
    await writeFile(join(root, "viral-dev.config.json"), JSON.stringify({
      voice: {
        stt: { executable: join(root, "missing-whisper") },
        audio: { captureCommand: process.execPath, captureArgs: ["-e", emitSpeech] }
      }
    }));
    await assert.rejects(
      run(process.execPath, [cli, "voice", "listen", "--timeout", "5s"], { env: { ...process.env, VIRAL_ROOT: root }, timeout: 20_000 }),
      (error: unknown) => {
        const failure = error as { code: number; stderr: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stderr, /Whisper transcription failed/);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
