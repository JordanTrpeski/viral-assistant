export interface WavFormat {
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
}

export interface DecodedWav extends WavFormat {
  data: Buffer;
}

const headerBytes = 44;

export function encodeWav(pcm: Buffer, format: WavFormat): Buffer {
  const { sampleRateHz, channels, bitsPerSample } = format;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRateHz * blockAlign;
  const header = Buffer.alloc(headerBytes);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function decodeWav(buffer: Buffer): DecodedWav {
  if (buffer.length < headerBytes) throw new Error("WAV buffer is too short to contain a valid header");
  if (buffer.toString("ascii", 0, 4) !== "RIFF") throw new Error("WAV buffer is missing the RIFF chunk");
  if (buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("WAV buffer is missing the WAVE format");
  if (buffer.toString("ascii", 12, 16) !== "fmt ") throw new Error("WAV buffer is missing the fmt chunk");
  if (buffer.readUInt16LE(20) !== 1) throw new Error("WAV buffer must use uncompressed PCM audio");
  const channels = buffer.readUInt16LE(22);
  const sampleRateHz = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  if (buffer.toString("ascii", 36, 40) !== "data") throw new Error("WAV buffer is missing the data chunk");
  const dataSize = buffer.readUInt32LE(40);
  const data = buffer.subarray(headerBytes, headerBytes + dataSize);
  if (data.length !== dataSize) throw new Error("WAV data chunk size does not match buffer length");
  return { sampleRateHz, channels, bitsPerSample, data };
}

/** Voice turns always use mono 16-bit PCM at the configured sample rate. */
export function assertVoiceWavFormat(wav: DecodedWav): void {
  if (wav.channels !== 1) throw new Error(`Voice audio must be mono; received ${wav.channels} channel(s)`);
  if (wav.sampleRateHz !== 16_000) throw new Error(`Voice audio must be 16kHz; received ${wav.sampleRateHz}Hz`);
  if (wav.bitsPerSample !== 16) throw new Error(`Voice audio must be 16-bit PCM; received ${wav.bitsPerSample}-bit`);
}

export function encodeVoiceWav(pcm: Buffer, sampleRateHz: number): Buffer {
  return encodeWav(pcm, { sampleRateHz, channels: 1, bitsPerSample: 16 });
}
