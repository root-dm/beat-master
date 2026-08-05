import { createBeatGrid, type AutomatedAnalysisResult, type EnvelopePoint, type Onset } from "@beat-master/core";
import { describe, expect, it } from "vitest";
import { buildSongSections } from "../sections";

describe("song section detection", () => {
  it("splits a repeated hook when the waveform clearly changes halfway through", () => {
    const analysis = repeatedHookAnalysis();
    const sections = buildSongSections(analysis, analysis.beatGrid.duration);
    const hookSections = sections.filter((section) => section.label.startsWith("Chorus"));

    expect(sections.some((section) => section.startBar === 25)).toBe(true);
    expect(hookSections.length).toBeGreaterThanOrEqual(2);
  });
});

function repeatedHookAnalysis(): AutomatedAnalysisResult {
  const bpm = 120;
  const duration = 64;
  const beatGrid = createBeatGrid(bpm, duration, 0, 0.92, "automated");
  const barDuration = beatGrid.beatDuration * 4;
  const envelope: EnvelopePoint[] = [];
  const onsets: Onset[] = [];

  for (let time = 0; time < duration; time += 0.05) {
    const barIndex = Math.floor(time / barDuration);
    const phase = (time - barIndex * barDuration) / barDuration;
    envelope.push({
      time,
      rms: amplitudeForSyntheticBeat(barIndex, phase)
    });
  }

  for (let barIndex = 0; barIndex < Math.ceil(duration / barDuration); barIndex += 1) {
    const phases = barIndex >= 16 ? [0.05, 0.31, 0.52, 0.79] : [0.08, 0.43 + (barIndex % 3) * 0.09];
    for (const phase of phases) {
      onsets.push({
        time: barIndex * barDuration + phase * barDuration,
        strength: barIndex >= 16 ? 0.8 : 0.35
      });
    }
  }

  return {
    mode: "automated",
    envelope,
    onsets,
    beatGrid,
    markers: [
      {
        id: "old-energy-split",
        time: 48,
        label: "Old energy split",
        kind: "section",
        source: "automated",
        confidence: 0.9,
        bar: 25,
        beat: 1
      }
    ],
    phraseBars: 4,
    summary: "Synthetic repeated hook"
  };
}

function amplitudeForSyntheticBeat(barIndex: number, phase: number): number {
  if (barIndex < 4) {
    return 0.18 + Math.sin(phase * Math.PI * 2) * 0.02;
  }

  if (barIndex < 16) {
    return 0.3 + ((barIndex % 5) * 0.025) + Math.sin((phase + barIndex * 0.13) * Math.PI * 2) * 0.08;
  }

  const motif = [0.34, 0.82, 0.52, 0.68, 0.38, 0.86, 0.45, 0.66];
  const motifIndex = Math.min(motif.length - 1, Math.floor(phase * motif.length));
  const energyLift = barIndex < 24 ? 0.62 : 0.98;
  return (motif[motifIndex] ?? 0.5) * energyLift;
}
