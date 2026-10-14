export interface TranscriptionResult {
  text: string;
}

export interface SpeechToTextPort {
  readonly id: string;
  transcribe(wav: Buffer, sampleRateHz: number): Promise<TranscriptionResult>;
}

export interface SynthesisResult {
  wav: Buffer;
}

export interface TextToSpeechPort {
  readonly id: string;
  synthesize(text: string, sampleRateHz: number): Promise<SynthesisResult>;
}

export interface AudioFrame {
  pcm: Buffer;
  durationMs: number;
  speech: boolean;
}

export interface AudioCaptureSession {
  nextFrame(): Promise<AudioFrame | null>;
  stop(): void;
}

export type PlaybackOutcome = "completed" | "interrupted";

export interface AudioPlayback {
  readonly finished: Promise<PlaybackOutcome>;
  interrupt(): void;
}

export interface AudioPort {
  readonly sampleRateHz: number;
  startCapture(): AudioCaptureSession;
  play(wav: Buffer): AudioPlayback;
}

export interface VoicePorts {
  stt: SpeechToTextPort;
  tts: TextToSpeechPort;
  audio: AudioPort;
}

export interface VoiceTurn {
  turnIndex: number;
  startedAt: string;
  finishedAt: string;
  transcript: string;
  replyText: string;
  capturedMs: number;
  silenceTimedOut: boolean;
  interrupted: boolean;
}

export interface VoiceSessionOptions {
  overallTimeoutMs: number;
  silenceTimeoutMs: number;
  /** Listen for barge-in during playback. Defaults to false. */
  bargeIn?: boolean;
  /** Playback audio ignored before barge-in detection starts, so the reply's own onset cannot trigger it. Defaults to 500ms. */
  bargeInGraceMs?: number;
  /** Consecutive speech required after the grace period before playback is interrupted. Defaults to 200ms. */
  bargeInSustainMs?: number;
  respond?: (transcript: string) => string;
  maxTurns?: number;
}

export type VoiceSessionEndReason = "timeout" | "no-speech" | "max-turns";

export interface VoiceSessionResult {
  turns: VoiceTurn[];
  endedReason: VoiceSessionEndReason;
}
