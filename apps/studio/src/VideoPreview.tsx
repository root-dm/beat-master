import type { BeatMarker } from "@beat-master/core";
import { secondsToClock } from "@beat-master/core";
import type { CSSProperties } from "react";

interface VideoPreviewProps {
  currentTime: number;
  duration: number;
  markers: BeatMarker[];
  onSeek: (time: number) => void;
}

interface PreviewCut {
  time: number;
  label: string;
}

const CLIP_COLORS = [
  "#45d6a3",
  "#60b7ff",
  "#f2b84b",
  "#ff7a70",
  "#9bd37a",
  "#c58cff"
];

export function VideoPreview({
  currentTime,
  duration,
  markers,
  onSeek
}: VideoPreviewProps) {
  const cuts = buildPreviewCuts(markers);
  const activeIndex = findActiveCutIndex(cuts, currentTime);
  const activeCut = cuts[activeIndex] ?? { time: 0, label: "Clip 1" };
  const nextCut = cuts[activeIndex + 1];
  const activeEnd = nextCut?.time ?? duration;
  const accent = CLIP_COLORS[activeIndex % CLIP_COLORS.length] ?? CLIP_COLORS[0];
  const segments = buildTimelineSegments(cuts, duration);

  return (
    <section className="video-preview" aria-label="Fake video preview">
      <div className="preview-monitor" style={{ "--preview-accent": accent } as CSSProperties}>
        <div className="preview-card">
          <span>Clip {activeIndex + 1}</span>
          <strong>{activeCut.label}</strong>
          <em>{secondsToClock(activeCut.time)}-{secondsToClock(activeEnd)}</em>
        </div>
        <div className="preview-timecode">{secondsToClock(currentTime)}</div>
      </div>

      <div className="preview-timeline" aria-label="Preview clip changes">
        {segments.map((segment, index) => (
          <button
            type="button"
            key={`${segment.time}-${index}`}
            className={index === activeIndex ? "preview-segment active" : "preview-segment"}
            style={{
              flexGrow: segment.weight,
              "--segment-color": CLIP_COLORS[index % CLIP_COLORS.length] ?? CLIP_COLORS[0]
            } as CSSProperties}
            onClick={() => onSeek(segment.time)}
            aria-label={`Seek to ${segment.label} at ${secondsToClock(segment.time)}`}
          >
            <span>{index + 1}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function buildPreviewCuts(markers: BeatMarker[]): PreviewCut[] {
  const cutMarkers = markers
    .filter((marker) => marker.kind === "cut")
    .map((marker) => ({
      time: marker.time,
      label: marker.label
    }))
    .sort((a, b) => a.time - b.time);

  if (cutMarkers.length === 0) {
    return [{ time: 0, label: "Clip 1" }];
  }

  const hasZeroCut = cutMarkers.some((marker) => marker.time <= 0.05);
  return hasZeroCut ? cutMarkers : [{ time: 0, label: "Clip 1" }, ...cutMarkers];
}

function buildTimelineSegments(cuts: PreviewCut[], duration: number) {
  return cuts.slice(0, 40).map((cut, index) => {
    const next = cuts[index + 1];
    const segmentDuration = Math.max(0.6, (next?.time ?? duration) - cut.time);

    return {
      ...cut,
      weight: Math.max(1, Math.min(8, segmentDuration))
    };
  });
}

function findActiveCutIndex(cuts: PreviewCut[], currentTime: number): number {
  let activeIndex = 0;
  for (let index = 0; index < cuts.length; index += 1) {
    const cut = cuts[index];
    if (cut && cut.time <= currentTime) {
      activeIndex = index;
    }
  }

  return activeIndex;
}
