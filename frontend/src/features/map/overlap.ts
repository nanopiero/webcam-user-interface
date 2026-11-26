import type { Camera, SiteFeature, SupplementaryFeature } from "../../api/contracts";

export type WebcamTarget = { kind: "observed"; site: SiteFeature; camera?: Camera }
  | { kind: "supplementary"; webcam: SupplementaryFeature };
export interface Pixel { x: number; y: number }
export interface ClickMarker { centre: Pixel; radius: number; target: WebcamTarget }

/** Keep the existing four-pixel click tolerance; ignore sprite padding and draw order. */
export function markersAtPoint(markers: ClickMarker[], point: Pixel): WebcamTarget[] {
  return markers.filter(({ centre, radius }) => {
    const dx = Math.max(0, Math.abs(centre.x - point.x) - 4);
    const dy = Math.max(0, Math.abs(centre.y - point.y) - 4);
    return dx * dx + dy * dy <= radius * radius;
  }).map(marker => marker.target);
}

export function targetKey(target: WebcamTarget): string {
  return target.kind === "supplementary" ? `additional:${target.webcam.properties.id}`
    : `weow:${target.camera?.p ?? target.site.properties.id}`;
}

export function targetName(target: WebcamTarget): string {
  return target.kind === "supplementary" ? target.webcam.properties.name
    : target.camera?.name ?? target.site.properties.name ?? target.site.properties.platform;
}

/** Every group contributes its individual views, even when it is the only marker hit. */
export function webcamChoices(targets: WebcamTarget[]): WebcamTarget[] {
  const choices = new Map<string, WebcamTarget>();
  for (const target of targets) {
    const views: WebcamTarget[] = target.kind === "observed" && !target.camera
      ? target.site.properties.cams.map(camera => ({ ...target, camera })) : [target];
    for (const view of views) choices.set(targetKey(view), view);
  }
  return [...choices.values()].sort((a, b) => targetName(a).localeCompare(targetName(b))
    || targetKey(a).localeCompare(targetKey(b)));
}
