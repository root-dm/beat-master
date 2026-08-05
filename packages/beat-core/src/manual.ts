import { createBeatGrid } from "./markers";
import { clamp, median, nearestFrom, roundTo, uniqueSortedTimes } from "./statistics";
import type { BeatGrid, BeatMarker, ManualLearningResult, ManualTapOptions } from "./types";

const COMMON_PHRASE_BARS = [1, 2, 4, 8, 16];

export function learnManualPattern(
  taps: number[],
  duration: number,
  options: ManualTapOptions = {}
): ManualLearningResult {
  const applyStart = clamp(options.applyStart ?? 0, 0, duration);
  const applyEnd = clamp(options.applyEnd ?? duration, applyStart, duration);
  const sortedTaps = uniqueSortedTimes(taps).filter((time) => time <= duration);
  const intervals = sortedTaps
    .slice(1)
    .map((time, index) => time - (sortedTaps[index] ?? 0))
    .filter((interval) => interval > 0.2);

  const tempoGrid = options.tempoHint ?? inferGridFromTapIntervals(intervals, duration, options);
  if (sortedTaps.length === 0) {
    const phraseBars = options.phraseBarsHint ?? 4;
    const phraseBeats = Math.max(1, Math.round(phraseBars * 4));
    const phraseDuration = phraseBeats * tempoGrid.beatDuration;

    return {
      mode: "manual",
      taps: [],
      beatGrid: {
        ...tempoGrid,
        source: "manual",
        confidence: 0
      },
      pattern: {
        phraseBeats,
        phraseBars,
        phraseDuration,
        offset: 0,
        motifOffsets: [],
        applyStart,
        applyEnd,
        repeatCount: 0,
        sectionCount: 0,
        confidence: 0,
        tapIntervals: []
      },
      markers: [],
      summary: "Tap a few edit changes to teach the pattern."
    };
  }

  const medianInterval = median(intervals);
  const phraseBeatsFromTaps =
    medianInterval > 0 ? medianInterval / tempoGrid.beatDuration : (options.phraseBarsHint ?? 4) * 4;
  const phraseBars =
    options.phraseBarsHint ??
    nearestFrom(Math.max(1, phraseBeatsFromTaps / 4), COMMON_PHRASE_BARS);
  const phraseBeats = Math.max(1, Math.round(phraseBars * 4));
  const phraseDuration = phraseBeats * tempoGrid.beatDuration;
  const meterSubdivision = tempoGrid.beatDuration;
  const snappedTaps = uniqueSortedTimes(
    sortedTaps.map((tap) => snapTimeToMeter(tap, tempoGrid, meterSubdivision))
  );
  const firstAppliedTap = snappedTaps[0] ?? sortedTaps[0] ?? tempoGrid.offset;
  const offset = normalizeOffset(firstAppliedTap, phraseDuration);
  const motifOffsets = buildMotifOffsets(
    snappedTaps,
    phraseDuration,
    offset,
    tempoGrid.beatDuration
  );
  const confidence = combinedManualConfidence(sortedTaps.length, intervals, tempoGrid.confidence);
  const repeatCount = Math.max(0, Math.floor((applyEnd - applyStart) / phraseDuration) + 1);
  const markers = generateMarkersFromMotif({
    duration,
    applyStart,
    applyEnd,
    offset,
    phraseBars,
    phraseDuration,
    motifOffsets,
    beatDuration: tempoGrid.beatDuration,
    confidence
  });
  const sectionCount = Math.max(1, Math.ceil(repeatCount / 4));

  return {
    mode: "manual",
    taps: sortedTaps,
    beatGrid: {
      ...tempoGrid,
      source: "manual",
      offset,
      confidence
    },
    pattern: {
      phraseBeats,
      phraseBars,
      phraseDuration,
      offset: roundTo(offset, 3),
      motifOffsets,
      applyStart: roundTo(applyStart, 3),
      applyEnd: roundTo(applyEnd, 3),
      repeatCount,
      sectionCount,
      confidence,
      tapIntervals: intervals.map((interval) => roundTo(interval, 3))
    },
    markers,
    summary: `Manual pattern: ${phraseBars} bars, ${motifOffsets.length} cuts per loop, ${markers.length} quantized markers, ${Math.round(confidence * 100)}% confidence.`
  };
}

interface MotifMarkerOptions {
  duration: number;
  applyStart: number;
  applyEnd: number;
  offset: number;
  phraseBars: number;
  phraseDuration: number;
  motifOffsets: number[];
  beatDuration: number;
  confidence: number;
}

function generateMarkersFromMotif(options: MotifMarkerOptions): BeatMarker[] {
  const maxMotifOffset = Math.max(0, ...options.motifOffsets);
  const phraseStarts: number[] = [];
  let phraseStart = options.offset;

  while (phraseStart - options.phraseDuration + maxMotifOffset >= 0) {
    phraseStart -= options.phraseDuration;
  }

  while (phraseStart <= options.duration + 0.001) {
    phraseStarts.push(phraseStart);
    phraseStart += options.phraseDuration;
  }

  const markerTimes = uniqueSortedTimes(
    phraseStarts.flatMap((start) =>
      options.motifOffsets.map((motifOffset) => start + motifOffset)
    )
  ).filter(
    (time) =>
      time >= options.applyStart - 0.001 &&
      time <= options.applyEnd + 0.001 &&
      time >= 0 &&
      time <= options.duration + 0.001
  );

  return markerTimes.map((time, index) => {
    const absoluteBeat = Math.max(0, Math.round(time / options.beatDuration));
    return {
      id: `manual-${index + 1}-${Math.round(time * 1000)}`,
      time: roundTo(time, 3),
      label: `Cut ${index + 1}`,
      kind: "cut",
      source: "manual",
      confidence: options.confidence,
      bar: Math.floor(absoluteBeat / 4) + 1,
      beat: (absoluteBeat % 4) + 1
    };
  });
}

function buildMotifOffsets(
  taps: number[],
  phraseDuration: number,
  offset: number,
  beatDuration: number
): number[] {
  if (taps.length === 0) {
    return [];
  }

  const subdivisionDuration = beatDuration;
  const snapTolerance = subdivisionDuration * 0.55;
  const clusterTolerance = Math.max(0.12, beatDuration * 0.45);
  const offsets = taps.map((tap) => {
    const rawOffset = positiveModulo(tap - offset, phraseDuration);
    const snappedOffset = snapOffsetToGrid(rawOffset, subdivisionDuration, phraseDuration);
    return Math.abs(snappedOffset - rawOffset) <= snapTolerance ? snappedOffset : rawOffset;
  });

  return clusterCircularOffsets(offsets, phraseDuration, clusterTolerance)
    .map((motifOffset) => roundTo(motifOffset, 3))
    .sort((a, b) => a - b);
}

function clusterCircularOffsets(
  offsets: number[],
  phraseDuration: number,
  tolerance: number
): number[] {
  const sortedOffsets = offsets
    .map((motifOffset) => positiveModulo(motifOffset, phraseDuration))
    .sort((a, b) => a - b);
  const clusters: number[][] = [];

  for (const motifOffset of sortedOffsets) {
    const currentCluster = clusters[clusters.length - 1];
    if (
      !currentCluster ||
      circularDistance(motifOffset, averageOffset(currentCluster, phraseDuration), phraseDuration) >
        tolerance
    ) {
      clusters.push([motifOffset]);
    } else {
      currentCluster.push(motifOffset);
    }
  }

  if (clusters.length > 1) {
    const firstCluster = clusters[0];
    const lastCluster = clusters[clusters.length - 1];
    const firstCenter = firstCluster ? averageOffset(firstCluster, phraseDuration) : 0;
    const lastCenter = lastCluster ? averageOffset(lastCluster, phraseDuration) : 0;

    if (circularDistance(firstCenter, lastCenter, phraseDuration) <= tolerance) {
      clusters[0] = [...(lastCluster ?? []), ...(firstCluster ?? [])];
      clusters.pop();
    }
  }

  return clusters.map((cluster) => averageOffset(cluster, phraseDuration));
}

function averageOffset(offsets: number[], phraseDuration: number): number {
  if (offsets.length === 0) {
    return 0;
  }

  const firstOffset = offsets[0] ?? 0;
  const unwrapped = offsets.map((offset) => {
    let adjusted = offset;
    while (adjusted - firstOffset > phraseDuration / 2) {
      adjusted -= phraseDuration;
    }
    while (firstOffset - adjusted > phraseDuration / 2) {
      adjusted += phraseDuration;
    }
    return adjusted;
  });
  const average = unwrapped.reduce((total, value) => total + value, 0) / unwrapped.length;

  return positiveModulo(average, phraseDuration);
}

function circularDistance(a: number, b: number, phraseDuration: number): number {
  const direct = Math.abs(a - b);
  return Math.min(direct, phraseDuration - direct);
}

function snapOffsetToGrid(
  offset: number,
  subdivisionDuration: number,
  phraseDuration: number
): number {
  const snapped = Math.round(offset / subdivisionDuration) * subdivisionDuration;
  if (Math.abs(snapped - phraseDuration) < subdivisionDuration * 0.25) {
    return 0;
  }

  return roundTo(clamp(snapped, 0, phraseDuration), 3);
}

function snapTimeToMeter(
  time: number,
  grid: BeatGrid,
  subdivisionDuration: number
): number {
  if (subdivisionDuration <= 0) {
    return roundTo(time, 3);
  }

  const steps = Math.round((time - grid.offset) / subdivisionDuration);
  const snapped = grid.offset + steps * subdivisionDuration;
  return roundTo(clamp(snapped, 0, grid.duration), 3);
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

function inferGridFromTapIntervals(
  intervals: number[],
  duration: number,
  options: ManualTapOptions
): BeatGrid {
  const minBpm = options.minBpm ?? 70;
  const maxBpm = options.maxBpm ?? 180;
  const phraseBarsHint = options.phraseBarsHint;
  const medianInterval = median(intervals);

  if (medianInterval <= 0) {
    return createBeatGrid(120, duration, 0, 0.25, "manual");
  }

  const phraseChoices = phraseBarsHint ? [phraseBarsHint] : COMMON_PHRASE_BARS;
  const candidates = phraseChoices
    .map((bars) => {
      const bpm = (60 * bars * 4) / medianInterval;
      const normalizedBpm = normalizeBpm(bpm, minBpm, maxBpm);
      const distanceFromCenter = Math.abs(normalizedBpm - 120) / 120;
      return {
        bars,
        bpm: normalizedBpm,
        score: 1 - clamp(distanceFromCenter, 0, 1)
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = candidates[0] ?? { bpm: 120, score: 0.3 };
  return createBeatGrid(best.bpm, duration, 0, best.score * 0.65, "manual");
}

function normalizeBpm(bpm: number, minBpm: number, maxBpm: number): number {
  let normalized = bpm;
  while (normalized < minBpm) {
    normalized *= 2;
  }
  while (normalized > maxBpm) {
    normalized /= 2;
  }
  return clamp(normalized, minBpm, maxBpm);
}

function normalizeOffset(time: number, phraseDuration: number): number {
  if (phraseDuration <= 0) {
    return 0;
  }

  let offset = time % phraseDuration;
  while (offset < 0) {
    offset += phraseDuration;
  }

  return roundTo(offset, 3);
}

function combinedManualConfidence(
  tapCount: number,
  intervals: number[],
  gridConfidence: number
): number {
  if (tapCount === 0) {
    return 0;
  }

  const tapScore = clamp(tapCount / 4, 0.25, 1);
  const medianInterval = median(intervals);
  const jitter =
    medianInterval > 0
      ? median(intervals.map((interval) => Math.abs(interval - medianInterval))) / medianInterval
      : 0.4;
  const consistencyScore = clamp(1 - jitter * 3, 0.1, 1);

  return roundTo(clamp((tapScore * 0.45 + consistencyScore * 0.35 + gridConfidence * 0.2), 0, 1), 3);
}
