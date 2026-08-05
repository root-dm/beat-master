export type MarkerKind = "cut" | "beat" | "bar" | "section";
export type MarkerSource = "manual" | "automated";

export interface EnvelopePoint {
  time: number;
  rms: number;
}

export interface Onset {
  time: number;
  strength: number;
}

export interface TempoCandidate {
  bpm: number;
  score: number;
}

export interface BeatGrid {
  bpm: number;
  beatDuration: number;
  offset: number;
  duration: number;
  beats: number[];
  confidence: number;
  source: MarkerSource;
}

export interface BeatMarker {
  id: string;
  time: number;
  label: string;
  kind: MarkerKind;
  source: MarkerSource;
  confidence: number;
  bar?: number;
  beat?: number;
  energy?: number;
}

export interface EditPattern {
  phraseBeats: number;
  phraseBars: number;
  phraseDuration: number;
  offset: number;
  motifOffsets: number[];
  applyStart: number;
  applyEnd: number;
  repeatCount: number;
  sectionCount: number;
  confidence: number;
  tapIntervals: number[];
}

export interface ManualLearningResult {
  mode: "manual";
  taps: number[];
  beatGrid: BeatGrid;
  pattern: EditPattern;
  markers: BeatMarker[];
  summary: string;
}

export interface AutomatedAnalysisResult {
  mode: "automated";
  envelope: EnvelopePoint[];
  onsets: Onset[];
  beatGrid: BeatGrid;
  markers: BeatMarker[];
  phraseBars: number;
  summary: string;
}

export interface AudioAnalysisOptions {
  frameSize?: number;
  hopSize?: number;
  minBpm?: number;
  maxBpm?: number;
  phraseBars?: number;
}

export interface MarkerGenerationOptions {
  phraseBars?: number;
  startAt?: number;
  includeBeatMarkers?: boolean;
  includeSectionMarkers?: boolean;
}

export interface ManualTapOptions {
  tempoHint?: BeatGrid;
  phraseBarsHint?: number;
  applyStart?: number;
  applyEnd?: number;
  minBpm?: number;
  maxBpm?: number;
}
