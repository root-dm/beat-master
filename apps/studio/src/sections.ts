import type {
  AutomatedAnalysisResult,
  BeatGrid,
  BeatMarker,
  EnvelopePoint,
  Onset
} from "@beat-master/core";
import { clamp, roundTo } from "@beat-master/core";

export interface SongSection {
  id: string;
  label: string;
  start: number;
  end: number;
  startBar: number;
  endBar: number;
  repeatScore: number;
  changeScore: number;
}

interface BarProfile {
  start: number;
  end: number;
  energy: number;
  dynamic: number;
  onsetDensity: number;
  shape: number[];
  onsetShape: number[];
  repeatScore: number;
}

interface RepeatZone {
  startBarIndex: number;
  endBarIndex: number;
  score: number;
}

interface BoundaryCandidate {
  barIndex: number;
  score: number;
}

const DEFAULT_SECTION_LABELS = {
  intro: "Intro",
  verse: "Verse",
  chorus: "Chorus",
  bridge: "Bridge",
  outro: "Outro"
};

const MIN_SECTION_BARS = 2;
const SHAPE_BINS = 8;
const ONSET_BINS = 4;
const REPEAT_WINDOWS = [8, 4];
const REPEAT_THRESHOLD = 0.55;
const CHORUS_THRESHOLD = 0.5;
const VISUAL_SCORE_FLOOR = 0.2;
const MAX_SECTION_BOUNDARIES = 14;

export function buildSongSections(
  analysis: AutomatedAnalysisResult | null,
  duration: number
): SongSection[] {
  if (!analysis || duration <= 0) {
    return [];
  }

  const barDuration = Math.max(0.001, analysis.beatGrid.beatDuration * 4);
  const bars = buildBarProfiles(
    analysis.envelope,
    analysis.onsets,
    analysis.beatGrid,
    duration
  );

  if (bars.length < MIN_SECTION_BARS) {
    return [fullTrackSection(duration, barDuration)];
  }

  const repeatZones = detectRepeatZones(bars);
  const changeScores = scoreVisualBoundaries(bars);
  const boundaries = chooseVisualBoundaries(
    bars.length,
    duration,
    changeScores,
    repeatZones,
    highConfidenceMarkerBoundaries(analysis, duration, barDuration)
  );

  if (boundaries.length < 2) {
    return [fullTrackSection(duration, barDuration)];
  }

  return labelSections(
    boundaries.slice(0, -1).map((startBarIndex, index) => {
      const endBarIndex = boundaries[index + 1] ?? bars.length;
      return {
        id: `section-${index + 1}`,
        label: `Section ${index + 1}`,
        start: roundTo(timeForBoundary(startBarIndex, bars, duration), 3),
        end: roundTo(timeForBoundary(endBarIndex, bars, duration), 3),
        startBar: startBarIndex + 1,
        endBar: Math.max(startBarIndex + 1, endBarIndex),
        repeatScore: averageRepeatScore(bars, startBarIndex, endBarIndex),
        changeScore: changeScores.get(startBarIndex)?.score ?? 0
      };
    }),
    repeatZones
  );
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
    confidence: roundTo(clamp(0.56 + section.changeScore * 0.34 + section.repeatScore * 0.08, 0.55, 0.95), 3),
    bar: section.startBar,
    beat: 1
  }));
}

function fullTrackSection(duration: number, barDuration: number): SongSection {
  return {
    id: "section-1",
    label: "Full track",
    start: 0,
    end: roundTo(duration, 3),
    startBar: 1,
    endBar: Math.max(1, Math.ceil(duration / Math.max(0.001, barDuration))),
    repeatScore: 0,
    changeScore: 0
  };
}

function buildBarProfiles(
  envelope: EnvelopePoint[],
  onsets: Onset[],
  beatGrid: BeatGrid,
  duration: number
): BarProfile[] {
  const barDuration = Math.max(0.001, beatGrid.beatDuration * 4);
  const barCount = Math.max(1, Math.ceil(duration / barDuration));
  const bars: BarProfile[] = [];

  for (let index = 0; index < barCount; index += 1) {
    const start = index * barDuration;
    const end = Math.min(duration, start + barDuration);
    const points = envelope.filter((point) => point.time >= start && point.time < end);
    const onsetPoints = onsets.filter((onset) => onset.time >= start && onset.time < end);
    const values = points.map((point) => point.rms);
    const energy = average(values);
    const peak = values.length > 0 ? Math.max(...values) : 0;
    const trough = values.length > 0 ? Math.min(...values) : 0;
    const beatsInBar = Math.max(1, (end - start) / beatGrid.beatDuration);

    bars.push({
      start,
      end,
      energy,
      dynamic: peak - trough,
      onsetDensity: onsetPoints.length / beatsInBar,
      shape: buildEnvelopeShape(points, start, end, SHAPE_BINS),
      onsetShape: buildOnsetShape(onsetPoints, start, end, ONSET_BINS),
      repeatScore: 0
    });
  }

  return bars;
}

function scoreVisualBoundaries(bars: BarProfile[]): Map<number, BoundaryCandidate> {
  const candidates = new Map<number, BoundaryCandidate>();
  const energyValues = bars.map((bar) => bar.energy);
  const dynamicValues = bars.map((bar) => bar.dynamic);
  const onsetValues = bars.map((bar) => bar.onsetDensity);
  const energyRange = valueRange(energyValues);
  const dynamicRange = valueRange(dynamicValues);
  const onsetRange = valueRange(onsetValues);

  for (let barIndex = 1; barIndex < bars.length; barIndex += 1) {
    const longContext = Math.min(4, barIndex, bars.length - barIndex);
    const shortContext = Math.min(2, barIndex, bars.length - barIndex);
    if (shortContext < 1) {
      continue;
    }

    const longPrevious = bars.slice(barIndex - longContext, barIndex);
    const longNext = bars.slice(barIndex, barIndex + longContext);
    const shortPrevious = bars.slice(barIndex - shortContext, barIndex);
    const shortNext = bars.slice(barIndex, barIndex + shortContext);
    const previousBar = bars[barIndex - 1];
    const nextBar = bars[barIndex];
    if (!previousBar || !nextBar) {
      continue;
    }

    const longNovelty = 1 - similarityScore(buildWindowVector(longPrevious), buildWindowVector(longNext));
    const shortNovelty = 1 - similarityScore(buildWindowVector(shortPrevious), buildWindowVector(shortNext));
    const energyJump = normalizedDifference(
      average(longPrevious.map((bar) => bar.energy)),
      average(longNext.map((bar) => bar.energy)),
      energyRange
    );
    const adjacentEnergyJump = normalizedDifference(previousBar.energy, nextBar.energy, energyRange);
    const dynamicJump = normalizedDifference(
      average(shortPrevious.map((bar) => bar.dynamic)),
      average(shortNext.map((bar) => bar.dynamic)),
      dynamicRange
    );
    const onsetJump = normalizedDifference(
      average(shortPrevious.map((bar) => bar.onsetDensity)),
      average(shortNext.map((bar) => bar.onsetDensity)),
      onsetRange
    );

    const score = roundTo(
      clamp(
        longNovelty * 0.34 +
          shortNovelty * 0.24 +
          energyJump * 0.18 +
          onsetJump * 0.11 +
          dynamicJump * 0.08 +
          adjacentEnergyJump * 0.05,
        0,
        1
      ),
      3
    );

    if (score >= VISUAL_SCORE_FLOOR) {
      candidates.set(barIndex, {
        barIndex,
        score
      });
    }
  }

  return candidates;
}

function chooseVisualBoundaries(
  barCount: number,
  duration: number,
  visualCandidates: Map<number, BoundaryCandidate>,
  repeatZones: RepeatZone[],
  markerCandidates: BoundaryCandidate[]
): number[] {
  const targetBoundaryCount = clamp(Math.round(duration / 18), 4, MAX_SECTION_BOUNDARIES);
  const merged = mergeBoundaryCandidates([
    ...visualCandidates.values(),
    ...repeatZones.flatMap((zone) => [
      { barIndex: zone.startBarIndex, score: Math.max(zone.score, 0.48) },
      { barIndex: zone.endBarIndex, score: Math.max(zone.score, 0.46) }
    ]),
    ...markerCandidates
  ], barCount);
  const scores = merged.map((candidate) => candidate.score);
  const adaptiveFloor = Math.max(VISUAL_SCORE_FLOOR, quantile(scores, 0.56));
  const strongFloor = Math.max(0.32, quantile(scores, 0.74));
  const selected: BoundaryCandidate[] = [];

  for (const candidate of merged.sort((a, b) => b.score - a.score)) {
    const stillFillingExpectedShape = selected.length < targetBoundaryCount && candidate.score >= adaptiveFloor;
    const definitelyStrong = candidate.score >= strongFloor;
    if (!stillFillingExpectedShape && !definitelyStrong) {
      continue;
    }

    const minGap = candidate.score >= 0.58 ? 1 : MIN_SECTION_BARS;
    const tooClose = selected.some(
      (existing) => Math.abs(existing.barIndex - candidate.barIndex) < minGap
    );
    if (!tooClose) {
      selected.push(candidate);
    }

    if (selected.length >= MAX_SECTION_BOUNDARIES) {
      break;
    }
  }

  return sanitizeBoundaries([0, ...selected.map((candidate) => candidate.barIndex), barCount], barCount);
}

function mergeBoundaryCandidates(
  candidates: BoundaryCandidate[],
  barCount: number
): BoundaryCandidate[] {
  const byBar = new Map<number, BoundaryCandidate>();

  for (const candidate of candidates) {
    const barIndex = clamp(Math.round(candidate.barIndex), 0, barCount);
    if (barIndex <= 0 || barIndex >= barCount) {
      continue;
    }

    const previous = byBar.get(barIndex);
    if (!previous || candidate.score > previous.score) {
      byBar.set(barIndex, {
        barIndex,
        score: candidate.score
      });
    }
  }

  return Array.from(byBar.values());
}

function detectRepeatZones(bars: BarProfile[]): RepeatZone[] {
  if (bars.length < MIN_SECTION_BARS * 4) {
    return [];
  }

  const barScores = Array.from({ length: bars.length }, () => 0);

  for (const windowBars of REPEAT_WINDOWS) {
    if (bars.length < windowBars * 2) {
      continue;
    }

    const windows = buildWindows(bars, windowBars);
    for (let index = 0; index < windows.length; index += 1) {
      const current = windows[index];
      if (!current) {
        continue;
      }

      let bestScore = 0;
      for (let otherIndex = 0; otherIndex < windows.length; otherIndex += 1) {
        if (index === otherIndex) {
          continue;
        }

        const other = windows[otherIndex];
        if (!other || Math.abs(other.startBarIndex - current.startBarIndex) < windowBars) {
          continue;
        }

        bestScore = Math.max(bestScore, similarityScore(current.vector, other.vector));
      }

      if (bestScore < REPEAT_THRESHOLD) {
        continue;
      }

      for (
        let barIndex = current.startBarIndex;
        barIndex < current.startBarIndex + windowBars && barIndex < barScores.length;
        barIndex += 1
      ) {
        barScores[barIndex] = Math.max(barScores[barIndex] ?? 0, bestScore);
      }
    }
  }

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (bar) {
      bar.repeatScore = roundTo(barScores[index] ?? 0, 3);
    }
  }

  return mergeRepeatScores(barScores, bars.length);
}

function buildWindows(bars: BarProfile[], windowBars: number) {
  const windows: Array<{ startBarIndex: number; vector: number[] }> = [];

  for (let startBarIndex = 0; startBarIndex <= bars.length - windowBars; startBarIndex += 1) {
    windows.push({
      startBarIndex,
      vector: buildWindowVector(bars.slice(startBarIndex, startBarIndex + windowBars))
    });
  }

  return windows;
}

function buildWindowVector(bars: BarProfile[]): number[] {
  const meanEnergy = Math.max(0.001, average(bars.map((bar) => bar.energy)));
  const maxOnsetDensity = Math.max(0.001, ...bars.map((bar) => bar.onsetDensity));
  const vector: number[] = [];

  for (const bar of bars) {
    vector.push(...bar.shape.map((value) => value * 0.48));
    vector.push(...bar.onsetShape.map((value) => value * 0.24));
    vector.push(clamp(bar.dynamic * 1.4, 0, 1) * 0.12);
    vector.push(clamp(bar.onsetDensity / maxOnsetDensity, 0, 1) * 0.1);
    vector.push(clamp(bar.energy / meanEnergy, 0, 2) * 0.06);
  }

  return vector;
}

function similarityScore(first: number[], second: number[]): number {
  const length = Math.min(first.length, second.length);
  if (length === 0) {
    return 0;
  }

  let distance = 0;
  for (let index = 0; index < length; index += 1) {
    distance += Math.abs((first[index] ?? 0) - (second[index] ?? 0));
  }

  const normalizedDistance = distance / length;
  return roundTo(1 - clamp(normalizedDistance / 0.3, 0, 1), 3);
}

function mergeRepeatScores(scores: number[], barCount: number): RepeatZone[] {
  const zones: RepeatZone[] = [];
  let activeStart: number | null = null;
  let activeScores: number[] = [];
  let gap = 0;

  for (let index = 0; index < scores.length; index += 1) {
    const score = scores[index] ?? 0;
    const isActive = score >= REPEAT_THRESHOLD;

    if (isActive) {
      if (activeStart === null) {
        activeStart = index;
        activeScores = [];
      }
      gap = 0;
      activeScores.push(score);
      continue;
    }

    if (activeStart !== null && gap < 1) {
      gap += 1;
      activeScores.push(score);
      continue;
    }

    if (activeStart !== null) {
      zones.push(normalizeRepeatZone(activeStart, index - gap, activeScores, barCount));
      activeStart = null;
      activeScores = [];
      gap = 0;
    }
  }

  if (activeStart !== null) {
    zones.push(normalizeRepeatZone(activeStart, scores.length, activeScores, barCount));
  }

  return mergeOverlappingZones(
    zones.filter((zone) => zone.endBarIndex - zone.startBarIndex >= MIN_SECTION_BARS),
    barCount
  );
}

function normalizeRepeatZone(
  startBarIndex: number,
  endBarIndex: number,
  scores: number[],
  barCount: number
): RepeatZone {
  const snappedStart = clamp(Math.floor(startBarIndex / MIN_SECTION_BARS) * MIN_SECTION_BARS, 0, barCount);
  const snappedEnd = clamp(Math.ceil(endBarIndex / MIN_SECTION_BARS) * MIN_SECTION_BARS, MIN_SECTION_BARS, barCount);

  return {
    startBarIndex: clamp(snappedStart, 0, Math.max(0, barCount - MIN_SECTION_BARS)),
    endBarIndex: Math.max(snappedStart + MIN_SECTION_BARS, snappedEnd),
    score: roundTo(average(scores), 3)
  };
}

function mergeOverlappingZones(zones: RepeatZone[], barCount: number): RepeatZone[] {
  const sorted = [...zones].sort((a, b) => a.startBarIndex - b.startBarIndex);
  const merged: RepeatZone[] = [];

  for (const zone of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || zone.startBarIndex > previous.endBarIndex) {
      merged.push(zone);
      continue;
    }

    previous.endBarIndex = clamp(
      Math.max(previous.endBarIndex, zone.endBarIndex),
      previous.startBarIndex + MIN_SECTION_BARS,
      barCount
    );
    previous.score = roundTo(Math.max(previous.score, zone.score), 3);
  }

  return merged;
}

function highConfidenceMarkerBoundaries(
  analysis: AutomatedAnalysisResult,
  duration: number,
  barDuration: number
): BoundaryCandidate[] {
  const barCount = Math.ceil(duration / barDuration);

  return analysis.markers
    .filter((marker) => marker.kind === "section" && marker.confidence >= 0.8)
    .map((marker) => ({
      barIndex: Math.round(marker.time / barDuration),
      score: Math.max(0.36, marker.confidence * 0.72)
    }))
    .filter((candidate) => candidate.barIndex > 0 && candidate.barIndex < barCount);
}

function sanitizeBoundaries(boundaries: number[], barCount: number): number[] {
  const sorted = Array.from(
    new Set(boundaries.map((boundary) => clamp(Math.round(boundary), 0, barCount)))
  ).sort((a, b) => a - b);
  const output: number[] = [];

  for (const boundary of sorted) {
    const previous = output[output.length - 1];
    if (previous === undefined) {
      output.push(boundary);
      continue;
    }

    if (boundary - previous >= MIN_SECTION_BARS || boundary === barCount) {
      output.push(boundary);
    }
  }

  if (output[0] !== 0) {
    output.unshift(0);
  }

  if (output[output.length - 1] !== barCount) {
    output.push(barCount);
  }

  if (output.length > 2) {
    const beforeLast = output[output.length - 2];
    const last = output[output.length - 1];
    if (beforeLast !== undefined && last !== undefined && last - beforeLast < MIN_SECTION_BARS) {
      output.splice(output.length - 2, 1);
    }
  }

  return output;
}

function labelSections(sections: SongSection[], repeatZones: RepeatZone[]): SongSection[] {
  if (sections.length === 1) {
    const section = sections[0];
    return section ? [{ ...section, label: "Full track" }] : sections;
  }

  let verseCount = 0;
  let chorusCount = 0;
  let bridgeCount = 0;
  const firstChorusIndex = sections.findIndex((section) =>
    isChorusLike(section, repeatZones)
  );

  return sections.map((section, index) => {
    const chorusLike = isChorusLike(section, repeatZones);
    let label: string;

    if (chorusLike) {
      chorusCount += 1;
      label = `${DEFAULT_SECTION_LABELS.chorus} ${chorusCount}`;
    } else if (index === 0 && firstChorusIndex !== 0) {
      label = DEFAULT_SECTION_LABELS.intro;
    } else if (index === sections.length - 1 && sections.length > 2) {
      label = DEFAULT_SECTION_LABELS.outro;
    } else if (chorusCount >= 2 && index > firstChorusIndex) {
      bridgeCount += 1;
      label = bridgeCount === 1 ? DEFAULT_SECTION_LABELS.bridge : `${DEFAULT_SECTION_LABELS.bridge} ${bridgeCount}`;
    } else {
      verseCount += 1;
      label = `${DEFAULT_SECTION_LABELS.verse} ${verseCount}`;
    }

    return {
      ...section,
      label
    };
  });
}

function isChorusLike(section: SongSection, repeatZones: RepeatZone[]): boolean {
  const startIndex = section.startBar - 1;
  const endIndex = section.endBar;
  const overlap = repeatZones.some((zone) => {
    const overlapStart = Math.max(startIndex, zone.startBarIndex);
    const overlapEnd = Math.min(endIndex, zone.endBarIndex);
    const overlapBars = Math.max(0, overlapEnd - overlapStart);
    const sectionBars = Math.max(1, endIndex - startIndex);
    return overlapBars / sectionBars >= 0.38 && zone.score >= CHORUS_THRESHOLD;
  });

  return overlap || section.repeatScore >= CHORUS_THRESHOLD;
}

function averageRepeatScore(bars: BarProfile[], startBarIndex: number, endBarIndex: number): number {
  return roundTo(average(bars.slice(startBarIndex, endBarIndex).map((bar) => bar.repeatScore)), 3);
}

function timeForBoundary(barIndex: number, bars: BarProfile[], duration: number): number {
  if (barIndex <= 0) {
    return 0;
  }

  if (barIndex >= bars.length) {
    return duration;
  }

  return bars[barIndex]?.start ?? duration;
}

function buildEnvelopeShape(
  points: EnvelopePoint[],
  start: number,
  end: number,
  bins: number
): number[] {
  const raw = averageBins(
    points.map((point) => ({ time: point.time, value: point.rms })),
    start,
    end,
    bins
  );
  const minimum = Math.min(...raw);
  const maximum = Math.max(...raw);
  const range = maximum - minimum;

  if (range < 0.0001) {
    return raw.map(() => 0.5);
  }

  return raw.map((value) => roundTo(clamp((value - minimum) / range, 0, 1), 3));
}

function buildOnsetShape(onsets: Onset[], start: number, end: number, bins: number): number[] {
  const raw = sumBins(
    onsets.map((onset) => ({ time: onset.time, value: onset.strength })),
    start,
    end,
    bins
  );
  const maximum = Math.max(0.001, ...raw);
  return raw.map((value) => roundTo(clamp(value / maximum, 0, 1), 3));
}

function averageBins(
  values: Array<{ time: number; value: number }>,
  start: number,
  end: number,
  bins: number
): number[] {
  const sums = Array.from({ length: bins }, () => 0);
  const counts = Array.from({ length: bins }, () => 0);
  const duration = Math.max(0.001, end - start);

  for (const item of values) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor(((item.time - start) / duration) * bins)));
    sums[index] = (sums[index] ?? 0) + item.value;
    counts[index] = (counts[index] ?? 0) + 1;
  }

  const fallback = average(values.map((item) => item.value));
  return sums.map((sum, index) => {
    const count = counts[index] ?? 0;
    return count > 0 ? sum / count : fallback;
  });
}

function sumBins(
  values: Array<{ time: number; value: number }>,
  start: number,
  end: number,
  bins: number
): number[] {
  const sums = Array.from({ length: bins }, () => 0);
  const duration = Math.max(0.001, end - start);

  for (const item of values) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor(((item.time - start) / duration) * bins)));
    sums[index] = (sums[index] ?? 0) + item.value;
  }

  return sums;
}

function valueRange(values: number[]): number {
  if (values.length === 0) {
    return 1;
  }

  return Math.max(0.001, Math.max(...values) - Math.min(...values));
}

function normalizedDifference(first: number, second: number, range: number): number {
  return clamp(Math.abs(first - second) / Math.max(0.001, range), 0, 1);
}

function quantile(values: number[], position: number): number {
  if (values.length === 0) {
    return VISUAL_SCORE_FLOOR;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.floor((sorted.length - 1) * position), 0, sorted.length - 1);
  return sorted[index] ?? VISUAL_SCORE_FLOOR;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}
