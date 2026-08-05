import type { BeatGrid, BeatMarker, EnvelopePoint } from "@beat-master/core";
import { useEffect, useMemo, useRef } from "react";

interface WaveformProps {
  duration: number;
  envelope: EnvelopePoint[];
  beatGrid?: BeatGrid;
  ranges?: WaveformRange[];
  markers: BeatMarker[];
  taps: number[];
  currentTime: number;
  viewStart: number;
  viewEnd: number;
  onSeek: (time: number) => void;
  onZoomAt: (time: number, direction: -1 | 1) => void;
}

export interface WaveformRange {
  id: string;
  label: string;
  start: number;
  end: number;
  active?: boolean;
  applied?: boolean;
}

const CANVAS_HEIGHT = 220;

export function Waveform({
  duration,
  envelope,
  beatGrid,
  ranges = [],
  markers,
  taps,
  currentTime,
  viewStart,
  viewEnd,
  onSeek,
  onZoomAt
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visibleMarkers = useMemo(
    () => markers.filter((marker) => marker.kind === "cut" || marker.kind === "section"),
    [markers]
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const pixelRatio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * pixelRatio);
    canvas.height = Math.floor(CANVAS_HEIGHT * pixelRatio);
    context.scale(pixelRatio, pixelRatio);
    drawWaveform(
      context,
      rect.width,
      CANVAS_HEIGHT,
      duration,
      envelope,
      beatGrid,
      ranges,
      visibleMarkers,
      taps,
      currentTime,
      viewStart,
      viewEnd
    );
  }, [beatGrid, duration, envelope, ranges, visibleMarkers, taps, currentTime, viewEnd, viewStart]);

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    onSeek(timeFromRatio(ratio, duration, viewStart, viewEnd));
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    if (duration <= 0) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const anchorTime = timeFromRatio(ratio, duration, viewStart, viewEnd);
    onZoomAt(anchorTime, event.deltaY > 0 ? -1 : 1);
  }

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      height={CANVAS_HEIGHT}
      onPointerDown={handlePointerDown}
      onWheel={handleWheel}
      role="img"
      aria-label="Audio waveform with beat markers and current playhead"
    />
  );
}

function drawWaveform(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  duration: number,
  envelope: EnvelopePoint[],
  beatGrid: BeatGrid | undefined,
  ranges: WaveformRange[],
  markers: BeatMarker[],
  taps: number[],
  currentTime: number,
  viewStart: number,
  viewEnd: number
) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#101318";
  context.fillRect(0, 0, width, height);

  const visibleStart = Math.max(0, Math.min(viewStart, duration));
  const visibleEnd = Math.max(visibleStart + 0.001, Math.min(viewEnd, duration || viewEnd));
  const visibleDuration = visibleEnd - visibleStart;
  const center = height / 2;
  const top = 20;
  const bottom = height - 28;
  const amplitude = (bottom - top) / 2;
  const xForTime = (time: number) => ((time - visibleStart) / visibleDuration) * width;

  drawRanges(context, width, top, bottom, ranges, visibleStart, visibleEnd, xForTime);

  context.strokeStyle = "rgba(238, 244, 246, 0.18)";
  context.lineWidth = 1;
  for (let line = 0; line <= 4; line += 1) {
    const y = top + ((bottom - top) * line) / 4;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  drawBeatGrid(context, width, top, bottom, beatGrid, visibleStart, visibleEnd, xForTime);

  if (envelope.length > 0 && duration > 0) {
    const visibleEnvelope = envelope.filter(
      (point) => point.time >= visibleStart && point.time <= visibleEnd
    );
    const pointsToDraw = visibleEnvelope.length > 1 ? visibleEnvelope : envelope;

    context.beginPath();
    pointsToDraw.forEach((point, index) => {
      const x = xForTime(point.time);
      const y = center - point.rms * amplitude;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    for (let index = pointsToDraw.length - 1; index >= 0; index -= 1) {
      const point = pointsToDraw[index];
      if (!point) {
        continue;
      }
      const x = xForTime(point.time);
      const y = center + point.rms * amplitude;
      context.lineTo(x, y);
    }
    context.closePath();
    const gradient = context.createLinearGradient(0, top, width, bottom);
    gradient.addColorStop(0, "#45d6a3");
    gradient.addColorStop(0.45, "#60b7ff");
    gradient.addColorStop(1, "#f2b84b");
    context.fillStyle = gradient;
    context.globalAlpha = 0.88;
    context.fill();
    context.globalAlpha = 1;
  } else {
    context.fillStyle = "rgba(238, 244, 246, 0.5)";
    context.font = "14px system-ui";
    context.fillText("Import an audio file to draw the waveform", 20, center);
  }

  drawMarkers(context, markers, visibleStart, visibleEnd, top, bottom, xForTime);

  for (const tap of taps) {
    if (tap < visibleStart || tap > visibleEnd) {
      continue;
    }

    const x = xForTime(tap);
    context.strokeStyle = "#f06c64";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
  }

  if (duration > 0 && currentTime >= visibleStart && currentTime <= visibleEnd) {
    const playheadX = xForTime(currentTime);
    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(playheadX, 8);
    context.lineTo(playheadX, height - 8);
    context.stroke();
  }

  drawWindowLabels(context, width, height, visibleStart, visibleEnd);
}

function drawMarkers(
  context: CanvasRenderingContext2D,
  markers: BeatMarker[],
  visibleStart: number,
  visibleEnd: number,
  top: number,
  bottom: number,
  xForTime: (time: number) => number
) {
  for (const marker of markers) {
    if (marker.time < visibleStart || marker.time > visibleEnd) {
      continue;
    }

    const isSection = marker.kind === "section";
    const x = xForTime(marker.time);
    context.strokeStyle = isSection ? "#ff2d38" : "#45d6a3";
    context.lineWidth = isSection ? 4 : 1.5;
    context.lineCap = isSection ? "round" : "butt";
    context.beginPath();
    context.moveTo(x, isSection ? top + 2 : top);
    context.lineTo(x, isSection ? bottom - 2 : bottom);
    context.stroke();
  }

  context.lineCap = "butt";
}

function drawRanges(
  context: CanvasRenderingContext2D,
  width: number,
  top: number,
  bottom: number,
  ranges: WaveformRange[],
  visibleStart: number,
  visibleEnd: number,
  xForTime: (time: number) => number
) {
  const visibleRanges = ranges.filter(
    (range) => range.end >= visibleStart && range.start <= visibleEnd
  );

  for (const [index, range] of visibleRanges.entries()) {
    const startX = Math.max(0, xForTime(Math.max(range.start, visibleStart)));
    const endX = Math.min(width, xForTime(Math.min(range.end, visibleEnd)));
    const rangeWidth = Math.max(1, endX - startX);

    context.fillStyle = range.active
      ? "rgba(96, 183, 255, 0.17)"
      : range.applied
        ? "rgba(69, 214, 163, 0.12)"
        : index % 2 === 0
          ? "rgba(238, 244, 246, 0.055)"
          : "rgba(238, 244, 246, 0.025)";
    context.fillRect(startX, top, rangeWidth, bottom - top);

    context.strokeStyle = range.active
      ? "rgba(96, 183, 255, 0.82)"
      : range.applied
        ? "rgba(69, 214, 163, 0.68)"
        : "rgba(242, 184, 75, 0.42)";
    context.lineWidth = range.active ? 2 : 1;
    context.beginPath();
    context.moveTo(startX, top);
    context.lineTo(startX, bottom);
    context.stroke();

    if (range.end <= visibleEnd) {
      context.beginPath();
      context.moveTo(endX, top);
      context.lineTo(endX, bottom);
      context.stroke();
    }

    if (rangeWidth > 58) {
      const label = range.applied ? `${range.label} ok` : range.label;
      context.fillStyle = range.active
        ? "rgba(238, 244, 246, 0.92)"
        : "rgba(238, 244, 246, 0.68)";
      context.font = "12px system-ui";
      const labelX = Math.min(Math.max(startX + 6, 8), width - 42);
      context.fillText(label, labelX, top + 15);
    }
  }
}

function drawBeatGrid(
  context: CanvasRenderingContext2D,
  width: number,
  top: number,
  bottom: number,
  beatGrid: BeatGrid | undefined,
  visibleStart: number,
  visibleEnd: number,
  xForTime: (time: number) => number
) {
  if (!beatGrid || beatGrid.beats.length === 0) {
    return;
  }

  const firstVisibleBeat = beatGrid.beats.findIndex((time) => time >= visibleStart);
  if (firstVisibleBeat === -1) {
    return;
  }

  const visibleDuration = visibleEnd - visibleStart;
  for (let index = firstVisibleBeat; index < beatGrid.beats.length; index += 1) {
    const beatTime = beatGrid.beats[index];
    if (beatTime === undefined || beatTime > visibleEnd) {
      break;
    }

    const isBar = index % 4 === 0;
    const x = xForTime(beatTime);
    context.strokeStyle = isBar ? "rgba(96, 183, 255, 0.52)" : "rgba(238, 244, 246, 0.16)";
    context.lineWidth = isBar ? 1.4 : 1;
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();

    if (isBar && visibleDuration <= 24 && x > 10 && x < width - 32) {
      context.fillStyle = "rgba(238, 244, 246, 0.72)";
      context.font = "12px system-ui";
      context.fillText(`Bar ${Math.floor(index / 4) + 1}`, x + 4, bottom + 18);
    }
  }
}

function drawWindowLabels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  visibleStart: number,
  visibleEnd: number
) {
  context.fillStyle = "rgba(238, 244, 246, 0.7)";
  context.font = "12px system-ui";
  context.fillText(formatShortTime(visibleStart), 10, height - 8);
  const endLabel = formatShortTime(visibleEnd);
  const metrics = context.measureText(endLabel);
  context.fillText(endLabel, Math.max(10, width - metrics.width - 10), height - 8);
}

function timeFromRatio(
  ratio: number,
  duration: number,
  viewStart: number,
  viewEnd: number
): number {
  const safeRatio = Math.max(0, Math.min(1, ratio));
  const visibleDuration = Math.max(0.001, viewEnd - viewStart);
  return Math.max(0, Math.min(duration, viewStart + safeRatio * visibleDuration));
}

function formatShortTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const decimal = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 10);

  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${decimal}`;
}
