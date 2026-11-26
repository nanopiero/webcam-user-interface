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
  // read for. Callers that can show both use bandImage instead.
  if (band) return band.lower;
  return CLASS_COLOURS[name] ?? CLASS_COLOURS.white;
}

/**
 * Draw a pie fill and return it as image data MapLibre can register.
 * MapLibre draws the outer outline separately so it stays continuous at small sizes.
 *
 * Sites are rendered through map layers rather than HTML markers, so a
 * multi-sector marker has to become a sprite. Only a few hundred distinct
 * sector combinations occur in practice, so images are generated on demand and
 * cached by signature.
 */
export function pieImage(colours: string[], size = 34): ImageData {
  const scale = 2; // Drawn at twice the size so it stays crisp when scaled.
  const pixels = size * scale;
  const canvas = document.createElement("canvas");
  canvas.width = pixels;
  canvas.height = pixels;
  const context = canvas.getContext("2d")!;
  const centre = pixels / 2;
  const radius = centre - 2 * scale;
  const step = (Math.PI * 2) / colours.length;
  colours.forEach((colour, index) => {
    context.beginPath();
    context.moveTo(centre, centre);
    // Start at twelve o'clock so the first sector is where a reader looks.
    context.arc(centre, centre, radius, -Math.PI / 2 + index * step,
                -Math.PI / 2 + (index + 1) * step);
    context.closePath();
    context.fillStyle = colour;
    context.fill();
  });
  return context.getImageData(0, 0, pixels, pixels);
}

/**
 * Draw a visibility band as the legacy pictogram does: the upper bound's
 * colour above, the lower bound's below, divided by a line when they differ.
 *
 * A circle layer carries one colour per feature, so a band whose two bounds
 * fall in different steps cannot be drawn by it. This produces the equivalent
 * sprite, registered and cached exactly like a pie.
 */
export function bandImage(
  lower: string,
  upper: string,
  _uncertain: boolean,
  size = 34,
): ImageData {
  const scale = 2;
  const pixels = size * scale;
  const canvas = document.createElement("canvas");
  canvas.width = pixels;
  canvas.height = pixels;
  const context = canvas.getContext("2d")!;
  const centre = pixels / 2;
  const radius = centre - 2 * scale;

  const half = (colour: string, from: number, to: number) => {
    context.beginPath();
    context.moveTo(centre, centre);
    context.arc(centre, centre, radius, from, to);
    context.closePath();
    context.fillStyle = colour;
    context.fill();
  };
  // Canvas angles grow clockwise from three o'clock, so the upper half of the
  // disc is the half running from nine o'clock back to three.
  half(upper, Math.PI, 0);
  half(lower, 0, Math.PI);

  if (lower !== upper) {
    context.beginPath();
    context.moveTo(centre - radius, centre);
    context.lineTo(centre + radius, centre);
    context.lineWidth = 1.2 * scale;
    context.strokeStyle = "#222";
    context.stroke();
  }
  // Outer outlines use a native circle layer, independent of sprite downscaling.
  return context.getImageData(0, 0, pixels, pixels);
}

