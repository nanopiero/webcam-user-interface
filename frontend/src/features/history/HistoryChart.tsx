import { useEffect, useMemo, useRef, useState } from "react";
import Dygraph, { type dygraphs } from "dygraphs";
import "dygraphs/dist/dygraph.css";
import type { DiagramMode, FrontendConfiguration, HistoryPoint, Parameter } from "../../api/contracts";
import { number, utc } from "../../shared/format";
import { HIGH_SNOW_COLOUR } from "../map/icons";
import { CHART_SERIES, prepareHistoryChart, SNOW_CATEGORIES } from "./chartData";
import { observationPlotter } from "./chartPlotter";
import { hitHistoryObservation } from "./chartHover";
import HistoryReadout from "./HistoryReadout";

interface Props {
  points: HistoryPoint[];
  parameter: Parameter;
  mode: DiagramMode;
  start: string;
  end: string;
  mapTime: string | null;
  configuration: FrontendConfiguration;
  onResetPeriod: () => void;
}

export default function HistoryChart({ points, parameter, mode, start, end, mapTime, configuration, onResetPeriod }: Props) {
  const host = useRef<HTMLDivElement>(null), guide = useRef<HTMLDivElement>(null);
  const graph = useRef<Dygraph | null>(null);
  const mapTimeRef = useRef(mapTime);
  mapTimeRef.current = mapTime;
  const selected = useRef<number | null>(null);
  const [hovered, setHovered] = useState<HistoryPoint | null>(null);
  const [tooltip, setTooltip] = useState<{ left: number; top: number } | null>(null);
  const [window, setWindow] = useState<[number, number]>([Date.parse(start), Date.parse(end)]);
  const prepared = useMemo(() => prepareHistoryChart(points, parameter, mode, configuration, start, end),
    [points, parameter, mode, configuration, start, end]);
  const classes = mode === "classes", calibrated = mode === "calibrated";
  const { thresholdsVisible } = prepared;
  const { ceiling_metres: ceiling } = configuration.visibility_display;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    selected.current = null; setHovered(null); setTooltip(null);
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
      labels: ["Time", ...CHART_SERIES.slice(0, thresholdsVisible ? 4 : 2)],
      labelsUTC: true, legend: "never", animatedZooms: false,
      interactionModel: Dygraph.defaultInteractionModel,
      dateWindow: [Date.parse(start), Date.parse(end)], valueRange: prepared.valueRange,
      customBars: false, connectSeparatedPoints: false, drawPoints: false,
      highlightCircleSize: 0, strokeWidth: 0, rightGap: 10,
      showRangeSelector: false,
      axisLabelFontSize: 10, axisLineColor: "#bac9d1", gridLineColor: "#e7edf0",
      ylabel: classes ? undefined : calibrated ? "Visibility (m)" : "Raw model value",
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
      },
      series: {
        Prediction: { plotter },
        Unavailable: { plotter },
        ...Object.fromEntries((thresholdsVisible ? CHART_SERIES.slice(2) : []).map((name, index) => [name, {
          color: index ? HIGH_SNOW_COLOUR : "#222222",
          stepPlot: true, strokeWidth: 1.3, strokePattern: index ? [3, 3] : [6, 3],
          drawPoints: true, pointSize: 1.5,
        }])),
      },
      drawCallback: drawGuide,
    };
    const instance = new Dygraph(element, prepared.data, options);
    graph.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    return () => { observer.disconnect(); instance.destroy(); graph.current = null; };
  }, [prepared, parameter, mode, start, end, thresholdsVisible, classes, calibrated, ceiling]);

  // The guide follows the map without recreating the graph or losing its zoom.
  useEffect(() => { graph.current?.updateOptions({}); }, [mapTime]);

  function resetView() {
    graph.current?.resetZoom();
    setTooltip(null);
    onResetPeriod();
  }
  const mapStamp = mapTime ? Date.parse(mapTime) : NaN;
  const outside = Number.isFinite(mapStamp) && (mapStamp < window[0] || mapStamp > window[1]);

  return <div className="history-chart">
    <div className="chart-keys" aria-label="Chart legend">
      <span><i className="chart-key map-time-key" />Map time: {utc(mapTime)}{outside && " · outside visible range"}</span>
      {thresholdsVisible && <><span><i className="chart-key lower-threshold-key" />Lower snow threshold</span>
        <span><i className="chart-key upper-threshold-key" />Upper snow threshold</span>
        {!prepared.hasThresholds && <span>No thresholds published in this range</span>}</>}
      <button className="quiet chart-reset" onClick={resetView} title="Reset zoom and Earlier/Later navigation">Reset view</button>
    </div>
    <div className="chart-viewport">
      <div ref={host} className="dygraph-chart" role="img" tabIndex={0}
        aria-label={`${parameter} ${classes ? "categorical classes" : `${mode} prediction intervals`}, UTC. ${points.length} observations. Drag to zoom; use arrow keys to inspect observations.`}
        onDoubleClickCapture={event => {
          if (event.altKey || event.shiftKey) return;
          event.preventDefault(); event.stopPropagation(); resetView();
        }}
        onPointerDown={() => setTooltip(null)}
        onPointerMove={event => {
          const instance = graph.current;
          if (!instance || event.buttons) { setTooltip(null); return; }
          const box = event.currentTarget.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
          const area = instance.getArea();
          const point = x < area.x || x > area.x + area.w || y < area.y || y > area.y + area.h ? null
            : hitHistoryObservation(prepared, mode, x, y, instance.toDataXCoord(x - 8), instance.toDataXCoord(x + 8),
              time => instance.toDomXCoord(time), value => instance.toDomYCoord(value));
          selected.current = point?.id ?? null; setHovered(point);
          setTooltip(point ? { left: Math.max(6, Math.min(x + 12, box.width - Math.min(265, box.width - 12))), top: y + 10 } : null);
        }}
        onPointerLeave={() => { setTooltip(null); setHovered(null); selected.current = null; }}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !points.length) return;
          event.preventDefault();
          const current = selected.current === null ? -1 : points.findIndex(point => point.id === selected.current);
          const next = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : current + (event.key === "ArrowLeft" ? -1 : 1);
          const point = points[Math.max(0, Math.min(points.length - 1, next))];
          selected.current = point.id; setHovered(point); setTooltip(null);
          graph.current?.setSelection(prepared.pointRows.get(point.id)!);
        }} />
      <div ref={guide} className="chart-map-time" aria-hidden="true" hidden />
      {tooltip && hovered && <div className="chart-tooltip" role="tooltip" style={tooltip}>
        <HistoryReadout point={hovered} parameter={parameter} mode={mode} />
      </div>}
    </div>
    <div className="chart-readout" aria-live="polite">
      {hovered ? <HistoryReadout point={hovered} parameter={parameter} mode={mode} />
        : <span>The black vertical line marks the selected map date and time.</span>}
    </div>
  </div>;
}
