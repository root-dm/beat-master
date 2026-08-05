import {
  analyzeTrack,
  type DecodedTrack,
  decodeTrack
} from "./audio";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Crosshair,
  Download,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  Zap,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  clamp,
  exportMarkersAsCsv,
  exportMarkersAsJson,
  generateMarkersFromGrid,
  learnManualPattern,
  secondsToClock,
  type AutomatedAnalysisResult,
  type BeatMarker,
  type ManualLearningResult
} from "@beat-master/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildSongSections,
  sectionBoundaryMarkers,
  sectionContainingTime,
  type SongSection
} from "./sections";
import { VideoPreview } from "./VideoPreview";
import { Waveform, type WaveformRange } from "./Waveform";

type Mode = "automated" | "manual";
type BusyState = "idle" | "decoding" | "analyzing";

const PHRASE_CHOICES = [2, 4, 8, 16];
const FPS_CHOICES = [24, 25, 30, 50, 60];
const MIN_ZOOM = 1;
const MAX_ZOOM = 32;
const SCRUB_AUDITION_MS = 110;
const EMPTY_TIMES: number[] = [];

export default function App() {
  const [track, setTrack] = useState<DecodedTrack | null>(null);
  const [analysis, setAnalysis] = useState<AutomatedAnalysisResult | null>(null);
  const [manual, setManual] = useState<ManualLearningResult | null>(null);
  const [appliedManual, setAppliedManual] = useState<ManualLearningResult | null>(null);
  const [sectionTaps, setSectionTaps] = useState<Record<string, number[]>>({});
  const [appliedSections, setAppliedSections] = useState<Record<string, ManualLearningResult>>({});
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("automated");
  const [phraseBars, setPhraseBars] = useState(4);
  const [manualPhraseBars, setManualPhraseBars] = useState(4);
  const [taps, setTaps] = useState<number[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineFps, setTimelineFps] = useState(30);
  const [scrubAudition, setScrubAudition] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [viewStart, setViewStart] = useState(0);
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const auditionTimeoutRef = useRef<number | null>(null);

  const duration = track?.buffer.duration ?? 0;
  const frameDuration = 1 / timelineFps;
  const visibleDuration = duration > 0 ? duration / zoomLevel : 1;
  const maxViewStart = Math.max(0, duration - visibleDuration);
  const visibleStart = clamp(viewStart, 0, maxViewStart);
  const visibleEnd = duration > 0 ? Math.min(duration, visibleStart + visibleDuration) : 1;
  const songSections = useMemo(() => buildSongSections(analysis, duration), [analysis, duration]);
  const selectedSection =
    songSections.find((section) => section.id === selectedSectionId) ?? songSections[0] ?? null;
  const selectedSectionTaps = selectedSection ? sectionTaps[selectedSection.id] ?? EMPTY_TIMES : taps;
  const allManualTaps = useMemo(
    () => [...taps, ...Object.values(sectionTaps).flat()].sort((a, b) => a - b),
    [sectionTaps, taps]
  );
  const appliedSectionMarkers = useMemo(
    () => mergeAppliedSectionMarkers(appliedSections, songSections),
    [appliedSections, songSections]
  );
  const markers = useMemo<BeatMarker[]>(() => {
    if (mode === "manual") {
      return appliedSectionMarkers.length > 0 ? appliedSectionMarkers : appliedManual?.markers ?? [];
    }
    return analysis?.markers ?? [];
  }, [analysis?.markers, appliedManual?.markers, appliedSectionMarkers, mode]);
  const waveformMarkers = useMemo(
    () =>
      mode === "manual"
        ? [...sectionBoundaryMarkers(songSections), ...markers].sort((a, b) => a.time - b.time)
        : markers,
    [markers, mode, songSections]
  );
  const waveformRanges = useMemo<WaveformRange[]>(
    () =>
      mode === "manual"
        ? songSections.map((section) => ({
            id: section.id,
            label: section.label,
            start: section.start,
            end: section.end,
            active: section.id === selectedSection?.id,
            applied: Boolean(appliedSections[section.id])
          }))
        : [],
    [appliedSections, mode, selectedSection?.id, songSections]
  );

  const appliedSectionCount = Object.keys(appliedSections).length;
  const manualSummary =
    selectedSection
      ? buildSectionManualSummary({
          selectedSection,
          manual,
          selectedTapCount: selectedSectionTaps.length,
          appliedResult: appliedSections[selectedSection.id] ?? null,
          appliedSectionCount,
          sectionCount: songSections.length
        })
      : appliedManual
        ? `${appliedManual.summary} Applied to the full beat.`
        : buildManualDraftSummary(manual, taps.length);
  const activeGrid = mode === "manual" ? analysis?.beatGrid ?? (appliedManual ?? manual)?.beatGrid : analysis?.beatGrid;
  const activeSummary = mode === "manual" ? manualSummary : analysis?.summary;
  const phraseLabel =
    mode === "manual"
      ? `${(appliedManual ?? manual)?.pattern.phraseBars ?? manualPhraseBars} bars`
      : `${analysis?.phraseBars ?? phraseBars} bars`;

  useEffect(() => {
    if (!track) {
      return;
    }

    setBusy("analyzing");
    const timeout = window.setTimeout(() => {
      try {
        const nextAnalysis = analyzeTrack(track, phraseBars);
        setAnalysis(nextAnalysis);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not analyze this track.");
      } finally {
        setBusy("idle");
      }
    }, 20);

    return () => window.clearTimeout(timeout);
  }, [track, phraseBars]);

  useEffect(() => {
    if (!track) {
      setManual(null);
      return;
    }

    setManual(
      learnManualPattern(selectedSectionTaps, track.buffer.duration, {
        tempoHint: analysis?.beatGrid,
        phraseBarsHint: manualPhraseBars,
        applyStart: selectedSection?.start,
        applyEnd: selectedSection?.end
      })
    );
  }, [analysis?.beatGrid, manualPhraseBars, selectedSection?.end, selectedSection?.start, selectedSectionTaps, track]);

  useEffect(() => {
    if (songSections.length === 0) {
      setSelectedSectionId(null);
      return;
    }

    setSelectedSectionId((previous) =>
      songSections.some((section) => section.id === previous) ? previous : songSections[0]?.id ?? null
    );
  }, [songSections]);

  useEffect(() => {
    setViewStart((previous) => clamp(previous, 0, maxViewStart));
  }, [maxViewStart]);

  useEffect(() => {
    if (!isPlaying || zoomLevel <= 1 || duration <= 0) {
      return;
    }

    if (currentTime < visibleStart || currentTime > visibleEnd) {
      centerTimelineOn(currentTime, zoomLevel);
    }
  }, [currentTime, duration, isPlaying, visibleEnd, visibleStart, zoomLevel]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTextEntryTarget(event.target)) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        stepFrames(direction, event.shiftKey ? 10 : 1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentTime, duration, frameDuration, scrubAudition, visibleEnd, visibleStart, zoomLevel]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const update = () => {
      setCurrentTime(audio.currentTime);
      setIsPlaying(!audio.paused);
    };
    audio.addEventListener("timeupdate", update);
    audio.addEventListener("seeking", update);
    audio.addEventListener("pause", update);
    audio.addEventListener("play", update);

    return () => {
      audio.removeEventListener("timeupdate", update);
      audio.removeEventListener("seeking", update);
      audio.removeEventListener("pause", update);
      audio.removeEventListener("play", update);
    };
  }, [track?.url]);

  useEffect(() => {
    return () => clearAuditionTimer();
  }, []);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setBusy("decoding");
    setError(null);
    setTaps([]);
    setManual(null);
    setAppliedManual(null);
    setSectionTaps({});
    setAppliedSections({});
    setAnalysis(null);
    setIsPlaying(false);

    try {
      if (track?.url) {
        URL.revokeObjectURL(track.url);
      }
      const decoded = await decodeTrack(file);
      setTrack(decoded);
      setCurrentTime(0);
      setZoomLevel(1);
      setViewStart(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not decode this audio file.");
    } finally {
      setBusy("idle");
      event.target.value = "";
    }
  }

  function handleTap() {
    const audio = audioRef.current;
    const time = audio?.currentTime ?? currentTime;
    const targetSection = sectionContainingTime(songSections, time);

    if (targetSection) {
      setSelectedSectionId(targetSection.id);
      setAppliedSections((previous) => {
        const next = { ...previous };
        delete next[targetSection.id];
        return next;
      });
      setSectionTaps((previous) => ({
        ...previous,
        [targetSection.id]: [...(previous[targetSection.id] ?? []), time].sort((a, b) => a - b)
      }));
    } else {
      setAppliedManual(null);
      setTaps((previous) => [...previous, time].sort((a, b) => a - b));
    }

    setMode("manual");
  }

  function applyManualPattern() {
    if (selectedSection) {
      if (!manual || selectedSectionTaps.length === 0 || manual.markers.length === 0) {
        return;
      }

      setAppliedSections((previous) => ({
        ...previous,
        [selectedSection.id]: manual
      }));
      setMode("manual");
      return;
    }

    if (!manual || taps.length === 0 || manual.markers.length === 0) {
      return;
    }

    setAppliedManual(manual);
    setMode("manual");
  }

  function undoLastTap() {
    if (selectedSection) {
      setAppliedSections((previous) => {
        const next = { ...previous };
        delete next[selectedSection.id];
        return next;
      });
      setSectionTaps((previous) => ({
        ...previous,
        [selectedSection.id]: (previous[selectedSection.id] ?? []).slice(0, -1)
      }));
      return;
    }

    setAppliedManual(null);
    setTaps((previous) => previous.slice(0, -1));
  }

  function clearTaps() {
    if (selectedSection) {
      setAppliedSections((previous) => {
        const next = { ...previous };
        delete next[selectedSection.id];
        return next;
      });
      setSectionTaps((previous) => ({
        ...previous,
        [selectedSection.id]: []
      }));
      return;
    }

    setAppliedManual(null);
    setTaps([]);
  }

  function resetManualWork() {
    setAppliedManual(null);
    setTaps([]);
    setSectionTaps({});
    setAppliedSections({});
  }

  function changeManualPhraseBars(choice: number) {
    setAppliedManual(null);
    setAppliedSections({});
    setManualPhraseBars(choice);
  }

  function goToSection(section: SongSection) {
    setSelectedSectionId(section.id);
    handleSeek(section.start);
    changeZoom(Math.max(zoomLevel, 4), section.start);
  }

  function goToNextUntaughtSection() {
    if (songSections.length === 0) {
      return;
    }

    const currentIndex = Math.max(
      0,
      songSections.findIndex((section) => section.id === selectedSection?.id)
    );
    const nextUntaught =
      songSections
        .slice(currentIndex + 1)
        .find((section) => !appliedSections[section.id]) ??
      songSections.find((section) => !appliedSections[section.id]) ??
      songSections[(currentIndex + 1) % songSections.length];

    if (nextUntaught) {
      goToSection(nextUntaught);
    }
  }

  function handleSeek(time: number) {
    clearAuditionTimer();
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setCurrentTime(time);
  }

  function centerTimelineOn(time: number, nextZoom = zoomLevel) {
    if (duration <= 0) {
      return;
    }

    const nextVisibleDuration = duration / nextZoom;
    const nextMaxStart = Math.max(0, duration - nextVisibleDuration);
    setViewStart(clamp(time - nextVisibleDuration / 2, 0, nextMaxStart));
  }

  function changeZoom(nextZoom: number, anchorTime = currentTime) {
    if (duration <= 0) {
      return;
    }

    const safeZoom = clamp(Math.round(nextZoom), MIN_ZOOM, MAX_ZOOM);
    setZoomLevel(safeZoom);
    const nextVisibleDuration = duration / safeZoom;
    const nextMaxStart = Math.max(0, duration - nextVisibleDuration);
    setViewStart(clamp(anchorTime - nextVisibleDuration / 2, 0, nextMaxStart));
  }

  function panTimeline(direction: -1 | 1) {
    if (duration <= 0 || zoomLevel <= 1) {
      return;
    }

    setViewStart((previous) =>
      clamp(previous + direction * visibleDuration * 0.5, 0, maxViewStart)
    );
  }

  function focusCurrentBeat() {
    if (!activeGrid || duration <= 0) {
      centerTimelineOn(currentTime);
      return;
    }

    const nearestBeat = activeGrid.beats.reduce((closest, beat) =>
      Math.abs(beat - currentTime) < Math.abs(closest - currentTime) ? beat : closest
    , activeGrid.beats[0] ?? currentTime);

    handleSeek(nearestBeat);
    changeZoom(Math.max(zoomLevel, 16), nearestBeat);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    clearAuditionTimer();
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }

  function stepFrames(direction: -1 | 1, frameCount = 1) {
    if (duration <= 0) {
      return;
    }

    const nextTime = clamp(currentTime + direction * frameCount * frameDuration, 0, duration);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = nextTime;
    }
    setCurrentTime(nextTime);
    setIsPlaying(false);

    if (nextTime < visibleStart || nextTime > visibleEnd) {
      centerTimelineOn(nextTime);
    }

    if (scrubAudition) {
      auditionFrame(nextTime);
    }
  }

  function auditionFrame(time: number) {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    clearAuditionTimer();
    audio.pause();
    audio.currentTime = time;

    void audio.play().then(() => {
      auditionTimeoutRef.current = window.setTimeout(() => {
        audio.pause();
        audio.currentTime = time;
        setCurrentTime(time);
        setIsPlaying(false);
        auditionTimeoutRef.current = null;
      }, SCRUB_AUDITION_MS);
    }).catch(() => {
      setIsPlaying(false);
    });
  }

  function clearAuditionTimer() {
    if (auditionTimeoutRef.current !== null) {
      window.clearTimeout(auditionTimeoutRef.current);
      auditionTimeoutRef.current = null;
    }
  }

  function download(format: "json" | "csv") {
    if (markers.length === 0) {
      return;
    }

    const body = format === "json" ? exportMarkersAsJson(markers) : exportMarkersAsCsv(markers);
    const blob = new Blob([body], {
      type: format === "json" ? "application/json" : "text/csv"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const baseName = track?.file.name.replace(/\.[^.]+$/, "") || "beat-master-markers";
    anchor.href = url;
    anchor.download = `${baseName}-markers.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function refreshAutomatedMarkers(nextPhraseBars: number) {
    setPhraseBars(nextPhraseBars);
    if (!analysis) {
      return;
    }

    setAnalysis({
      ...analysis,
      phraseBars: nextPhraseBars,
      markers: generateMarkersFromGrid(
        analysis.beatGrid,
        {
          phraseBars: nextPhraseBars,
          includeSectionMarkers: true
        },
        analysis.envelope
      )
    });
  }

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="Beat Master controls">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            BM
          </div>
          <div>
            <h1>Beat Master Studio</h1>
            <p>Standalone beat marker lab for the Premiere plugin.</p>
          </div>
        </div>

        <div className="import-actions">
          <label className="file-button">
            <Upload size={18} aria-hidden="true" />
            <span>{track ? "Replace audio" : "Import audio"}</span>
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              aria-label="Import audio file"
            />
          </label>
        </div>
      </section>

      {error ? <div className="notice error">{error}</div> : null}
      {busy !== "idle" ? <div className="notice">{busy === "decoding" ? "Decoding audio..." : "Analyzing beat grid..."}</div> : null}

      {track ? (
        <audio ref={audioRef} src={track.url} preload="metadata" />
      ) : null}

      <section className="workspace">
        <div className="timeline-zone">
          <div className="transport-row">
            <div className="mode-tabs" role="tablist" aria-label="Marker mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "automated"}
                className={mode === "automated" ? "tab active" : "tab"}
                onClick={() => setMode("automated")}
              >
                <Zap size={16} aria-hidden="true" />
                Automated
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "manual"}
                className={mode === "manual" ? "tab active" : "tab"}
                onClick={() => setMode("manual")}
              >
                <Scissors size={16} aria-hidden="true" />
                Manual
              </button>
            </div>

            <div className="time-readout">
              <span>{secondsToClock(currentTime)}</span>
              <span>{duration ? secondsToClock(duration) : "00:00.000"}</span>
            </div>
          </div>

          <Waveform
            duration={duration || 1}
            envelope={analysis?.envelope ?? []}
            beatGrid={activeGrid}
            ranges={waveformRanges}
            markers={waveformMarkers}
            taps={allManualTaps}
            currentTime={currentTime}
            viewStart={visibleStart}
            viewEnd={visibleEnd}
            onSeek={handleSeek}
            onZoomAt={(time, direction) => changeZoom(zoomLevel + direction * 2, time)}
          />

          <div className="transport-strip" aria-label="Timeline playback controls">
            <div className="scrub-controls">
              <button
                type="button"
                className="quiet-action"
                onClick={() => stepFrames(-1)}
                disabled={!track}
                aria-label="Step one frame back"
              >
                <SkipBack size={18} aria-hidden="true" />
              </button>
              <button
                className="play-action"
                type="button"
                onClick={togglePlayback}
                disabled={!track}
                aria-label={isPlaying ? "Pause playback" : "Play playback"}
              >
                {isPlaying ? (
                  <Pause size={20} aria-hidden="true" />
                ) : (
                  <Play size={20} aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="quiet-action"
                onClick={() => stepFrames(1)}
                disabled={!track}
                aria-label="Step one frame forward"
              >
                <SkipForward size={18} aria-hidden="true" />
              </button>
            </div>

            <label className="fps-select">
              <span>FPS</span>
              <select
                value={timelineFps}
                onChange={(event) => setTimelineFps(Number(event.target.value))}
                disabled={!track}
                aria-label="Timeline frame rate"
              >
                {FPS_CHOICES.map((fps) => (
                  <option key={fps} value={fps}>
                    {fps}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={scrubAudition ? "icon-button pressed" : "icon-button"}
              onClick={() => setScrubAudition((enabled) => !enabled)}
              disabled={!track}
              aria-pressed={scrubAudition}
            >
              {scrubAudition ? (
                <Volume2 size={18} aria-hidden="true" />
              ) : (
                <VolumeX size={18} aria-hidden="true" />
              )}
              <span>Scrub</span>
            </button>
          </div>

          <div className="zoom-strip" aria-label="Timeline zoom controls">
            <button
              type="button"
              className="quiet-action"
              onClick={() => changeZoom(zoomLevel - 2)}
              disabled={!track || zoomLevel <= MIN_ZOOM}
              aria-label="Zoom out"
            >
              <ZoomOut size={18} aria-hidden="true" />
            </button>
            <label className="zoom-slider">
              <span>Zoom {zoomLevel}x</span>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step="1"
                value={zoomLevel}
                disabled={!track}
                onChange={(event) => changeZoom(Number(event.target.value))}
                aria-label="Timeline zoom"
              />
            </label>
            <button
              type="button"
              className="quiet-action"
              onClick={() => changeZoom(zoomLevel + 2)}
              disabled={!track || zoomLevel >= MAX_ZOOM}
              aria-label="Zoom in"
            >
              <ZoomIn size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="quiet-action"
              onClick={() => panTimeline(-1)}
              disabled={!track || zoomLevel <= MIN_ZOOM}
              aria-label="Pan timeline left"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="quiet-action"
              onClick={() => panTimeline(1)}
              disabled={!track || zoomLevel <= MIN_ZOOM}
              aria-label="Pan timeline right"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={focusCurrentBeat}
              disabled={!track}
            >
              <Crosshair size={18} aria-hidden="true" />
              <span>Beat</span>
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setZoomLevel(1);
                setViewStart(0);
              }}
              disabled={!track || zoomLevel <= MIN_ZOOM}
            >
              <Maximize2 size={18} aria-hidden="true" />
              <span>Fit</span>
            </button>
          </div>

          <div className="legend-row" aria-label="Timeline legend">
            <span><i className="dot range" />Section range</span>
            <span><i className="dot beat" />Beat grid</span>
            <span><i className="dot cut" />Cut marker</span>
            <span><i className="dot section" />Section</span>
            <span><i className="dot tap" />Manual tap</span>
            <span><i className="dot playhead" />Playhead</span>
          </div>

          <VideoPreview
            currentTime={currentTime}
            duration={duration || 1}
            markers={markers}
            onSeek={handleSeek}
          />
        </div>

        <aside className="side-panel" aria-label="Marker settings">
          <div className="metrics">
            <Metric label="BPM" value={activeGrid ? activeGrid.bpm.toString() : "-"} />
            <Metric label="Grid" value={activeGrid ? `${Math.round(activeGrid.confidence * 100)}%` : "-"} />
            <Metric label="Loop" value={phraseLabel} />
            <Metric label="Markers" value={markers.length.toString()} />
          </div>

          <div className="panel-section">
            <h2>{mode === "automated" ? "Automated cuts" : "Manual learning"}</h2>
            <p>{activeSummary ?? "Import a beat to start placing edit markers."}</p>

            {mode === "automated" ? (
              <>
                <label className="field-label" htmlFor="phrase-bars">
                  Phrase length
                </label>
                <div className="segmented" id="phrase-bars">
                  {PHRASE_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      className={phraseBars === choice ? "segment active" : "segment"}
                      onClick={() => refreshAutomatedMarkers(choice)}
                    >
                      {choice} bars
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                {songSections.length > 0 ? (
                  <>
                    <label className="field-label" htmlFor="song-sections">
                      Song sections
                    </label>
                    <div className="section-list" id="song-sections">
                      {songSections.map((section) => {
                        const tapCount = sectionTaps[section.id]?.length ?? 0;
                        const isApplied = Boolean(appliedSections[section.id]);
                        const isActive = selectedSection?.id === section.id;

                        return (
                          <button
                            type="button"
                            key={section.id}
                            className={sectionClassName(isActive, isApplied)}
                            onClick={() => goToSection(section)}
                          >
                            <strong>{section.label}</strong>
                            <span>
                              Bars {section.startBar}-{section.endBar}
                            </span>
                            <span>{formatSectionRange(section)}</span>
                            <em>{isApplied ? "Applied" : `${tapCount} taps`}</em>
                          </button>
                        );
                      })}
                    </div>
                    <div className="section-prompt">
                      <strong>{selectedSection ? `Teach ${selectedSection.label}` : "Teach section"}</strong>
                      <span>
                        {selectedSection
                          ? `${secondsToClock(selectedSection.start)}-${secondsToClock(selectedSection.end)}`
                          : "No section selected"}
                      </span>
                    </div>
                  </>
                ) : null}

                <label className="field-label" htmlFor="manual-phrase-bars">
                  Learned phrase
                </label>
                <div className="segmented" id="manual-phrase-bars">
                  {PHRASE_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      className={manualPhraseBars === choice ? "segment active" : "segment"}
                      onClick={() => changeManualPhraseBars(choice)}
                    >
                      {choice} bars
                    </button>
                  ))}
                </div>

                <div className="tap-actions">
                  <button type="button" className="primary-action" disabled={!track} onClick={handleTap}>
                    <Scissors size={18} aria-hidden="true" />
                    Tap change
                  </button>
                  <button
                    type="button"
                    className="apply-action"
                    disabled={!manual || selectedSectionTaps.length === 0 || manual.markers.length === 0}
                    onClick={applyManualPattern}
                  >
                    <CheckCircle2 size={18} aria-hidden="true" />
                    Apply section
                  </button>
                  <button
                    type="button"
                    className="quiet-action"
                    disabled={selectedSectionTaps.length === 0}
                    onClick={undoLastTap}
                    aria-label="Undo last tap"
                  >
                    <Undo2 size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="quiet-action"
                    disabled={selectedSectionTaps.length === 0}
                    onClick={clearTaps}
                    aria-label="Clear taps"
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  className="next-section-action"
                  disabled={songSections.length === 0}
                  onClick={goToNextUntaughtSection}
                >
                  Next section
                </button>
                <div className={selectedSection && appliedSections[selectedSection.id] ? "apply-status applied" : "apply-status"}>
                  <strong>{selectedSection && appliedSections[selectedSection.id] ? "Applied" : "Draft"}</strong>
                  <span>
                    {selectedSection && appliedSections[selectedSection.id]
                      ? `${appliedSections[selectedSection.id]?.markers.length ?? 0} cuts drive ${selectedSection.label}.`
                      : `${selectedSectionTaps.length} taps ready for this section.`}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="panel-section">
            <h2>Export</h2>
            <div className="export-actions">
              <button type="button" onClick={() => download("json")} disabled={markers.length === 0}>
                <Download size={18} aria-hidden="true" />
                JSON
              </button>
              <button type="button" onClick={() => download("csv")} disabled={markers.length === 0}>
                <Download size={18} aria-hidden="true" />
                CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  resetManualWork();
                  setCurrentTime(0);
                  if (audioRef.current) {
                    audioRef.current.currentTime = 0;
                    audioRef.current.pause();
                  }
                  clearAuditionTimer();
                  setIsPlaying(false);
                }}
                disabled={!track}
              >
                <RotateCcw size={18} aria-hidden="true" />
                Reset
              </button>
            </div>
          </div>

          <div className="marker-list" aria-label="Generated markers">
            {markers.slice(0, 12).map((marker) => (
              <div key={marker.id} className="marker-row">
                <span>{marker.label}</span>
                <strong>{secondsToClock(marker.time)}</strong>
              </div>
            ))}
            {markers.length > 12 ? (
              <div className="marker-row muted">
                <span>More markers</span>
                <strong>{markers.length - 12}</strong>
              </div>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  );
}

interface MetricProps {
  label: string;
  value: string;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.tagName === "TEXTAREA"
  );
}

function buildManualDraftSummary(
  manual: ManualLearningResult | null,
  tapCount: number
): string {
  if (!manual || tapCount === 0) {
    return "Tap a few changes, then apply the learned pattern.";
  }

  return `Draft pattern: ${manual.pattern.phraseBars} bars, ${manual.markers.length} cuts ready.`;
}

function formatSectionRange(section: SongSection): string {
  return `${secondsToClock(section.start)}-${secondsToClock(section.end)}`;
}

interface SectionSummaryInput {
  selectedSection: SongSection;
  manual: ManualLearningResult | null;
  selectedTapCount: number;
  appliedResult: ManualLearningResult | null;
  appliedSectionCount: number;
  sectionCount: number;
}

function buildSectionManualSummary({
  selectedSection,
  manual,
  selectedTapCount,
  appliedResult,
  appliedSectionCount,
  sectionCount
}: SectionSummaryInput): string {
  if (appliedResult) {
    return `${selectedSection.label}: ${appliedResult.markers.length} cuts applied. ${appliedSectionCount}/${sectionCount} sections taught.`;
  }

  if (!manual || selectedTapCount === 0) {
    return `Teach ${selectedSection.label}: tap changes for this part, then apply the section.`;
  }

  return `Draft ${selectedSection.label}: ${selectedTapCount} taps, ${manual.pattern.motifOffsets.length} cuts per loop ready.`;
}

function mergeAppliedSectionMarkers(
  appliedSections: Record<string, ManualLearningResult>,
  sections: SongSection[]
): BeatMarker[] {
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const sortedMarkers = Object.entries(appliedSections)
    .flatMap(([sectionId, result]) => {
      const section = sectionById.get(sectionId);
      return result.markers.map((marker, index) => ({
        ...marker,
        id: `${sectionId}-${marker.id}`,
        label: `${section?.label ?? "Section"} Cut ${index + 1}`
      }));
    })
    .sort((a, b) => a.time - b.time);

  const merged: BeatMarker[] = [];
  for (const marker of sortedMarkers) {
    const previous = merged[merged.length - 1];
    if (!previous || Math.abs(previous.time - marker.time) > 0.001) {
      merged.push(marker);
    }
  }

  return merged.map((marker, index) => ({
    ...marker,
    id: `manual-section-${index + 1}-${Math.round(marker.time * 1000)}`
  }));
}

function sectionClassName(isActive: boolean, isApplied: boolean): string {
  return [
    "section-chip",
    isActive ? "active" : "",
    isApplied ? "applied" : ""
  ]
    .filter(Boolean)
    .join(" ");
}
