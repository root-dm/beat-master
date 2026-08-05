import type { BeatMarker } from "@beat-master/core";
import { secondsToClock } from "@beat-master/core";

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

const TRANSITION_WINDOW_SECONDS = 0.16;

const SCENES = [
  { name: "Neon street", className: "scene-neon" },
  { name: "Studio close-up", className: "scene-studio" },
  { name: "Night drive", className: "scene-drive" },
  { name: "Stage lights", className: "scene-stage" },
  { name: "Glass motion", className: "scene-glass" },
  { name: "City roof", className: "scene-roof" }
];

export function VideoPreview({
  currentTime,
  duration,
  markers,
  onSeek
}: VideoPreviewProps) {
  const cuts = buildPreviewCuts(markers, duration);
  const activeIndex = findActiveCutIndex(cuts, currentTime);
  const activeCut = cuts[activeIndex] ?? { time: 0, label: "Clip 1" };
  const nextCut = cuts[activeIndex + 1];
  const scene = getScene(activeIndex);
  const nextScene = getScene(activeIndex + 1);
  const distanceToCut = Math.min(
    Math.abs(currentTime - activeCut.time),
    nextCut ? Math.abs(nextCut.time - currentTime) : Number.POSITIVE_INFINITY
  );
  const isTransitioning = distanceToCut <= TRANSITION_WINDOW_SECONDS;
  const clipDuration = Math.max(0.001, (nextCut?.time ?? duration) - activeCut.time);
  const clipProgress = Math.min(1, Math.max(0, (currentTime - activeCut.time) / clipDuration));

  return (
    <section className="video-preview" aria-label="Fake video preview">
      <div className={`preview-monitor ${scene.className}${isTransitioning ? " transitioning" : ""}`}>
        <div className={`preview-next ${nextScene.className}`} aria-hidden="true" />
        <div className="preview-scanlines" aria-hidden="true" />
        <div className="preview-subject" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="preview-overlay">
          <strong>{scene.name}</strong>
          <span>{activeCut.label}</span>
        </div>
        <div className="preview-timecode">{secondsToClock(currentTime)}</div>
      </div>

      <div className="preview-filmstrip" aria-label="Preview clip changes">
        {cuts.slice(0, 18).map((cut, index) => {
          const itemScene = getScene(index);
          return (
            <button
              type="button"
              key={`${cut.label}-${cut.time}`}
              className={index === activeIndex ? "filmstrip-item active" : "filmstrip-item"}
              onClick={() => onSeek(cut.time)}
              aria-label={`Seek to ${cut.label} at ${secondsToClock(cut.time)}`}
            >
              <span className={`filmstrip-thumb ${itemScene.className}`} />
              <span>{index + 1}</span>
            </button>
          );
        })}
      </div>

      <div className="preview-progress" aria-label="Current preview clip progress">
        <span style={{ width: `${clipProgress * 100}%` }} />
      </div>
    </section>
  );
}

function getScene(index: number) {
  return SCENES[index % SCENES.length] ?? SCENES[0]!;
}

function buildPreviewCuts(markers: BeatMarker[], duration: number): PreviewCut[] {
  const cutMarkers = markers
    .filter((marker) => marker.kind === "cut")
    .map((marker) => ({
      time: marker.time,
      label: marker.label
    }))
    .sort((a, b) => a.time - b.time);

  if (cutMarkers.length > 0) {
    const hasZeroCut = cutMarkers.some((marker) => marker.time <= 0.05);
    return hasZeroCut ? cutMarkers : [{ time: 0, label: "Clip 1" }, ...cutMarkers];
  }

  return [{ time: 0, label: "Clip 1" }];
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
