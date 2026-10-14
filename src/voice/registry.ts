import { NodeProcessRunner } from "../harness/process.js";
import { ProcessAudioPort } from "./audio.js";
import { loadVoiceConfig } from "./config.js";
import { PiperTextToSpeech } from "./piper.js";
import { WhisperSpeechToText } from "./whisper.js";
import type { VoicePorts } from "./types.js";

export { loadVoiceConfig } from "./config.js";

/** Wires the real local Whisper/Piper/audio adapters against the repository configuration. Used by
 *  `viral-dev voice listen`; tests construct the session against fake ports instead. */
export async function createVoicePorts(root: string): Promise<VoicePorts> {
  const config = await loadVoiceConfig(root);
  const processRunner = new NodeProcessRunner();
  return {
    stt: new WhisperSpeechToText(config.stt, processRunner),
    tts: new PiperTextToSpeech(config.tts, processRunner),
    audio: new ProcessAudioPort({
      sampleRateHz: config.sampleRateHz,
      captureCommand: config.audio.captureCommand,
      captureArgs: config.audio.captureArgs,
      playbackCommand: config.audio.playbackCommand,
      playbackArgs: config.audio.playbackArgs,
      speechThreshold: config.audio.speechThreshold
    })
  };
}
