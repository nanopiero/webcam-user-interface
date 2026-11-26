import type { Camera, SiteFeature } from "../../api/contracts";

type Coordinates = [number, number];
interface Pixel { x: number; y: number }

export function groupMarkerFactor(cameraCount: number): number {
  return cameraCount > 1 ? 1.5 : 1;
}

/** Spread overlapping views in screen space; published camera coordinates remain unchanged. */
export function expandedCameraPositions(site: SiteFeature,
  project: (coordinates: Coordinates) => Pixel,
  unproject: (pixel: Pixel) => Coordinates): { camera: Camera; coordinates: Coordinates }[] {
  const cameras = site.properties.cams;
  const pixels = cameras.map(camera => project([camera.x, camera.y]));
  const overlap = pixels.some((point, index) => pixels.slice(0, index).some(other =>
    Math.hypot(point.x - other.x, point.y - other.y) < 26));
  const centre = project(site.geometry.coordinates);
  const radius = Math.max(17, cameras.length * 2);
  return cameras.map((camera, index) => {
    if (!overlap) return { camera, coordinates: [camera.x, camera.y] as Coordinates };
    const angle = index / cameras.length * 2 * Math.PI - Math.PI / 2;
    return { camera, coordinates: unproject({ x: centre.x + radius * Math.cos(angle),
      y: centre.y + radius * Math.sin(angle) }) };
  });
}
