import { describe, expect, it } from "vitest";
import type { FrontendConfiguration, HistoryPoint } from "../src/api/contracts";
import { prepareHistoryChart } from "../src/features/history/chartData";

const configuration = { visibility_display: { ceiling_metres: 15000, saturated_band_metres: 1000 } } as FrontendConfiguration;
const start = "2026-11-26T10:00:00Z", end = "2026-11-26T12:00:00Z";
const point = (id: number, overrides: Partial<HistoryPoint> = {}): HistoryPoint => ({
  id, t: "2026-11-26T11:00:00Z", lower: -4, upper: -2, snow_class: 1,
  calibrated_lower: null, calibrated_upper: null, calibrated_center: null,
  model_version: null, postprocessing_version: null, quality_code: 0, ...overrides,
});

describe("Dygraphs published history data", () => {
  it("keeps revision rows and exact threshold changes, including a valid zero and missing thresholds", () => {
    const points = [point(1), point(2, { snow_threshold_low: -2.5, snow_threshold_high: 0 }),
      point(3, { t: end, snow_threshold_low: -1.5, snow_threshold_high: 1 })];
    const chart = prepareHistoryChart(points, "snow", "raw", configuration, start, end);
    expect(chart.rows.filter(row => row.point).map(row => row.point!.id)).toEqual([1, 2, 3]);
    expect(chart.data[chart.pointRows.get(1)!].slice(3)).toEqual([null, null]);
    expect(chart.data[chart.pointRows.get(2)!].slice(3)).toEqual([-2.5, 0]);
    expect(chart.data[chart.pointRows.get(3)!].slice(3)).toEqual([-1.5, 1]);
    expect(chart.valueRange[0]).toBeLessThan(-4);
    expect(chart.valueRange[1]).toBeGreaterThan(1);
    expect(points[0].upper).toBe(-2);
  });

  it("uses a separate numeric threshold scale for categorical classes, never a snow percentage", () => {
    const points = [point(1), point(2, { snow_threshold_low: -20, snow_threshold_high: 0 })];
    const chart = prepareHistoryChart(points, "snow", "classes", configuration, start, end);
    expect(chart.data[chart.pointRows.get(1)!][1]).toBe(2);
    expect(chart.data[chart.pointRows.get(2)!][1]).toBe(3);
    expect(chart.valueRange).toEqual([-1, 3.5]);
    expect(chart.thresholdRange[0]).toBeLessThan(-20);
    expect(chart.thresholdRange[1]).toBeGreaterThan(0);
  });

  it("preserves published calibrated centres and uses an unavailable row without fabricating bounds", () => {
    const points = [point(1), point(2, { calibrated_lower: 1000, calibrated_upper: 3000, calibrated_center: 1800 }),
      point(3, { calibrated_lower: 20000, calibrated_upper: 90000, calibrated_center: null })];
    const chart = prepareHistoryChart(points, "visibility", "calibrated", configuration, start, end);
    expect(chart.data[chart.pointRows.get(1)!].slice(1)).toEqual([null, chart.unavailable]);
    expect(chart.data[chart.pointRows.get(2)!][1]).toBe(1800);
    expect(chart.transform(90000)).toBe(15650);
    expect(points[2].calibrated_center).toBeNull();
    expect(points[2].calibrated_upper).toBe(90000);
  });

  it("keeps empty ranges and class-only observations usable without making boundary rows into observations", () => {
    const empty = prepareHistoryChart([], "snow", "classes", configuration, start, end);
    expect(empty.rows.every(row => row.point === null)).toBe(true);
    expect(empty.hasThresholds).toBe(false);
    expect(empty.data.map(row => row[0])).toEqual([new Date(start), new Date(end)]);
    const chart = prepareHistoryChart([point(1, { lower: null, upper: null, snow_class: 10 })], "snow", "classes", configuration, start, end);
    expect(chart.data[chart.pointRows.get(1)!][1]).toBe(1);
  });
});
