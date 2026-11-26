import type { BorderVisibility } from "../../api/contracts";
import regionsURL from "./data/regions.geojson?url";
import departmentsURL from "./data/departments.geojson?url";
import nationalURL from "./data/national.geojson?url";

interface BorderLayer {
  key: keyof BorderVisibility;
  label: string;
  url: string;
  colour: string;
  width: number;
  attribution: string;
  controlLabel?: string;
}

const NATIONAL: BorderLayer = {
  key: "national", label: "National borders", url: nationalURL, colour: "#111111", width: 1.7,
  attribution: '<a href="https://www.naturalearthdata.com/">Natural Earth</a>',
};
const FRENCH_ATTRIBUTION = '<a href="https://adresse.data.gouv.fr/data/contours-administratifs/">Contours administratifs · IGN / data.gouv.fr</a>';

// Other teams can add administrative layers for their ROI here.
const ADMINISTRATIVE_PROFILES = new Map<string, BorderLayer[]>([
  ["france", [
    { key: "departments", label: "French departments", controlLabel: "French regions & departments", url: departmentsURL, colour: "#111111", width: 0.6, attribution: FRENCH_ATTRIBUTION },
    { key: "regions", label: "French regions", controlLabel: "French regions & departments", url: regionsURL, colour: "#cf2525", width: 1.4, attribution: FRENCH_ATTRIBUTION },
  ]],
]);

export function borderLayersForROI(name: string): BorderLayer[] {
  return [...(ADMINISTRATIVE_PROFILES.get(name.trim().toLowerCase()) ?? []), NATIONAL];
}

export function borderControlsForROI(name: string): { label: string; layers: BorderLayer[] }[] {
  const controls = new Map<string, BorderLayer[]>();
  for (const layer of borderLayersForROI(name).reverse()) {
    const label = layer.controlLabel ?? layer.label;
    const layers = controls.get(label) ?? [];
    layers.push(layer);
    controls.set(label, layers);
  }
  return [...controls].map(([label, layers]) => ({ label, layers }));
}

export function initialBorderVisibility(name: string, requested?: BorderVisibility): BorderVisibility {
  const keys = new Set(borderLayersForROI(name).map(layer => layer.key));
  const visibility = { national: requested?.national ?? true,
    regions: keys.has("regions") && (requested?.regions ?? false),
    departments: keys.has("departments") && (requested?.departments ?? false) };
  for (const { layers } of borderControlsForROI(name)) {
    const enabled = layers.some(layer => visibility[layer.key]);
    for (const layer of layers) visibility[layer.key] = enabled;
  }
  return visibility;
}
