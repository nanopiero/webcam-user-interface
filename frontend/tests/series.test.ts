import { describe, expect, it } from "vitest";
import type { HistoryPayload, HistoryPoint } from "../src/api/contracts";
import { bounds, closestPoint, displayValue, mergeHistory, snowCategory, snowClassLabel } from "../src/features/history/series";
import { fromUTCInput } from "../src/shared/format";

function point(id: number, t = "2026-11-17T10:00:00Z"): HistoryPoint {
  return { id, t, lower: -4, upper: -2, calibrated_lower: 5000, calibrated_upper: 7000,
    calibrated_center: 5800, snow_class: null, model_version: "example", postprocessing_version: null, quality_code: null };
}
function page(intervals: HistoryPoint[], without_raw_interval: HistoryPoint[] = []): HistoryPayload {
  return { processing_stream_id: "example", parameter: "visibility", start: "", end: "", intervals, without_raw_interval, truncated: false, next_cursor: null };
}
describe("historical observations", () => {
  it("shows the published snow categories without interpreting raw values as a percentage or class", () => {
    expect([0, 30, 10, 310, 1, 31].map(value => snowCategory(value))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(snowCategory(null)).toBeNull();
    expect(snowCategory(999)).toBeNull();
    expect(snowClassLabel(1)).toBe("Undifferentiated snow");
    expect(bounds({ ...point(1), lower: 1, upper: 3, snow_class: null }, "classes")).toBeNull();
  });
  it("distinguishes high cover only for snow classes with both finite thresholds from that observation", () => {
    const thresholds = { snow_threshold_low: -2.5, snow_threshold_high: 0 };
    expect([0, 30, 10, 310, 1, 31].map(value => snowCategory(value, thresholds))).toEqual([0, 0, 1, 1, 3, 3]);
    expect(snowClassLabel(1, thresholds)).toBe("High snow cover");
    expect(snowClassLabel(31, thresholds)).toBe("High snow cover · uncertain");
    expect(snowClassLabel(31, { snow_threshold_low: -2.5 })).toBe("Undifferentiated snow · uncertain");
    expect(snowCategory(1, { snow_threshold_high: 0 })).toBe(2);
    expect(snowCategory(1, { ...thresholds, snow_threshold_high: Number.NaN })).toBe(2);
    expect(snowCategory(null, thresholds)).toBeNull();
  });
  it("joins overlapping pages, keeps revisions, missing intervals, and chronological order", () => {
    const first = point(1), revision = point(2), later = { ...point(3, "2026-11-17T11:00:00Z"), lower: null, upper: null };
    expect(mergeHistory([page([first, revision], [later]), page([first])]).map(item => item.id)).toEqual([1, 2, 3]);
  });
  it("preserves raw negatives and the actual calibrated centre without filling missing bounds", () => {
    const observation = point(1);
    expect(bounds(observation, "raw")).toEqual([-4, -2]);
    expect(bounds(observation, "calibrated")).toEqual([5000, 7000]);
    expect(observation.calibrated_center).toBe(5800);
    expect(bounds({ ...observation, calibrated_lower: null }, "calibrated")).toBeNull();
    expect(snowClassLabel(null)).toBe("Not published");
    expect(snowClassLabel(310)).toBe("Intermediate snow cover · uncertain");
  });
  it("finds a real nearest observation and caps display values without modifying stored observations", () => {
    const observations = [point(1), point(2, "2026-11-17T11:00:00Z")];
    expect(closestPoint([], Date.now())).toBeNull();
    expect(closestPoint(observations, Date.parse("2026-11-17T10:55:00Z"))?.id).toBe(2);
    expect(displayValue(7000, 15000, 1000)).toBe(7000);
    expect(displayValue(90000, 15000, 1000)).toBeLessThanOrEqual(16000);
    expect(fromUTCInput("2026-11-17T10:55")).toBe("2026-11-17T10:55:00.000Z");
  });
});
