import { expect, it } from "vitest";
import type { Camera, SiteFeature } from "../src/api/contracts";
import { cameraSector, markerScale, needsSprite, siteForAltitude, siteForCameras, siteSectors, smallWhiteMarker } from "../src/features/map/presentation";
import { CLASS_COLOURS, HIGH_SNOW_COLOUR, classColour } from "../src/features/map/icons";

const camera = (p: string, altitude: number | null, cls: string): Camera => ({
  p, name: p, altitude, country: null, cls, x: 2, y: 47, u: false, w: null, t: null, vl: null, vu: null, value: null,
});
function site(cams: Camera[]): SiteFeature {
  return { type: "Feature", geometry: { type: "Point", coordinates: [2, 47] },
    properties: { id: "example-site", platform: "example", name: "Example", n: cams.length,
      cams, cls: "white", u: false } };
}

it("derives altitude views locally without changing downloaded cameras or inventing classes", () => {
  const original = site([camera("low", 100, "snow.none"), camera("middle", 500, "snow.intermediate"),
    camera("high", 1001, "snow.undifferentiated"), camera("unknown", null, "white")]);
  expect(siteForAltitude(original, "all", "snow")).toBe(original);
  expect(siteForAltitude(original, "low", "snow")?.properties.cls).toBe("snow.none");
  expect(siteForAltitude(original, "middle", "snow")?.properties.cls).toBe("snow.intermediate");
  expect(siteForAltitude(original, "high", "snow")?.properties.cams.map(item => item.p)).toEqual(["high"]);
  expect(original.properties.cams).toHaveLength(4);
  expect(original.properties.cls).toBe("white");
  expect(siteForAltitude(site([camera("unknown", null, "white")]), "low", "snow")).toBeNull();
});

it("recomputes grouped snow pies and published visibility bounds for the selected altitude", () => {
  const mixed = site([camera("a", 700, "snow.none"), camera("b", 700, "snow.intermediate"), camera("c", 1500, "snow.none")]);
  expect(siteForAltitude(mixed, "middle", "snow")?.properties.pie).toEqual(["snow.none", "snow.intermediate"]);
  const visibility = site([
    { ...camera("a", 700, "visibility.200_500"), vl: 250, vu: 400 },
    { ...camera("b", 700, "visibility.1000_1500"), vl: 1100, vu: 1200 },
    { ...camera("c", 1500, "visibility.5000_8000"), vl: 5500, vu: 7000 },
  ]);
  expect(siteForAltitude(visibility, "middle", "visibility")?.properties.cls).toBe("visibility.200_1500");
});

it("defaults to compact WEOW icons and handles invalid display configuration", () => {
  expect(markerScale()).toBe(0.65);
  expect(markerScale(0)).toBe(0.65);
  expect(markerScale(Number.NaN)).toBe(0.65);
  expect(markerScale(1)).toBe(1);
});

it("uses small white dots for missing or stale observations and large discs for recent unqualified results", () => {
  const white = camera("view", 100, "white");
  expect(smallWhiteMarker({ ...white, w: "no_record", qs: null })).toBe(true);
  expect(smallWhiteMarker({ ...white, w: "stale", qs: 0 })).toBe(true);
  expect(smallWhiteMarker({ ...white, w: "stale", qs: 2 })).toBe(true);
  expect(smallWhiteMarker({ ...white, w: "scene_unqualified", qs: 0 })).toBe(false);
  expect(smallWhiteMarker({ ...white, w: "scene_unqualified", qs: 1 })).toBe(false);
  expect(smallWhiteMarker({ ...white, w: "qualification_unknown", qs: null })).toBe(false);
  expect(smallWhiteMarker({ ...white, cls: "snow.none", w: null, qs: 2 })).toBe(false);
});

it("keeps high and undifferentiated snow as distinct grouped classes with solid violet for high cover", () => {
  const mixed = site([camera("high", 700, "snow.high"), camera("undifferentiated", 700, "snow.undifferentiated"), camera("low", 100, "snow.none")]);
  expect(siteForAltitude(mixed, "middle", "snow")?.properties.pie).toEqual(["snow.high", "snow.undifferentiated"]);
  expect(CLASS_COLOURS["snow.high"]).not.toBe(CLASS_COLOURS["snow.undifferentiated"]);
  expect(classColour("snow.high")).toBe(HIGH_SNOW_COLOUR);
  expect(classColour("snow.undifferentiated")).toBe(CLASS_COLOURS["snow.undifferentiated"]);
});

it("keeps each camera's freshness in same-class groups, country/altitude views and expanded markers", () => {
  const fresh = { ...camera("fresh", 100, "snow.high"), freshness: "fresh" as const };
  const ageing = { ...camera("ageing", 700, "snow.high"), freshness: "ageing" as const };
  const expired = { ...camera("expired", 700, "white"), freshness: "expired" as const, w: "stale" };
  const grouped = siteForCameras(site([fresh, ageing, expired]), [fresh, ageing, expired], "snow")!;
  expect(grouped.properties.tie).toBe(false);
  const sectors = siteSectors(grouped, 12);
  expect(sectors.map(sector => sector.ageing)).toEqual([false, true, false]);
  expect(sectors.map(sector => sector.lower)).toEqual([HIGH_SNOW_COLOUR, HIGH_SNOW_COLOUR, "#ffffff"]);
  expect(needsSprite(sectors)).toBe(true);
  expect(cameraSector(ageing)).toEqual(sectors[1]);
  expect(siteSectors(siteForAltitude(grouped, "low", "snow")!, 12)[0].ageing).toBe(false);
  expect(siteSectors(siteForAltitude(grouped, "middle", "snow")!, 12).map(sector => sector.ageing)).toEqual([true, false]);
  expect(smallWhiteMarker(expired)).toBe(true);
});

it("retains both visibility colours for ageing observations and never invents a colour for unqualified cameras", () => {
  const ageing = { ...camera("visibility", 100, "visibility.0_1500"), freshness: "ageing" as const };
  expect(cameraSector(ageing)).toEqual({ lower: "#000044", upper: "#a00050", ageing: true });
  expect(cameraSector({ ...ageing, cls: "white", w: "scene_unqualified" }).ageing).toBe(false);
  const fresh = { ...ageing, freshness: "fresh" as const };
  expect(siteSectors(site([fresh, ageing]), 12).map(sector => sector.ageing)).toEqual([false, true]);
});
