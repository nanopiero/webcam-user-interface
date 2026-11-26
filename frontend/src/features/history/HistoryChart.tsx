import { useEffect, useMemo, useRef, useState } from "react";
import Dygraph, { type dygraphs } from "dygraphs";
import "dygraphs/dist/dygraph.css";
import type { DiagramMode, FrontendConfiguration, HistoryPoint, Parameter } from "../../api/contracts";
import { interval, number, utc } from "../../shared/format";
import { HIGH_SNOW_COLOUR } from "../map/icons";
import { CHART_SERIES, prepareHistoryChart, SNOW_CATEGORIES } from "./chartData";
import { observationPlotter } from "./chartPlotter";
import { snowClassLabel } from "./series";

interface Props {
  points: HistoryPoint[];
  parameter: Parameter;
  mode: DiagramMode;
  start: string;
  end: string;
  mapTime: string | null;
  configuration: FrontendConfiguration;
}

export default function HistoryChart({ points, parameter, mode, start, end, mapTime, configuration }: Props) {
  const host = useRef<HTMLDivElement>(null), guide = useRef<HTMLDivElement>(null);
  const graph = useRef<Dygraph | null>(null);
  const mapTimeRef = useRef(mapTime);
  mapTimeRef.current = mapTime;
  const selected = useRef<number | null>(null);
  const [hovered, setHovered] = useState<HistoryPoint | null>(null);
  const [window, setWindow] = useState<[number, number]>([Date.parse(start), Date.parse(end)]);
  const prepared = useMemo(() => prepareHistoryChart(points, parameter, mode, configuration, start, end),
    [points, parameter, mode, configuration, start, end]);
  const classes = mode === "classes", snow = parameter === "snow", calibrated = mode === "calibrated";
  const thresholdAxis = classes && prepared.hasThresholds;
  const { ceiling_metres: ceiling } = configuration.visibility_display;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    selected.current = null; setHovered(null);
    const drawGuide = (instance: Readonly<Dygraph>) => {
      const visible = instance.xAxisRange();
      element.dataset.windowStart = String(visible[0]); element.dataset.windowEnd = String(visible[1]);
      setWindow(previous => previous[0] === visible[0] && previous[1] === visible[1] ? previous : visible);
      if (!guide.current) return;
      const time = mapTimeRef.current ? Date.parse(mapTimeRef.current) : NaN;
      const area = instance.getArea(), x = instance.toDomXCoord(time);
      guide.current.hidden = !Number.isFinite(time) || time < visible[0] || time > visible[1];
      guide.current.style.left = `${Math.max(area.x, Math.min(area.x + area.w - 2, x))}px`;
      guide.current.style.top = `${area.y}px`; guide.current.style.height = `${area.h}px`;
      guide.current.dataset.mapTime = String(time);
    };
    const plotter = observationPlotter(prepared, parameter, mode);
    const options: dygraphs.Options = {
      labels: ["Time", ...CHART_SERIES.slice(0, snow ? 4 : 2)],
      labelsUTC: true, legend: "never", animatedZooms: false,
      interactionModel: Dygraph.defaultInteractionModel,
      dateWindow: [Date.parse(start), Date.parse(end)], valueRange: prepared.valueRange,
      customBars: false, connectSeparatedPoints: false, drawPoints: false,
      highlightCircleSize: 0, strokeWidth: 0, rightGap: 10,
      showRangeSelector: true, rangeSelectorHeight: 28,
      rangeSelectorPlotStrokeColor: "#5d8797", rangeSelectorPlotFillColor: "#e8f1f4",
      axisLabelFontSize: 10, axisLineColor: "#bac9d1", gridLineColor: "#e7edf0",
      ylabel: classes ? undefined : calibrated ? "Visibility (m)" : "Raw model value",
      y2label: thresholdAxis ? "Thresholds (raw)" : undefined,
      axes: {
        x: { pixelsPerLabel: 85, axisLabelWidth: 70 },
        y: { axisLabelWidth: classes ? 96 : 65,
          ticker: classes ? () => [{ v: prepared.unavailable, label: "Unavailable" },
            ...SNOW_CATEGORIES.map((label, v) => ({ v, label }))]
            : (min, max, pixels, opts, instance, vals) => [
              ...(prepared.unavailable >= min && prepared.unavailable <= max ? [{ v: prepared.unavailable, label: "Unavailable" }] : []),
              ...Dygraph.numericTicks(min, max, pixels, opts, instance, vals)
                .filter(tick => tick.v > prepared.unavailable + (max - min) * 0.07),
            ],
          axisLabelFormatter: value => calibrated && Number(value) > ceiling ? `>${number(ceiling, 0)}` : number(Number(value), calibrated ? 0 : 2),
        },
        y2: { drawAxis: thresholdAxis, independentTicks: true, drawGrid: false,
          axisLabelWidth: 38, valueRange: prepared.thresholdRange },
      },
      series: {
        Prediction: { plotter, showInRangeSelector: true },
        Unavailable: { plotter, showInRangeSelector: false },
        ...Object.fromEntries(["Lower snow threshold", "Upper snow threshold"].map((name, index) => [name, {
          axis: classes ? "y2" : "y1", color: index ? HIGH_SNOW_COLOUR : "#222222",
          stepPlot: true, strokeWidth: 1.3, strokePattern: index ? [3, 3] : [6, 3],
          drawPoints: true, pointSize: 1.5, showInRangeSelector: false,
        }])),
      },
      highlightCallback: (_event, _x, _points, row) => {
        const point = prepared.rows[row]?.point;
        if (point) { selected.current = point.id; setHovered(point); }
      },
      unhighlightCallback: () => { selected.current = null; setHovered(null); },
      drawCallback: drawGuide,
    };
    const instance = new Dygraph(element, prepared.data, options);
    // Dygraphs' decorative handle images have no alt text of their own.
    element.querySelectorAll<HTMLImageElement>(".dygraph-rangesel-zoomhandle").forEach(handle => { handle.alt = ""; });
    graph.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    return () => { observer.disconnect(); instance.destroy(); graph.current = null; };
  }, [prepared, parameter, mode, start, end, snow, classes, calibrated, thresholdAxis, ceiling]);

  // The guide follows the map without recreating the graph or losing its zoom.
  useEffect(() => { graph.current?.updateOptions({}); }, [mapTime]);

  function zoom(factor: number) {
    const instance = graph.current;
    if (!instance) return;
    const [left, right] = instance.xAxisRange(), fullStart = Date.parse(start), fullEnd = Date.parse(end);
    const width = Math.min(fullEnd - fullStart, Math.max(1000, (right - left) * factor));
    const nextStart = Math.max(fullStart, Math.min(fullEnd - width, (left + right - width) / 2));
    instance.updateOptions({ dateWindow: [nextStart, nextStart + width] });
  }
  const mapStamp = mapTime ? Date.parse(mapTime) : NaN;
  const outside = Number.isFinite(mapStamp) && (mapStamp < window[0] || mapStamp > window[1]);

  return <div className="history-chart">
    <div className="chart-keys" aria-label="Chart legend">
      <span><i className="chart-key map-time-key" />Map time: {utc(mapTime)}{outside && " · outside visible range"}</span>
      {snow && <><span><i className="chart-key lower-threshold-key" />Lower snow threshold</span>
        <span><i className="chart-key upper-threshold-key" />Upper snow threshold</span>
        {!prepared.hasThresholds && <span>No thresholds published in this range</span>}</>}
    </div>
    <div className="chart-viewport">
      <div ref={host} className="dygraph-chart" role="img" tabIndex={0}
        aria-label={`${parameter} ${classes ? "categorical classes" : `${mode} prediction intervals`}, UTC. ${points.length} observations. Drag to zoom; use arrow keys to inspect observations.`}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !points.length) return;
          event.preventDefault();
          const current = selected.current === null ? -1 : points.findIndex(point => point.id === selected.current);
          const next = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : current + (event.key === "ArrowLeft" ? -1 : 1);
          const point = points[Math.max(0, Math.min(points.length - 1, next))];
          selected.current = point.id; setHovered(point);
          graph.current?.setSelection(prepared.pointRows.get(point.id)!);
        }} />
      <div ref={guide} className="chart-map-time" aria-hidden="true" hidden />
    </div>
    <div className="chart-navigation"><div className="segmented" aria-label="Chart zoom">
      <button onClick={() => zoom(0.5)}>Zoom in</button><button onClick={() => zoom(2)}>Zoom out</button>
      <button onClick={() => graph.current?.resetZoom()}>Reset zoom</button>
    </div><span>Drag to zoom · Shift-drag to pan · Double-click to reset · Pinch on touchscreens</span></div>
    <div className="chart-readout" aria-live="polite">
      {hovered ? <><strong>{utc(hovered.t)}</strong>{!classes && <span>Interval: {mode === "raw" ? interval(hovered.lower, hovered.upper) : interval(hovered.calibrated_lower, hovered.calibrated_upper, "m")}</span>}
        {calibrated && <span>Published centre: {number(hovered.calibrated_center)} m</span>}
        {snow && <><span>Class: {snowClassLabel(hovered.snow_class, hovered)}</span>
          <span>Lower snow threshold: {number(hovered.snow_threshold_low, 6)}</span>
          <span>Upper snow threshold: {number(hovered.snow_threshold_high, 6)}</span></>}
        <span>Model: {hovered.model_version ?? "not supplied"} · QC: {hovered.quality_code ?? "not supplied"}</span></>
        : <span>{classes ? "Coloured dots show published snow classes; white dots mark unavailable classes." : "Bars show published intervals; white dots on the unavailable row mark missing results."} Hover or use arrow keys for exact values. All times are UTC.</span>}
    </div>
  </div>;
}
