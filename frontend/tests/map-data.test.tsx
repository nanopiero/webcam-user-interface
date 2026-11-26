import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { getMap } from "../src/api/client";
import type { Camera, MapPayload } from "../src/api/contracts";
import { mergeMapPayload } from "../src/features/map/cache";
import { useMapData } from "../src/features/map/useMapData";

vi.mock("../src/api/client", () => ({ getMap: vi.fn() }));

function payload(cameras: [string, string, string][]): MapPayload {
  const cams: Camera[] = cameras.map(([p, country, cls]) => ({ p, country, cls, name: p,
    altitude: 100, x: 2, y: 47, u: false, w: null, t: null, vl: null, vu: null, value: null }));
  return { type: "FeatureCollection", parameter: "snow", at: "2026-11-18T12:00:00Z", counts: { sites: cams.length ? 1 : 0, cameras: cams.length },
    features: cams.length ? [{ type: "Feature", geometry: { type: "Point", coordinates: [2, 47] },
      properties: { id: "group", platform: "example", name: "Example", cams, n: cams.length, cls: cams[0].cls, u: false } }] : [] };
}

it("replaces refreshed cameras, removes vanished cameras and recomputes mixed grouped classes", () => {
  const before = payload([["fr-old", "FR", "snow.none"], ["de", "DE", "snow.none"]]);
  const incoming = payload([["fr-new", "FR", "snow.intermediate"]]);
  const merged = mergeMapPayload(before, incoming, new Set(["FR"]));
  expect(merged.features[0].properties.cams.map(camera => camera.p)).toEqual(["de", "fr-new"]);
  expect(merged.features[0].properties.pie).toEqual(["snow.none", "snow.intermediate"]);
  expect(mergeMapPayload(merged, payload([]), new Set(["FR", "DE"])).features).toEqual([]);
});

it("loads the ROI first, caches bordering cameras and refreshes every selected country", async () => {
  const mock = vi.mocked(getMap);
  mock.mockReset();
  mock.mockImplementation(async (_parameter, _at, _signal, scope) => payload((scope?.countries ?? []).map(code => [code, code, "snow.none"])));
  const { result, rerender } = renderHook(({ codes, revision }) => useMapData("snow", null, revision, new Set(codes)),
    { initialProps: { codes: ["FR"], revision: 0 } });
  await waitFor(() => expect(result.current.data?.counts.cameras).toBe(1));
  expect(mock.mock.calls[0][3]).toEqual({ countries: ["FR"], includeUnknownCountry: false, qualifiedOnly: true });
  rerender({ codes: ["FR", "DE"], revision: 0 });
  await waitFor(() => expect(result.current.data?.counts.cameras).toBe(2));
  expect(mock).toHaveBeenCalledTimes(2);
  rerender({ codes: ["FR"], revision: 0 });
  rerender({ codes: ["FR", "DE"], revision: 0 });
  expect(mock).toHaveBeenCalledTimes(2);
  rerender({ codes: ["FR", "DE"], revision: 1 });
  await waitFor(() => expect(mock).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(new Set(mock.mock.calls[2][3]?.countries)).toEqual(new Set(["FR", "DE"]));
  expect(result.current.loadedCountries).toEqual(new Set(["FR", "DE"]));
});
