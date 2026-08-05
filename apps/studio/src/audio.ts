import type { AutomatedAnalysisResult } from "@beat-master/core";
import { analyzeAudioSamples } from "@beat-master/core";

export interface DecodedTrack {
  file: File;
  buffer: AudioBuffer;
  mono: Float32Array;
  url: string;
}

export async function decodeTrack(file: File): Promise<DecodedTrack> {
  const audioContext = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const buffer = await audioContext.decodeAudioData(arrayBuffer);
  await audioContext.close();

  return {
    file,
    buffer,
    mono: toMono(buffer),
    url: URL.createObjectURL(file)
  };
}

export function analyzeTrack(
  track: DecodedTrack,
  phraseBars: number
): AutomatedAnalysisResult {
  return analyzeAudioSamples(track.mono, track.buffer.sampleRate, track.buffer.duration, {
    phraseBars,
    minBpm: 70,
    maxBpm: 180
  });
}

export function toMono(buffer: AudioBuffer): Float32Array {
  const output = new Float32Array(buffer.length);
  const channelCount = buffer.numberOfChannels;

  for (let channel = 0; channel < channelCount; channel += 1) {
    const channelData = buffer.getChannelData(channel);
    for (let index = 0; index < buffer.length; index += 1) {
      output[index] = (output[index] ?? 0) + (channelData[index] ?? 0) / channelCount;
    }
  }

  return output;
}
