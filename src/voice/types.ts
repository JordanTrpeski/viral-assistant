export interface VoiceEngineConfig {
  engine: string;
  binary: string;
  modelPath: string | null;
}

export interface VoiceConfig {
  sampleRateHz: number;
  channels: 1;
  silenceTimeoutMs: number;
  stt: VoiceEngineConfig;
  tts: VoiceEngineConfig;
}

export interface AudioFrame {
  sampleRateHz: number;
  channels: number;
  samples: Buffer;
}

export interface CaptureOptions {
  sampleRateHz: number;
  channels: number;
  silenceTimeoutMs: number;
  maxDurationMs: number;
}

export type CaptureEndedReason = "silence" | "max_duration" | "no_speech";

export interface CaptureResult {
  audio: AudioFrame | null;
  endedReason: CaptureEndedReason;
  durationMs: number;
}

export interface PlaybackResult {
  interrupted: boolean;
  durationMs: number;
}

export interface AudioIoPort {
  capture(options: CaptureOptions): Promise<CaptureResult>;
  play(audio: AudioFrame): Promise<PlaybackResult>;
}

export interface TranscriptionResult {
  text: string;
  diagnostics: string[];
}

export interface SpeechToTextPort {
  transcribe(audio: AudioFrame): Promise<TranscriptionResult>;
}

export interface TextToSpeechPort {
  synthesize(text: string): Promise<AudioFrame>;
}

export interface ResponsePort {
  respond(transcript: string): Promise<string>;
}
