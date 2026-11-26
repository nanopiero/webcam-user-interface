import { expect, it } from "vitest";
import { matchesAltitude } from "../src/features/map/AltitudeFilter";

it("uses the exact requested altitude boundaries and leaves unknowns under All", () => {
  expect(matchesAltitude(499.999, "low")).toBe(true);
  expect(matchesAltitude(500, "low")).toBe(false);
  expect(matchesAltitude(500, "middle")).toBe(true);
  expect(matchesAltitude(1000, "middle")).toBe(true);
  expect(matchesAltitude(1000, "high")).toBe(false);
  expect(matchesAltitude(1000.001, "high")).toBe(true);
  expect(matchesAltitude(null, "all")).toBe(true);
  expect(matchesAltitude(null, "low")).toBe(false);
});
