import type { AutomatedAnalysisResult, BeatMarker } from "@beat-master/core";
import { clamp, roundTo } from "@beat-master/core";

export interface SongSection {
  id: string;
  label: string;
  start: number;
  end: number;
  startBar: number;
  endBar: number;
}

const DEFAULT_SECTION_LABELS = [
  "Intro",
  "Verse 1",
  "Chorus 1",
  "Verse 2",
  "Chorus 2",
  "Bridge",
  "Outro"
];

export function buildSongSections(
  analysis: AutomatedAnalysisResult | null,
  duration: number
): SongSection[] {
  if (!analysis || duration <= 0) {
    return [];
  }

  const beatDuration = analysis.beatGrid.beatDuration;
  const minGap = Math.max(beatDuration * 16, 6);
  const rawBoundaries = analysis.markers
    .filter((marker) => marker.kind === "section")
    .map((marker) => marker.time)
    .filter((time) => time > minGap && time < duration - minGap)
    .sort((a, b) => a - b);
  const boundaries = dedupeBoundaries([0, ...rawBoundaries, duration], minGap);

  if (boundaries.length < 2) {
    return [
      {
        id: "section-1",
        label: "Full track",
        start: 0,
        end: roundTo(duration, 3),
        startBar: 1,
        endBar: Math.max(1, Math.ceil(duration / (beatDuration * 4)))
      }
    ];
  }

  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1] ?? duration;
    return {
      id: `section-${index + 1}`,
      label: labelForSection(index, boundaries.length - 1),
      start: roundTo(start, 3),
      end: roundTo(end, 3),
      startBar: barForTime(start, analysis.beatGrid.beatDuration),
      endBar: Math.max(
        barForTime(start, analysis.beatGrid.beatDuration),
        barForTime(Math.max(start, end - 0.001), analysis.beatGrid.beatDuration)
      )
    };
  });
}

export function sectionContainingTime(
  sections: SongSection[],
  time: number
): SongSection | null {
  return (
    sections.find((section) => time >= section.start && time < section.end) ??
    sections[sections.length - 1] ??
    null
  );
}

export function sectionBoundaryMarkers(sections: SongSection[]): BeatMarker[] {
  return sections.slice(1).map((section, index) => ({
    id: `song-section-${section.id}`,
    time: section.start,
    label: section.label,
    kind: "section",
    source: "automated",
    confidence: 0.7,
    bar: section.startBar,
    beat: 1
  }));
}

function dedupeBoundaries(boundaries: number[], minGap: number): number[] {
  const sorted = [...boundaries].sort((a, b) => a - b);
  const output: number[] = [];

  for (const boundary of sorted) {
    const previous = output[output.length - 1];
    if (previous === undefined || boundary - previous >= minGap) {
      output.push(boundary);
    } else if (boundary > previous && boundary === sorted[sorted.length - 1]) {
      output[output.length - 1] = boundary;
    }
  }

  return output;
}

function labelForSection(index: number, count: number): string {
  if (index === count - 1 && count > 1) {
    return "Outro";
  }

  return DEFAULT_SECTION_LABELS[index] ?? `Section ${index + 1}`;
}

function barForTime(time: number, beatDuration: number): number {
  const barDuration = Math.max(0.001, beatDuration * 4);
  return Math.floor(clamp(time, 0, Number.POSITIVE_INFINITY) / barDuration) + 1;
}

