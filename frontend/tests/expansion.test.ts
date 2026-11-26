import { expect, it } from "vitest";
import type { Camera, SiteFeature } from "../src/api/contracts";
import { expandedCameraPositions, groupMarkerFactor } from "../src/features/map/expansion";

function site(coordinates: [number, number][]): SiteFeature {
  const cams: Camera[] = coordinates.map(([x, y], index) => ({ p: `camera-${index}`, name: "View", x, y,
    altitude: 100, country: "FR", cls: "snow.none", u: false, w: null, t: null, vl: null, vu: null, value: null }));
  return { type: "Feature", geometry: { type: "Point", coordinates: [2, 47] },
    properties: { id: "site", name: "Site", platform: "site", cams, n: cams.length, cls: "snow.none", u: false } };
}
const project = ([x, y]: [number, number]) => ({ x: x * 100, y: y * -100 });
const unproject = ({ x, y }: { x: number; y: number }): [number, number] => [x / 100, y / -100];

it("makes grouped discs larger and separates coincident cameras without changing their coordinates", () => {
  const original = site([[2, 47], [2, 47]]);
  const positions = expandedCameraPositions(original, project, unproject);
  const first = project(positions[0].coordinates), second = project(positions[1].coordinates);
  expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeCloseTo(34);
  expect(positions.map(point => point.camera.p)).toEqual(["camera-0", "camera-1"]);
  expect(original.properties.cams.map(camera => [camera.x, camera.y])).toEqual([[2, 47], [2, 47]]);
  expect(groupMarkerFactor(1)).toBe(1);
  expect(groupMarkerFactor(2)).toBe(1.5);
});

it("keeps separated camera positions and spreads a group when only some views overlap", () => {
  const separated = site([[2, 47], [3, 47]]);
  expect(expandedCameraPositions(separated, project, unproject).map(point => point.coordinates)).toEqual([[2, 47], [3, 47]]);
  const mixed = expandedCameraPositions(site([[2, 47], [2, 47], [3, 47]]), project, unproject);
  expect(new Set(mixed.map(point => point.coordinates.join(","))).size).toBe(3);
});
