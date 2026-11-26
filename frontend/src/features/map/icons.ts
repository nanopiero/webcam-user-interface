// Adapted from the reference admin UI: ui/src/icons.ts.
// Only published snow/visibility classifications and sprite rendering are retained.

export const WHITE = "white";
export const HIGH_SNOW_COLOUR = "#d000ff";

export const CLASS_COLOURS: Record<string, string> = {
  // Snow: increasing cover, light to dark.
  "snow.none": "#8c9196",
  "snow.intermediate": "#7fc3e8",
  "snow.undifferentiated": "#1f6fb2",
  "snow.high": HIGH_SNOW_COLOUR,
  // No usable calibrated prediction, for any of the §2 reasons.
  white: "#ffffff",
};

// Visibility: the legacy fog palette, read out of the pictogram set itself
// (pictos/pictos_fog, 45 band images). Each image is a two-tone disc whose
// lower half carries the colour of the step at the band's lower bound and
// whose upper half carries the step ending at its upper bound, so one colour
// per step of the §8.1 ladder is the whole palette. Keyed by the step's lower
// bound; 20000 appears so an upper bound of 20000 resolves like any other.
export const VISIBILITY_STEP_COLOURS: Record<number, string> = {
  0: "#000044",
  200: "#5a00a1",
  500: "#8c008c",
  1000: "#a00050",
  1500: "#ff0000",
  3000: "#ff8c00",
  5000: "#ffff00",
  8000: "#7fff00",
  10000: "#d3d3d3",
  20000: "#d3d3d3",
};

// The ladder, lowest step first, for the legend.
export const VISIBILITY_STEPS: Array<[number, number]> = [
  [0, 200], [200, 500], [500, 1000], [1000, 1500], [1500, 3000],
  [3000, 5000], [5000, 8000], [8000, 10000], [10000, 20000],
];

/**
 * The two colours of a visibility band, or null when the name is not one.
 *
 * Band names are `visibility.<lower>_<upper>` in metres, as
 * weow_ml.ui.icons.visibility_class writes them. The bounds are read from the
 * name rather than from a table of the 45 combinations: the ladder is what
 * generates both, so parsing cannot disagree with the backend.
 */
export function visibilityBandColours(
  name?: string | null,
): { lower: string; upper: string } | null {
  if (!name) return null;
  const match = /^visibility\.(\d+)_(\d+)$/.exec(name);
  if (!match) return null;
  const lower = VISIBILITY_STEP_COLOURS[Number(match[1])];
  // The upper bound closes a step, so it takes the colour of the step below it.
  const steps = VISIBILITY_STEPS.map(([from]) => from).concat(20000);
  const index = steps.indexOf(Number(match[2]));
  const upper = index > 0 ? VISIBILITY_STEP_COLOURS[steps[index - 1]] : lower;
  if (!lower || !upper) return null;
  return { lower, upper };
}

export function classColour(name?: string | null): string {
  if (!name) return CLASS_COLOURS.white;
  const band = visibilityBandColours(name);
  // A band needs two colours, so a caller that can only take one is given the
  // lower bound's: it is the pessimistic end, which is what a fog warning is
  // read for. Callers that can show both use markerImage instead.
  if (band) return band.lower;
  return CLASS_COLOURS[name] ?? CLASS_COLOURS.white;
}

/**
 * Draw camera sectors, preserving each visibility band's two colours.
 * The outer outline is part of the image, so overlapping markers remain whole.
 * Ageing sectors retain their coloured centre and have a white outer ring.
 * The same renderer serves single cameras and grouped sites.
 */
export interface MarkerSector { lower: string; upper: string; ageing: boolean }
export const MARKER_RADIUS = 15;
export interface MarkerOutline { colour: string; width: number }

export function markerImage(sectors: MarkerSector[], outline: MarkerOutline): ImageData {
  const size = 46; // Includes transparent padding for fixed-size small-dot outlines.
  const scale = 2;
  const pixels = size * scale;
  const canvas = document.createElement("canvas");
  canvas.width = pixels;
  canvas.height = pixels;
  const context = canvas.getContext("2d")!;
  const centre = pixels / 2;
  const radius = MARKER_RADIUS * scale;
  const step = (Math.PI * 2) / sectors.length;
  const wedge = (radius: number, from: number, to: number) => {
    context.beginPath();
    context.moveTo(centre, centre);
    context.arc(centre, centre, radius, from, to);
    context.closePath();
  };
  sectors.forEach(({ lower, upper, ageing }, index) => {
    const from = -Math.PI / 2 + index * step;
    const to = from + step;
    context.save();
    wedge(radius, from, to);
    context.clip();
    wedge(radius, Math.PI, Math.PI * 2);
    context.fillStyle = upper;
    context.fill();
    wedge(radius, 0, Math.PI);
    context.fillStyle = lower;
    context.fill();
    if (lower !== upper) {
      context.beginPath();
      context.moveTo(centre - radius, centre);
      context.lineTo(centre + radius, centre);
      context.lineWidth = 1.2 * scale;
      context.strokeStyle = "#222";
      context.stroke();
    }
    if (ageing) {
      // Clip the white ring to this camera's sector; keep its centre coloured.
      context.beginPath();
      context.arc(centre, centre, radius * 0.82, from, to);
      context.lineWidth = radius * 0.36;
      context.strokeStyle = "#ffffff";
      context.stroke();
    }
    context.restore();
  });
  // Place the stroke outside the fill, preserving the coloured disc's radius.
  context.beginPath();
  context.arc(centre, centre, radius + outline.width * scale / 2, 0, Math.PI * 2);
  context.lineWidth = outline.width * scale;
  context.strokeStyle = outline.colour;
  context.stroke();
  return context.getImageData(0, 0, pixels, pixels);
}

