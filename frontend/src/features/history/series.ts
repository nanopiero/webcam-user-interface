import type { DiagramMode, HistoryPayload, HistoryPoint, SnowThresholds } from "../../api/contracts";
import type { Translator } from "../../i18n/core";

export function mergeHistory(pages: HistoryPayload[]): HistoryPoint[] {
  const points = new Map<number, HistoryPoint>();
  for (const page of pages) for (const point of [...page.intervals, ...page.without_raw_interval]) points.set(point.id, point);
  return [...points.values()].sort((a, b) => Date.parse(a.t) - Date.parse(b.t) || a.id - b.id);
}

export function bounds(point: HistoryPoint, mode: DiagramMode): [number, number] | null {
  if (mode === "classes") return null;
  const lower = mode === "raw" ? point.lower : point.calibrated_lower;
  const upper = mode === "raw" ? point.upper : point.calibrated_upper;
  return lower == null || upper == null ? null : [lower, upper];
}

export function closestPoint(points: HistoryPoint[], time: number): HistoryPoint | null {
  if (!points.length) return null;
  let low = 0, high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (Date.parse(points[middle].t) < time) low = middle + 1;
    else high = middle;
  }
  const next = points[Math.min(low, points.length - 1)];
  const previous = points[Math.max(low - 1, 0)];
  return Math.abs(Date.parse(previous.t) - time) <= Math.abs(Date.parse(next.t) - time) ? previous : next;
}

// A display transform only: original intervals and reported centres stay intact.
export function displayValue(value: number, ceiling: number, saturatedBand: number): number {
  return value > ceiling ? ceiling + saturatedBand * 0.65 : value;
}

export function snowClassLabel(value: number | null, thresholds: SnowThresholds = {}, translate?: Translator): string {
  const t = translate ?? ((message: string) => message);
  if (value == null) return t("Not published");
  const category = snowCategory(value, thresholds);
  if (category === null) return translate ? translate("Unrecognised class ({value})", { value }) : `Unrecognised class (${value})`;
  return t(["No snow", "Intermediate snow cover", "Undifferentiated snow", "High snow cover"][category])
    + ([30, 31, 310].includes(value) ? ` · ${t("uncertain")}` : "");
}

export function snowCategory(value: number | null, thresholds: SnowThresholds = {}): 0 | 1 | 2 | 3 | null {
  if (value === 0 || value === 30) return 0;
  if (value === 10 || value === 310) return 1;
  if (value === 1 || value === 31) return Number.isFinite(thresholds.snow_threshold_low)
    && Number.isFinite(thresholds.snow_threshold_high) ? 3 : 2;
  return null;
}
