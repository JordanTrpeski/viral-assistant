import { NodeProcessRunner } from "../harness/process.js";
import { loadVoiceConfig } from "./config.js";
import { PiperTextToSpeech } from "./piper.js";
import { SoxAudioIo } from "./sox-audio.js";
import { WhisperSpeechToText } from "./whisper.js";
import type { AudioIoPort, ResponsePort, SpeechToTextPort, TextToSpeechPort, VoiceConfig } from "./types.js";

export class EchoResponder implements ResponsePort {
  async respond(transcript: string): Promise<string> {
    return `You said: ${transcript}`;
  }
}

export interface VoiceRuntime {
  config: VoiceConfig;
  audio: AudioIoPort;
  stt: SpeechToTextPort;
  tts: TextToSpeechPort;
  respond: ResponsePort;
}

export async function createVoiceRuntime(root: string): Promise<VoiceRuntime> {
  const config = await loadVoiceConfig(root);
  const processRunner = new NodeProcessRunner();
  return {
    config,
    audio: new SoxAudioIo({ processRunner }),
    stt: new WhisperSpeechToText({ binary: config.stt.binary, modelPath: config.stt.modelPath, processRunner }),
    tts: new PiperTextToSpeech({ binary: config.tts.binary, modelPath: config.tts.modelPath, processRunner }),
    respond: new EchoResponder()
  };
}
