export function encodeWav(samples: Buffer, sampleRateHz: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRateHz * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length, 4);
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
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

export interface DecodedWav {
  sampleRateHz: number;
  channels: number;
  samples: Buffer;
}

export function decodeWav(buffer: Buffer): DecodedWav {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Invalid WAV data: missing RIFF/WAVE header");
  }
  let offset = 12;
  let channels: number | null = null;
  let sampleRateHz: number | null = null;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buffer.readUInt16LE(body + 2);
      sampleRateHz = buffer.readUInt32LE(body + 4);
    } else if (id === "data") {
      dataStart = body;
      dataLength = size;
    }
    offset = body + size + (size % 2);
  }
  if (channels === null || sampleRateHz === null) throw new Error("Invalid WAV data: missing fmt chunk");
  if (dataStart === -1) throw new Error("Invalid WAV data: missing data chunk");
  return { sampleRateHz, channels, samples: buffer.subarray(dataStart, dataStart + dataLength) };
}
