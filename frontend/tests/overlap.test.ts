import { expect, it } from "vitest";
import type { Camera, SiteFeature, SupplementaryFeature } from "../src/api/contracts";
import { markersAtPoint, targetKey, webcamChoices, type ClickMarker } from "../src/features/map/overlap";

const camera = (p: string): Camera => ({ p, name: p, x: 2, y: 47, altitude: 100, country: "FR",
  cls: "snow.none", u: false, w: null, t: null, vl: null, vu: null, value: null });
const cams = [camera("north"), camera("south")];
const site: SiteFeature = { type: "Feature", geometry: { type: "Point", coordinates: [2, 47] },
  properties: { id: "site", platform: "site", name: "Site", cams, n: 2, cls: "snow.none", u: false } };
const webcam: SupplementaryFeature = { type: "Feature", geometry: { type: "Point", coordinates: [2, 47] },
  properties: { id: "north", name: "Additional", altitude: 100, source_layer_name: "Example" } };

it("finds covered small dots and large markers without depending on their draw order", () => {
  const markers: ClickMarker[] = [
    { centre: { x: 10, y: 10 }, radius: 3.2, target: { kind: "supplementary", webcam } },
    { centre: { x: 16, y: 10 }, radius: 10, target: { kind: "observed", site } },
  ];
  expect(markersAtPoint(markers, { x: 10, y: 10 })).toHaveLength(2);
  expect(markersAtPoint([...markers].reverse(), { x: 10, y: 10 })).toHaveLength(2);
  expect(markersAtPoint(markers.slice(0, 1), { x: 17, y: 10 })).toHaveLength(1);
  // The existing tolerance ends here; transparent sprite padding adds no target area.
  expect(markersAtPoint(markers.slice(0, 1), { x: 18, y: 10 })).toHaveLength(0);
});

it("lists every view once and keeps supplementary identities separate from WEOW identities", () => {
  const choices = webcamChoices([{ kind: "observed", site }, { kind: "observed", site, camera: cams[0] },
    { kind: "supplementary", webcam }]);
  expect(choices.map(targetKey)).toEqual(["additional:north", "weow:north", "weow:south"]);
});

it("offers only cameras supplied by the active map filters", () => {
  const filtered = { ...site, properties: { ...site.properties, cams: [cams[1]], n: 1 } };
  expect(webcamChoices([{ kind: "observed", site: filtered }]).map(targetKey)).toEqual(["weow:south"]);
});
