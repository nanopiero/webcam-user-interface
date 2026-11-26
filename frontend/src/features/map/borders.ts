import type { Map } from "maplibre-gl";
import type { BorderVisibility } from "../../api/contracts";
import { borderLayersForROI } from "./roi";

export function addBorderLayers(map: Map, visibility: BorderVisibility, roi: string): void {
  for (const layer of borderLayersForROI(roi)) {
    const id = `border-${layer.key}`;
    map.addSource(id, { type: "geojson", data: layer.url, attribution: layer.attribution });
    map.addLayer({ id, type: "line", source: id,
      layout: { visibility: visibility[layer.key] ? "visible" : "none" },
      paint: { "line-color": layer.colour, "line-width": layer.width, "line-opacity": 0.9 } });
  }
}

export function showBorderLayers(map: Map, visibility: BorderVisibility): void {
  for (const key of ["national", "regions", "departments"] as const) {
    if (map.getLayer(`border-${key}`)) map.setLayoutProperty(`border-${key}`, "visibility", visibility[key] ? "visible" : "none");
  }
}
