/** Published observations adapted to Dygraphs; no interpolation or inferred predictions. */
import type { DiagramMode, FrontendConfiguration, HistoryPoint, Parameter } from "../../api/contracts";
import { bounds, displayValue, snowCategory } from "./series";

export const SNOW_CATEGORIES = ["No snow", "Intermediate", "Undifferentiated", "High snow cover"];
export const CHART_SERIES = ["Prediction", "Unavailable", "Lower snow threshold", "Upper snow threshold"];
export type ChartRow = { time: number; point: HistoryPoint | null };

function paddedRange(values: number[]): [number, number] {
  if (!values.length) return [0, 1];
  let low = values[0], high = values[0];
  for (const value of values) { low = Math.min(low, value); high = Math.max(high, value); }
  const padding = (high - low || Math.max(1, Math.abs(high) * 0.1)) * 0.08;
  return [low - padding, high + padding];
}

export function prepareHistoryChart(points: HistoryPoint[], parameter: Parameter, mode: DiagramMode,
  configuration: FrontendConfiguration, start: string, end: string) {
  const classes = mode === "classes";
  const calibrated = mode === "calibrated" && parameter === "visibility";
  const thresholdsVisible = parameter === "snow" && mode === "raw";
  const { ceiling_metres: ceiling, saturated_band_metres: band } = configuration.visibility_display;
  const transform = (value: number) => calibrated ? displayValue(value, ceiling, band) : value;
  const values: number[] = [], thresholds: number[] = [];
  for (const point of points) {
    const range = bounds(point, mode);
    if (range) values.push(...range.map(transform));
    if (calibrated && point.calibrated_center != null) values.push(transform(point.calibrated_center));
    if (thresholdsVisible) for (const value of [point.snow_threshold_low, point.snow_threshold_high]) {
      if (value != null && Number.isFinite(value)) thresholds.push(value);
    }
  }
  values.push(...thresholds);
  const extent = paddedRange(values);
  const unavailable = classes ? -0.6 : extent[0] - (extent[1] - extent[0]) * 0.1;
  const valueRange: [number, number] = classes ? [-1, 3.5] : [unavailable - (extent[1] - extent[0]) * 0.06, extent[1]];
  const rows: ChartRow[] = points.map(point => ({ time: Date.parse(point.t), point }));
  // Empty boundary rows make reset cover the requested range, including periods
  // with no observations. They never appear in the count or observation readout.
  rows.push({ time: Date.parse(start), point: null }, { time: Date.parse(end), point: null });
  rows.sort((a, b) => a.time - b.time || (a.point?.id ?? -1) - (b.point?.id ?? -1));
  const pointRows = new Map<number, number>();
  const data = rows.map(({ time, point }, index) => {
    if (!point) return [new Date(time), null, null, ...(thresholdsVisible ? [null, null] : [])];
    pointRows.set(point.id, index);
    const range = bounds(point, mode);
    const category = snowCategory(point.snow_class, point);
    const missing = classes ? category === null : !range && !(calibrated && point.calibrated_center != null);
    // The primary ordinate indexes the observation for Dygraphs. The plotter
    // draws the real bounds and only a published centre.
    const value = classes ? category : calibrated && point.calibrated_center != null
      ? transform(point.calibrated_center) : range ? transform(range[0]) : null;
    return [new Date(time), missing ? null : value, missing ? unavailable : null,
      ...(thresholdsVisible ? [point.snow_threshold_low ?? null, point.snow_threshold_high ?? null] : [])];
  });
  return { data, rows, pointRows, valueRange, unavailable, transform,
    hasThresholds: thresholds.length > 0, thresholdsVisible };
}
