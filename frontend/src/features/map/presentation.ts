import type { AltitudeBand, Camera, Parameter, SiteFeature } from "../../api/contracts";
import { matchesAltitude } from "./AltitudeFilter";
import type { CountrySelection } from "./countries";
import { VISIBILITY_STEPS } from "./icons";

export const ALTITUDE_BANDS: AltitudeBand[] = ["all", "low", "middle", "high"];
export const SMALL_DOT_RADIUS = 3.2;

// Availability is specific to the selected observation parameter, not the provider image.
export function smallWhiteMarker(camera: Camera): boolean {
  return camera.cls === "white" && (camera.w === "no_record" || camera.w === "stale");
}

function visibilityClass(lower: number, upper: number): string {
  const ladder = [...VISIBILITY_STEPS.map(([from]) => from), 20000];
  let floor = [...ladder].reverse().find(value => value <= lower) ?? 0;
  let ceiling = ladder.find(value => value > upper) ?? 20000;
  if (ceiling <= floor) { floor = 10000; ceiling = 20000; }
  return `visibility.${floor}_${ceiling}`;
}

// Derive grouped display variants from the already downloaded cameras. Original data stays intact.
export function siteForAltitude(site: SiteFeature, band: AltitudeBand, parameter: Parameter): SiteFeature | null {
  if (band === "all") return site;
  const cams = site.properties.cams.filter(camera => matchesAltitude(camera.altitude, band));
  if (cams.length === site.properties.cams.length) return site;
  return siteForCameras(site, cams, parameter);
}

export function siteForCountries(site: SiteFeature, countries: CountrySelection, parameter: Parameter): SiteFeature | null {
  const cams = site.properties.cams.filter(camera => countries.has(camera.country ?? null));
  return cams.length === site.properties.cams.length ? site : siteForCameras(site, cams, parameter);
}

export function siteForCameras(site: SiteFeature, cams: Camera[], parameter: Parameter): SiteFeature | null {
  if (!cams.length) return null;
  const counts = new Map<string, number>();
  for (const camera of cams) counts.set(camera.cls, (counts.get(camera.cls) ?? 0) + 1);
  const maximum = Math.max(...counts.values());
  const winners = [...counts].filter(([, count]) => count === maximum).map(([name]) => name);
  let cls = winners[0];
  if (parameter === "visibility") {
    const lowers = cams.flatMap(camera => camera.vl == null ? [] : [camera.vl]);
    const uppers = cams.flatMap(camera => camera.vu == null ? [] : [camera.vu]);
    cls = lowers.length && uppers.length ? visibilityClass(Math.min(...lowers), Math.max(...uppers)) : "white";
  }
  const tie = parameter === "snow" && winners.length > 1;
  return { ...site, geometry: { type: "Point", coordinates: [
    cams.reduce((sum, camera) => sum + camera.x, 0) / cams.length,
    cams.reduce((sum, camera) => sum + camera.y, 0) / cams.length,
  ] }, properties: { ...site.properties, cams, n: cams.length, cls,
    u: cams.some(camera => camera.u), tie, pie: tie ? cams.slice(0, 12).map(camera => camera.cls) : undefined } };
}

export function markerScale(value?: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(3, value) : 0.65;
}
