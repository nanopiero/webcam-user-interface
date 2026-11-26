import type { Map as LibreMap } from "maplibre-gl";
import { MARKER_RADIUS, markerImage, type MarkerSector } from "./icons";
import { SMALL_DOT_RADIUS } from "./presentation";

interface Options { small?: boolean; uncertain?: boolean; group?: number; supplementary?: boolean }

/** Cache complete marker images by appearance, independently of webcam identity. */
export function markerSprite(map: LibreMap, sectors: MarkerSector[], options: Options = {}): string {
  const colour = options.supplementary ? "#ffffff" : options.uncertain ? "#c62828" : "#222222";
  const width = options.small
    ? (options.supplementary ? 0.6 : options.uncertain ? 1.6 : 1) * MARKER_RADIUS / SMALL_DOT_RADIUS
    : (options.uncertain ? 3.2 : 2) / (options.group ?? 1);
  const outline = { colour, width };
  const key = JSON.stringify([sectors, outline]);
  if (!map.hasImage(key)) map.addImage(key, markerImage(sectors, outline), { pixelRatio: 2 });
  return key;
}
