import { describe, expect, it } from "vitest";
import type { FrontendConfiguration, HistoryPoint } from "../src/api/contracts";
import { prepareHistoryChart } from "../src/features/history/chartData";
import { hitHistoryObservation } from "../src/features/history/chartHover";

const configuration = { visibility_display: { ceiling_metres: 15000, saturated_band_metres: 1000 } } as FrontendConfiguration;
const start = "2026-11-26T10:00:00Z", end = "2026-11-26T12:00:00Z";
const point = (id: number, overrides: Partial<HistoryPoint> = {}): HistoryPoint => ({
  id, t: "2026-11-26T11:00:00Z", lower: -4, upper: 2, snow_class: null,
  calibrated_lower: null, calibrated_upper: null, calibrated_center: null,
  model_version: null, postprocessing_version: null, quality_code: 0, ...overrides,
});
const projectX = (time: number) => (time - Date.parse(start)) / 60000;

describe("interval hover", () => {
  it("hits any height of the real raw bar and distinguishes revisions at the same timestamp", () => {
    const prepared = prepareHistoryChart([point(1), point(2, { lower: 5, upper: 8 })], "visibility", "raw", configuration, start, end);
    const from = Date.parse("2026-11-26T10:55:00Z"), to = Date.parse("2026-11-26T11:05:00Z");
    const projectY = (value: number) => 100 - value * 10;
    expect(hitHistoryObservation(prepared, "raw", 60, 90, from, to, projectX, projectY)?.id).toBe(1);
    expect(hitHistoryObservation(prepared, "raw", 60, 30, from, to, projectX, projectY)?.id).toBe(2);
    expect(hitHistoryObservation(prepared, "raw", 60, 180, from, to, projectX, projectY)).toBeNull();
  });

  it("hits calibrated bounds away from the published centre and retains the original values above the display cap", () => {
    const first = point(1, { calibrated_lower: 1000, calibrated_upper: 8000, calibrated_center: 1800 });
    const capped = point(2, { t: "2026-11-26T11:20:00Z", calibrated_lower: 20000, calibrated_upper: 90000 });
    const prepared = prepareHistoryChart([first, capped], "visibility", "calibrated", configuration, start, end);
    const hit = hitHistoryObservation(prepared, "calibrated", 60, 7000, Date.parse(start), Date.parse(end), projectX, value => value);
    expect(hit?.calibrated_center).toBe(1800);
    const aboveCap = hitHistoryObservation(prepared, "calibrated", 80, 15650, Date.parse(start), Date.parse(end), projectX, value => value);
    expect(aboveCap?.calibrated_upper).toBe(90000);
    expect(aboveCap?.calibrated_center).toBeNull();
  });
});
