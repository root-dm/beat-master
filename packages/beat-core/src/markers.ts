import type { BeatGrid, BeatMarker, EnvelopePoint, MarkerGenerationOptions } from "./types";
import { clamp, roundTo } from "./statistics";
import { secondsToClock, secondsToTimecode } from "./time";

function markerId(prefix: string, time: number, index: number): string {
  return `${prefix}-${index + 1}-${Math.round(time * 1000)}`;
}

export function createBeatGrid(
  bpm: number,
  duration: number,
  offset: number,
  confidence: number,
  source: BeatGrid["source"]
): BeatGrid {
  const safeBpm = clamp(bpm, 40, 260);
  const beatDuration = 60 / safeBpm;
  const beats: number[] = [];
  let cursor = offset;

  while (cursor - beatDuration >= 0) {
    cursor -= beatDuration;
  }

  while (cursor < 0) {
    cursor += beatDuration;
  }

  for (let time = cursor; time <= duration + 0.001; time += beatDuration) {
    beats.push(roundTo(time, 3));
  }

  return {
    bpm: roundTo(safeBpm, 2),
    beatDuration,
    offset: roundTo(cursor, 3),
    duration,
    beats,
    confidence: clamp(confidence, 0, 1),
    source
  };
}

export function generateMarkersFromGrid(
  grid: BeatGrid,
  options: MarkerGenerationOptions = {},
  envelope: EnvelopePoint[] = []
): BeatMarker[] {
  const phraseBars = options.phraseBars ?? 4;
  const phraseBeats = Math.max(1, Math.round(phraseBars * 4));
  const phraseDuration = phraseBeats * grid.beatDuration;
  const startAt = options.startAt ?? grid.offset;
  const markers: BeatMarker[] = [];
  let cutIndex = 0;

  for (let time = startAt; time <= grid.duration + 0.001; time += phraseDuration) {
    if (time >= 0) {
      const energy = energyNearTime(envelope, time);
      markers.push({
        id: markerId("cut", time, cutIndex),
        time: roundTo(time, 3),
        label: `Cut ${cutIndex + 1}`,
        kind: "cut",
        source: grid.source,
        confidence: grid.confidence,
        bar: cutIndex * phraseBars + 1,
        beat: 1,
        energy
      });
      cutIndex += 1;
    }
  }

  if (options.includeSectionMarkers) {
    markers.push(...createSectionMarkers(grid, phraseBars, envelope));
  }

  if (options.includeBeatMarkers) {
    markers.push(
      ...grid.beats.map((time, index) => ({
        id: markerId("beat", time, index),
        time,
        label: `Beat ${index + 1}`,
        kind: "beat" as const,
        source: grid.source,
        confidence: grid.confidence * 0.75,
        bar: Math.floor(index / 4) + 1,
        beat: (index % 4) + 1
      }))
    );
  }

  return markers.sort((a, b) => a.time - b.time || a.label.localeCompare(b.label));
}

export function createSectionMarkers(
  grid: BeatGrid,
  phraseBars: number,
  envelope: EnvelopePoint[]
): BeatMarker[] {
  if (envelope.length === 0 || grid.beats.length === 0) {
    return [];
  }

  const phraseBeats = Math.max(1, Math.round(phraseBars * 4));
  const phraseDuration = phraseBeats * grid.beatDuration;
  const phrases = Math.floor(grid.duration / phraseDuration);
  if (phrases < 2) {
    return [];
  }

  const energies = Array.from({ length: phrases }, (_, phraseIndex) => {
    const start = grid.offset + phraseIndex * phraseDuration;
    const end = start + phraseDuration;
    const points = envelope.filter((point) => point.time >= start && point.time < end);
    const average =
      points.reduce((total, point) => total + point.rms, 0) / Math.max(1, points.length);
    return average;
  });

  const markers: BeatMarker[] = [];
  for (let index = 1; index < energies.length; index += 1) {
    const previous = energies[index - 1] ?? 0;
    const current = energies[index] ?? 0;
    const delta = Math.abs(current - previous);
    const changedEnough = delta > 0.08 && delta > Math.max(previous, current) * 0.22;
    const structuralBoundary = index % 4 === 0;

    if (changedEnough || structuralBoundary) {
      const time = grid.offset + index * phraseDuration;
      if (time < grid.duration) {
        markers.push({
          id: markerId("section", time, markers.length),
          time: roundTo(time, 3),
          label: `Section ${markers.length + 1}`,
          kind: "section",
          source: grid.source,
          confidence: changedEnough ? 0.85 : 0.55,
          bar: index * phraseBars + 1,
          beat: 1,
          energy: roundTo(current, 3)
        });
      }
    }
  }

  return markers;
}

function energyNearTime(envelope: EnvelopePoint[], time: number): number | undefined {
  if (envelope.length === 0) {
    return undefined;
  }

  let closest = envelope[0];
  for (const point of envelope) {
    if (Math.abs(point.time - time) < Math.abs((closest?.time ?? 0) - time)) {
      closest = point;
    }
  }

  return closest ? roundTo(closest.rms, 3) : undefined;
}

export function exportMarkersAsJson(markers: BeatMarker[]): string {
  return JSON.stringify(
    markers.map((marker) => ({
      name: marker.label,
      time: roundTo(marker.time, 3),
      timeLabel: secondsToClock(marker.time),
      kind: marker.kind,
      source: marker.source,
      confidence: roundTo(marker.confidence, 3),
      bar: marker.bar,
      beat: marker.beat
    })),
    null,
    2
  );
}

export function exportMarkersAsCsv(markers: BeatMarker[], fps = 30): string {
  const rows = [
    ["Name", "TimeSeconds", "Timecode", "Kind", "Source", "Confidence", "Bar", "Beat"],
    ...markers.map((marker) => [
      marker.label,
      roundTo(marker.time, 3).toString(),
      secondsToTimecode(marker.time, fps),
      marker.kind,
      marker.source,
      roundTo(marker.confidence, 3).toString(),
      marker.bar?.toString() ?? "",
      marker.beat?.toString() ?? ""
    ])
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

