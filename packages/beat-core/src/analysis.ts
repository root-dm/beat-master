import { generateMarkersFromGrid, createBeatGrid } from "./markers";
import { clamp, mean, median, movingAverage, quantile, roundTo, stdev } from "./statistics";
import type {
  AudioAnalysisOptions,
  AutomatedAnalysisResult,
  BeatGrid,
  EnvelopePoint,
  Onset,
  TempoCandidate
} from "./types";

const DEFAULT_FRAME_SIZE = 2048;
const DEFAULT_HOP_SIZE = 1024;

export function analyzeAudioSamples(
  samples: Float32Array,
  sampleRate: number,
  duration: number,
  options: AudioAnalysisOptions = {}
): AutomatedAnalysisResult {
  const envelope = buildAmplitudeEnvelope(samples, sampleRate, options);
  const onsets = detectOnsets(envelope);
  const beatGrid = estimateBeatGrid(onsets, duration, {
    minBpm: options.minBpm,
    maxBpm: options.maxBpm
  });
  const phraseBars = options.phraseBars ?? 4;
  const markers = generateMarkersFromGrid(
    beatGrid,
    {
      phraseBars,
      includeSectionMarkers: true
    },
    envelope
  );

  return {
    mode: "automated",
    envelope,
    onsets,
    beatGrid,
    markers,
    phraseBars,
    summary: `Automated grid: ${beatGrid.bpm} BPM, ${phraseBars}-bar cuts, ${markers.length} markers.`
  };
}

export function buildAmplitudeEnvelope(
  samples: Float32Array,
  sampleRate: number,
  options: AudioAnalysisOptions = {}
): EnvelopePoint[] {
  const frameSize = options.frameSize ?? DEFAULT_FRAME_SIZE;
  const hopSize = options.hopSize ?? DEFAULT_HOP_SIZE;
  const raw: EnvelopePoint[] = [];
  let maxRms = 0;

  for (let start = 0; start < samples.length; start += hopSize) {
    let sumSquares = 0;
    const end = Math.min(samples.length, start + frameSize);
    for (let index = start; index < end; index += 1) {
      const sample = samples[index] ?? 0;
      sumSquares += sample * sample;
    }

    const frameLength = Math.max(1, end - start);
    const rms = Math.sqrt(sumSquares / frameLength);
    maxRms = Math.max(maxRms, rms);
    raw.push({
      time: (start + frameLength / 2) / sampleRate,
      rms
    });
  }

  if (maxRms <= 0) {
    return raw.map((point) => ({ ...point, rms: 0 }));
  }

  const normalized = raw.map((point) => ({
    ...point,
    rms: point.rms / maxRms
  }));
  const smoothed = movingAverage(
    normalized.map((point) => point.rms),
    2
  );

  return normalized.map((point, index) => ({
    time: roundTo(point.time, 3),
    rms: roundTo(smoothed[index] ?? point.rms, 4)
  }));
}

export function detectOnsets(envelope: EnvelopePoint[]): Onset[] {
  if (envelope.length < 4) {
    return [];
  }

  const values = envelope.map((point) => point.rms);
  const baseline = movingAverage(values, 6);
  const flux = values.map((value, index) =>
    Math.max(0, value - (baseline[index - 1] ?? baseline[index] ?? 0))
  );
  const threshold = quantile(flux, 0.78) + stdev(flux) * 0.25;
  const minSpacingSeconds = 0.12;
  const onsets: Onset[] = [];

  for (let index = 1; index < flux.length - 1; index += 1) {
    const current = flux[index] ?? 0;
    const previous = flux[index - 1] ?? 0;
    const next = flux[index + 1] ?? 0;
    const time = envelope[index]?.time ?? 0;
    const last = onsets[onsets.length - 1];

    if (current >= threshold && current >= previous && current > next) {
      if (!last || time - last.time >= minSpacingSeconds) {
        onsets.push({
          time,
          strength: roundTo(current, 4)
        });
      } else if (current > last.strength) {
        last.time = time;
        last.strength = roundTo(current, 4);
      }
    }
  }

  return onsets;
}

export function estimateBeatGrid(
  onsets: Onset[],
  duration: number,
  options: Pick<AudioAnalysisOptions, "minBpm" | "maxBpm"> = {}
): BeatGrid {
  const minBpm = options.minBpm ?? 70;
  const maxBpm = options.maxBpm ?? 180;

  if (onsets.length < 2) {
    return createBeatGrid(120, duration, 0, 0.2, "automated");
  }

  const candidates = estimateTempoCandidates(onsets, minBpm, maxBpm);
  const best = candidates[0] ?? { bpm: 120, score: 0.2 };
  const offset = estimateOffset(onsets, 60 / best.bpm);
  const confidence = clamp(best.score, 0.2, 0.98);

  return createBeatGrid(best.bpm, duration, offset, confidence, "automated");
}

export function estimateTempoCandidates(
  onsets: Onset[],
  minBpm = 70,
  maxBpm = 180
): TempoCandidate[] {
  const bins = new Map<number, number>();
  const maxLookahead = 8;

  for (let index = 0; index < onsets.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < Math.min(onsets.length, index + maxLookahead); nextIndex += 1) {
      const current = onsets[index];
      const next = onsets[nextIndex];
      if (!current || !next) {
        continue;
      }

      const interval = next.time - current.time;
      if (interval < 0.25 || interval > 2.4) {
        continue;
      }

      const bpm = normalizeBpm(60 / interval, minBpm, maxBpm);
      const bin = Math.round(bpm);
      const weight =
        (current.strength + next.strength) *
        (1 / Math.max(1, nextIndex - index)) *
        pulsePreference(bpm);
      bins.set(bin, (bins.get(bin) ?? 0) + weight);
    }
  }

  const totalScore = Array.from(bins.values()).reduce((total, score) => total + score, 0);
  const candidates = Array.from(bins.entries())
    .map(([bpm, score]) => ({
      bpm,
      score: totalScore > 0 ? score / totalScore : 0
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const dominant = candidates[0]?.score ?? 0;
  return candidates.map((candidate) => ({
    bpm: candidate.bpm,
    score: roundTo(clamp(candidate.score / Math.max(dominant, 0.001), 0, 1), 3)
  }));
}

function estimateOffset(onsets: Onset[], beatDuration: number): number {
  const phaseCount = 32;
  const bins = Array.from({ length: phaseCount }, () => 0);

  for (const onset of onsets) {
    const phase = ((onset.time % beatDuration) + beatDuration) % beatDuration;
    const index = Math.min(phaseCount - 1, Math.floor((phase / beatDuration) * phaseCount));
    bins[index] = (bins[index] ?? 0) + onset.strength;
  }

  const bestScore = Math.max(...bins);
  const bestIndex = bins.findIndex((score) => score === bestScore);
  const nearbyPhases = onsets
    .map((onset) => {
      const phase = ((onset.time % beatDuration) + beatDuration) % beatDuration;
      const bin = Math.min(phaseCount - 1, Math.floor((phase / beatDuration) * phaseCount));
      return bin === bestIndex ? phase : null;
    })
    .filter((phase): phase is number => phase !== null);

  return roundTo(nearbyPhases.length > 0 ? median(nearbyPhases) : 0, 3);
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

function pulsePreference(bpm: number): number {
  const clubCenter = 124;
  const popCenter = 96;
  const club = 1 - clamp(Math.abs(bpm - clubCenter) / 90, 0, 0.35);
  const pop = 1 - clamp(Math.abs(bpm - popCenter) / 90, 0, 0.25);
  return Math.max(0.75, mean([club, pop]));
}

