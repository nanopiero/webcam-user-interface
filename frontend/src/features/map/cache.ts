import type { Camera, MapPayload, SiteFeature } from "../../api/contracts";
import type { CountrySelection } from "./countries";
import { siteForCameras } from "./presentation";

/** Replace refreshed countries, including deletions, and retain hidden cached countries. */
export function mergeMapPayload(previous: MapPayload | null, incoming: MapPayload, refreshed: CountrySelection): MapPayload {
  const groups = new Map<string, { site: SiteFeature; cameras: Map<string, Camera> }>();
  function add(site: SiteFeature, cams: Camera[]) {
    let group = groups.get(site.properties.id);
    if (!group) { group = { site, cameras: new Map() }; groups.set(site.properties.id, group); }
    else group.site = site;
    for (const camera of cams) group.cameras.set(camera.p, camera);
  }
  for (const site of previous?.features ?? []) add(site, site.properties.cams.filter(camera => !refreshed.has(camera.country ?? null)));
  for (const site of incoming.features) add(site, site.properties.cams);
  const features = [...groups.values()].flatMap(({ site, cameras }) => {
    const feature = siteForCameras(site, [...cameras.values()], incoming.parameter);
    return feature ? [feature] : [];
  });
  return { ...incoming, features, counts: { sites: features.length,
    cameras: features.reduce((total, feature) => total + feature.properties.n, 0) } };
}
