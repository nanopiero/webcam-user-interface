import type Dygraph from "dygraphs";
import type { DiagramMode, Parameter } from "../../api/contracts";
import { CLASS_COLOURS } from "../map/icons";
import { bounds, snowCategory } from "./series";
import type { prepareHistoryChart } from "./chartData";

interface PlotEvent {
  dygraph: Dygraph;
  drawingContext: CanvasRenderingContext2D;
  points: { idx: number; canvasx: number; canvasy: number }[];
  seriesIndex: number;
}

/** Individual bars/dots stay discrete even across long publication gaps. */
export function observationPlotter(prepared: ReturnType<typeof prepareHistoryChart>, parameter: Parameter, mode: DiagramMode) {
  return ({ dygraph, drawingContext: context, points, seriesIndex }: PlotEvent) => {
    const classes = mode === "classes", calibrated = mode === "calibrated";
    context.save();
    context.lineWidth = 1.3;
    for (const plotted of points) {
      const point = prepared.rows[plotted.idx]?.point;
      if (!point || !Number.isFinite(plotted.canvasy)) continue;
      const x = plotted.canvasx;
      if (seriesIndex === 1) {
        context.fillStyle = "#fff"; context.strokeStyle = "#8898a1";
        context.beginPath(); context.arc(x, plotted.canvasy, 2.8, 0, Math.PI * 2); context.fill(); context.stroke();
      } else if (classes) {
        const category = snowCategory(point.snow_class, point);
        if (category === null) continue;
        context.fillStyle = [CLASS_COLOURS["snow.none"], CLASS_COLOURS["snow.intermediate"], CLASS_COLOURS["snow.undifferentiated"], CLASS_COLOURS["snow.high"]][category];
        context.strokeStyle = [30, 31, 310].includes(point.snow_class!) ? "#c62828" : "#fff";
        context.beginPath(); context.arc(x, plotted.canvasy, 3.5, 0, Math.PI * 2); context.fill(); context.stroke();
      } else {
        const range = bounds(point, mode);
        context.strokeStyle = calibrated ? "#b66c24" : "#157e9c";
        if (range) {
          const lower = dygraph.toDomYCoord(prepared.transform(range[0]));
          const upper = dygraph.toDomYCoord(prepared.transform(range[1]));
          context.beginPath(); context.moveTo(x, lower); context.lineTo(x, upper);
          context.moveTo(x - 2, lower); context.lineTo(x + 2, lower);
          context.moveTo(x - 2, upper); context.lineTo(x + 2, upper); context.stroke();
        }
        if (parameter === "visibility" && calibrated && point.calibrated_center != null) {
          context.fillStyle = "#6e3a10";
          context.beginPath(); context.arc(x, dygraph.toDomYCoord(prepared.transform(point.calibrated_center)), 2.5, 0, Math.PI * 2); context.fill();
        }
      }
    }
    context.restore();
  };
}
