import type { DiagramMode } from "../../api/contracts";
import type { prepareHistoryChart } from "./chartData";
import { bounds, snowCategory } from "./series";

/** Hit-test the painted interval, not just Dygraphs' representative ordinate. */
export function hitHistoryObservation(prepared: ReturnType<typeof prepareHistoryChart>, mode: DiagramMode,
  x: number, y: number, from: number, to: number,
  projectX: (time: number) => number, projectY: (value: number) => number) {
  const rows = prepared.rows;
  let low = 0, high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rows[middle].time < from) low = middle + 1;
    else high = middle;
  }
  let picked = null, best = Infinity;
  for (let index = low; index < rows.length && rows[index].time <= to; index++) {
    const { point, time } = rows[index];
    if (!point) continue;
    const category = snowCategory(point.snow_class, point), range = bounds(point, mode);
    const centre = mode === "calibrated" ? point.calibrated_center : null;
    const values = mode === "classes" ? [category ?? prepared.unavailable]
      : range ? range.map(prepared.transform) : [centre == null ? prepared.unavailable : prepared.transform(centre)];
    const projected = values.map(projectY);
    const above = Math.min(...projected), below = Math.max(...projected);
    const dx = Math.abs(projectX(time) - x), dy = Math.max(above - y, y - below, 0);
    const score = dx * dx + dy * dy;
    if (dx <= 8 && dy <= 6 && score < best) { best = score; picked = point; }
  }
  return picked;
}
