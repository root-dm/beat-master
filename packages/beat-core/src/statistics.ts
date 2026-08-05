export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }

  return sorted[middle] ?? 0;
}

export function stdev(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const average = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    (values.length - 1);

  return Math.sqrt(variance);
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * clamp(q, 0, 1);
  const base = Math.floor(pos);
  const rest = pos - base;

  return (sorted[base] ?? 0) + rest * ((sorted[base + 1] ?? sorted[base] ?? 0) - (sorted[base] ?? 0));
}

export function movingAverage(values: number[], radius: number): number[] {
  if (radius <= 0 || values.length === 0) {
    return [...values];
  }

  const output: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    let total = 0;
    let count = 0;

    for (let cursor = start; cursor <= end; cursor += 1) {
      total += values[cursor] ?? 0;
      count += 1;
    }

    output.push(total / count);
  }

  return output;
}

export function nearestFrom(value: number, choices: number[]): number {
  if (choices.length === 0) {
    return value;
  }

  return choices.reduce((best, choice) =>
    Math.abs(choice - value) < Math.abs(best - value) ? choice : best
  );
}

export function uniqueSortedTimes(times: number[], precision = 3): number[] {
  const scale = 10 ** precision;
  const rounded = times
    .filter((time) => Number.isFinite(time) && time >= 0)
    .map((time) => Math.round(time * scale) / scale)
    .sort((a, b) => a - b);

  const output: number[] = [];
  for (const time of rounded) {
    const previous = output[output.length - 1];
    if (previous === undefined || Math.abs(time - previous) > 1 / scale) {
      output.push(time);
    }
  }

  return output;
}

export function roundTo(value: number, decimals = 3): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

