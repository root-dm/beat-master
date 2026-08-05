export function secondsToClock(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const millis = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);

  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function secondsToTimecode(seconds: number, fps = 30): string {
  const safeSeconds = Math.max(0, seconds);
  const totalFrames = Math.round(safeSeconds * fps);
  const frames = totalFrames % fps;
  const totalWholeSeconds = Math.floor(totalFrames / fps);
  const secs = totalWholeSeconds % 60;
  const totalMinutes = Math.floor(totalWholeSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  return [
    String(hours).padStart(2, "0"),
    String(mins).padStart(2, "0"),
    String(secs).padStart(2, "0"),
    String(frames).padStart(2, "0")
  ].join(":");
}

