import { describe, expect, it } from "vitest";
import {
  analyzeAudioSamples,
  createBeatGrid,
  exportMarkersAsCsv,
  learnManualPattern,
  secondsToTimecode
} from "../index";

function clickTrack(bpm: number, duration: number, sampleRate = 44_100): Float32Array {
  const totalSamples = Math.floor(duration * sampleRate);
  const samples = new Float32Array(totalSamples);
  const beatDuration = 60 / bpm;

  for (let beat = 0; beat * beatDuration < duration; beat += 1) {
    const start = Math.floor(beat * beatDuration * sampleRate);
    for (let index = 0; index < 700 && start + index < samples.length; index += 1) {
      const decay = 1 - index / 700;
      samples[start + index] = Math.sin(index * 0.25) * decay;
    }
  }

  return samples;
}

describe("beat-core", () => {
  it("learns a 4-bar manual pattern from repeated taps", () => {
    const result = learnManualPattern([1, 9, 17, 25], 33, {
      phraseBarsHint: 4
    });

    expect(result.pattern.phraseBars).toBe(4);
    expect(result.markers.length).toBeGreaterThanOrEqual(4);
    expect(result.pattern.confidence).toBeGreaterThan(0.7);
  });

  it("repeats every tap inside the learned manual phrase", () => {
    const tempoHint = createBeatGrid(120, 18, 0, 0.9, "automated");
    const result = learnManualPattern([1, 3, 5, 7], 18, {
      tempoHint,
      phraseBarsHint: 4
    });

    expect(result.pattern.motifOffsets).toEqual([0, 2, 4, 6]);
    expect(result.markers.map((marker) => marker.time).slice(0, 8)).toEqual([
      1,
      3,
      5,
      7,
      9,
      11,
      13,
      15
    ]);
  });

  it("clusters repeated phrase examples and quantizes them to the meter", () => {
    const tempoHint = createBeatGrid(120, 20, 0, 0.9, "automated");
    const result = learnManualPattern([1.06, 3.11, 5.9, 9.08, 11.14, 13.88], 20, {
      tempoHint,
      phraseBarsHint: 4
    });

    expect(result.pattern.motifOffsets).toEqual([0, 2, 5]);
    expect(result.markers.map((marker) => marker.time)).toEqual([
      1,
      3,
      6,
      9,
      11,
      14,
      17,
      19
    ]);
  });

  it("applies a learned motif only inside the requested section range", () => {
    const tempoHint = createBeatGrid(120, 40, 0, 0.9, "automated");
    const result = learnManualPattern([17.1, 19.1], 40, {
      tempoHint,
      phraseBarsHint: 4,
      applyStart: 16,
      applyEnd: 32
    });

    expect(result.pattern.applyStart).toBe(16);
    expect(result.pattern.applyEnd).toBe(32);
    expect(result.markers.map((marker) => marker.time)).toEqual([17, 19, 25, 27]);
  });

  it("estimates tempo from a simple synthetic click track", () => {
    const sampleRate = 44_100;
    const result = analyzeAudioSamples(clickTrack(120, 20, sampleRate), sampleRate, 20, {
      minBpm: 90,
      maxBpm: 140
    });

    expect(result.beatGrid.bpm).toBeGreaterThanOrEqual(118);
    expect(result.beatGrid.bpm).toBeLessThanOrEqual(122);
    expect(result.markers.length).toBeGreaterThan(0);
  });

  it("exports marker data as csv with timecode", () => {
    const result = learnManualPattern([0, 8], 16, {
      phraseBarsHint: 4
    });
    const csv = exportMarkersAsCsv(result.markers, 30);

    expect(csv).toContain("Timecode");
    expect(csv).toContain("00:00:00:00");
    expect(secondsToTimecode(1.5, 30)).toBe("00:00:01:15");
  });
});
