import type { AudioIoPort, ResponsePort, SpeechToTextPort, TextToSpeechPort } from "./types.js";

export interface VoiceTurn {
  turn: number;
  transcript: string;
  response: string;
  interrupted: boolean;
}

export type ListenEndReason = "timeout" | "no_speech" | "max_turns";

export interface ListenSessionResult {
  endedReason: ListenEndReason;
  turns: VoiceTurn[];
}

export interface ListenSessionDependencies {
  audio: AudioIoPort;
  stt: SpeechToTextPort;
  tts: TextToSpeechPort;
  respond: ResponsePort;
  now?: () => number;
}

export interface ListenSessionOptions {
  sessionTimeoutMs: number;
  silenceTimeoutMs: number;
  sampleRateHz: number;
  channels: number;
  maxTurns?: number;
}

export async function runListenSession(deps: ListenSessionDependencies, options: ListenSessionOptions): Promise<ListenSessionResult> {
  const now = deps.now ?? Date.now;
  const deadline = now() + options.sessionTimeoutMs;
  const maxTurns = options.maxTurns ?? Number.POSITIVE_INFINITY;
  const turns: VoiceTurn[] = [];

  while (turns.length < maxTurns) {
    const remaining = deadline - now();
    if (remaining <= 0) return { endedReason: "timeout", turns };

    const capture = await deps.audio.capture({
      sampleRateHz: options.sampleRateHz,
      channels: options.channels,
      silenceTimeoutMs: Math.min(options.silenceTimeoutMs, remaining),
      maxDurationMs: remaining
    });
    if (!capture.audio) return { endedReason: capture.endedReason === "max_duration" ? "timeout" : "no_speech", turns };

    const transcription = await deps.stt.transcribe(capture.audio);
    const transcript = transcription.text.trim();
    if (!transcript) return { endedReason: "no_speech", turns };

    const response = await deps.respond.respond(transcript);
    const responseAudio = await deps.tts.synthesize(response);
    const playback = await deps.audio.play(responseAudio);
    turns.push({ turn: turns.length + 1, transcript, response, interrupted: playback.interrupted });
  }

  return { endedReason: "max_turns", turns };
}
