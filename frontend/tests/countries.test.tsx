import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Camera, SiteFeature } from "../src/api/contracts";
import CountryFilter from "../src/features/map/CountryFilter";
import BorderControls from "../src/features/map/BorderControls";
import { siteForAltitude, siteForCountries } from "../src/features/map/presentation";
import { borderControlsForROI, borderLayersForROI, initialBorderVisibility } from "../src/features/map/roi";

const camera = (p: string, country: string | null, altitude: number, cls: string): Camera => ({
  p, name: p, country, altitude, cls, x: 2, y: 47, u: false, w: null, t: null, vl: null, vu: null, value: null,
});
const site = (cams: Camera[]): SiteFeature => ({ type: "Feature", geometry: { type: "Point", coordinates: [2, 47] },
  properties: { id: "site", platform: "example", name: "Example", cams, n: cams.length, cls: "snow.none", u: false } });

it("filters individual cached cameras and recomputes grouped classes before altitude filtering", () => {
  const original = site([camera("fr", "FR", 400, "snow.none"), camera("fi-low", "FI", 300, "snow.intermediate"),
    camera("fi-high", "FI", 1200, "snow.undifferentiated"), camera("missing", null, 400, "white")]);
  const filtered = siteForCountries(original, new Set(["FI"]), "snow")!;
  expect(filtered.properties.cams.map(item => item.p)).toEqual(["fi-low", "fi-high"]);
  expect(filtered.properties.pie).toEqual(["snow.intermediate", "snow.undifferentiated"]);
  expect(siteForAltitude(filtered, "high", "snow")?.properties.cls).toBe("snow.undifferentiated");
  expect(siteForCountries(original, new Set(), "snow")).toBeNull();
  expect(siteForCountries(original, new Set([null]), "snow")?.properties.cls).toBe("white");
  expect(original.properties.cams).toHaveLength(4);
});

it("offers national borders without French administrative controls in a foreign deployment", () => {
  render(<BorderControls value={{ national: true, regions: false, departments: false }} roi="Finland" onChange={vi.fn()} />);
  expect(screen.getByRole("checkbox", { name: "National borders" })).toBeChecked();
  expect(screen.queryByRole("checkbox", { name: "French regions & departments" })).toBeNull();
});

it("selects administrative datasets by ROI and suppresses unsupported initial layers", () => {
  expect(borderLayersForROI("France").map(layer => layer.key)).toEqual(["departments", "regions", "national"]);
  expect(borderLayersForROI("Germany").map(layer => layer.key)).toEqual(["national"]);
  expect(borderControlsForROI("France").map(control => control.layers.map(layer => layer.key)))
    .toEqual([["national"], ["regions", "departments"]]);
  expect(initialBorderVisibility("France", { national: true, regions: true, departments: false }))
    .toEqual({ national: true, regions: true, departments: true });
  expect(initialBorderVisibility("Germany", { national: true, regions: true, departments: true }))
    .toEqual({ national: true, regions: false, departments: false });
});

it("shows and hides configured neighbours while preserving the ROI country", () => {
  const change = vi.fn();
  const props = { countries: ["FR", "BE", "DE"], roi: { name: "France", countries: ["FR"] },
    onChange: change };
  const { rerender } = render(<CountryFilter {...props} value={false} />);
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox", { name: "Show bordering webcams" }));
  expect(change).toHaveBeenLastCalledWith(true);
  rerender(<CountryFilter {...props} value={true} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Show bordering webcams" }));
  expect(change).toHaveBeenLastCalledWith(false);
});
