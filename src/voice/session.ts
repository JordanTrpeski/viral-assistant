import { encodeVoiceWav } from "./wav.js";
import type {
  AudioPlayback, AudioPort, VoicePorts, VoiceSessionOptions, VoiceSessionResult, VoiceTurn
} from "./types.js";

function defaultRespond(transcript: string): string {
  const trimmed = transcript.trim();
  return trimmed ? `You said: ${trimmed}` : "I didn't catch that.";
}

interface CapturedTurn {
  pcm: Buffer;
  capturedMs: number;
  silenceTimedOut: boolean;
}

async function captureTurn(audio: AudioPort, silenceTimeoutMs: number, remainingMs: number): Promise<CapturedTurn> {
  const capture = audio.startCapture();
  const chunks: Buffer[] = [];
  let capturedMs = 0;
  let silenceMs = 0;
  let speechStarted = false;
  let silenceTimedOut = false;
  try {
    while (capturedMs < remainingMs) {
      const frame = await capture.nextFrame();
      if (!frame) break;
      chunks.push(frame.pcm);
      capturedMs += frame.durationMs;
      if (frame.speech) {
        speechStarted = true;
        silenceMs = 0;
      } else if (speechStarted) {
        silenceMs += frame.durationMs;
        if (silenceMs >= silenceTimeoutMs) {
          silenceTimedOut = true;
          break;
        }
      }
    }
  } finally {
    capture.stop();
  }
  return { pcm: Buffer.concat(chunks), capturedMs, silenceTimedOut };
}

/** Plays a response while concurrently listening for barge-in speech; stops the monitor once playback settles. */
async function playWithBargeIn(audio: AudioPort, playback: AudioPlayback): Promise<Awaited<AudioPlayback["finished"]>> {
  const capture = audio.startCapture();
  const watch = (async (): Promise<void> => {
    while (true) {
      const frame = await capture.nextFrame();
      if (!frame) return;
      if (frame.speech) {
        playback.interrupt();
        return;
      }
    }
  })();
  const outcome = await playback.finished;
  capture.stop();
  await watch;
  return outcome;
}

/** Runs the listen -> transcribe -> respond loop until the overall timeout, an empty capture, or maxTurns is reached. */
export async function runVoiceSession(ports: VoicePorts, options: VoiceSessionOptions): Promise<VoiceSessionResult> {
  const turns: VoiceTurn[] = [];
  const maxTurns = options.maxTurns ?? Number.POSITIVE_INFINITY;
  const respond = options.respond ?? defaultRespond;
  const deadline = Date.now() + options.overallTimeoutMs;
  while (turns.length < maxTurns) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return { turns, endedReason: "timeout" };
    const startedAt = new Date().toISOString();
    const { pcm, capturedMs, silenceTimedOut } = await captureTurn(ports.audio, options.silenceTimeoutMs, remainingMs);
    if (pcm.length === 0) return { turns, endedReason: "no-speech" };
    const transcription = await ports.stt.transcribe(encodeVoiceWav(pcm, ports.audio.sampleRateHz), ports.audio.sampleRateHz);
    const replyText = respond(transcription.text);
    const synthesis = await ports.tts.synthesize(replyText, ports.audio.sampleRateHz);
    const playback = ports.audio.play(synthesis.wav);
    const outcome = await playWithBargeIn(ports.audio, playback);
    turns.push({
      turnIndex: turns.length,
      startedAt,
      finishedAt: new Date().toISOString(),
      transcript: transcription.text,
      replyText,
      capturedMs,
      silenceTimedOut,
      interrupted: outcome === "interrupted"
    });
  }
  return { turns, endedReason: "max-turns" };
}
