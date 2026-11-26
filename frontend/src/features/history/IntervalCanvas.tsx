import { useEffect, useRef, useState } from "react";
import type { DiagramMode, FrontendConfiguration, HistoryPoint, Parameter } from "../../api/contracts";
import { interval, number, utc } from "../../shared/format";
import { bounds, closestPoint, displayValue, snowCategory, snowClassLabel } from "./series";
import { CLASS_COLOURS, HIGH_SNOW_COLOUR } from "../map/icons";

interface Props {
  points: HistoryPoint[];
  parameter: Parameter;
  mode: DiagramMode;
  start: string;
  end: string;
  configuration: FrontendConfiguration;
}
const LEFT = 64, RIGHT = 18, TOP = 18, BOTTOM = 44;

export default function IntervalCanvas({ points, parameter, mode, start, end, configuration }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<HistoryPoint | null>(null);
  const [width, setWidth] = useState(600);
  const height = 218;
  const from = Date.parse(start), to = Date.parse(end);
  const calibrated = parameter === "visibility" && mode === "calibrated";
  const classes = mode === "classes";
  const left = classes ? 122 : LEFT;
  const { ceiling_metres: ceiling, saturated_band_metres: saturatedBand } = configuration.visibility_display;

  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width)));
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = width * ratio;
    element.height = height * ratio;
    const context = element.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const plotWidth = width - left - RIGHT, plotHeight = height - TOP - BOTTOM;
    let minimum = 0, maximum = 1;
    for (const point of points) {
      const values: number[] = bounds(point, mode) ?? [];
      if (parameter === "snow" && mode === "raw") {
        if (point.snow_threshold_low != null) values.push(point.snow_threshold_low);
        if (point.snow_threshold_high != null) values.push(point.snow_threshold_high);
      }
      if (calibrated && point.calibrated_center != null) values.push(point.calibrated_center);
      for (const value of values) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
    }
    if (classes) { minimum = -0.6; maximum = 3.6; }
    else if (calibrated) { minimum = 0; maximum = ceiling + (maximum > ceiling ? saturatedBand : 0); }
    else { const pad = (maximum - minimum) * 0.06; minimum -= pad; maximum += pad; }
    const x = (stamp: string) => left + (Date.parse(stamp) - from) / Math.max(1, to - from) * plotWidth;
    const y = (value: number) => TOP + plotHeight * (1 - ((calibrated ? displayValue(value, ceiling, saturatedBand) : value) - minimum) / (maximum - minimum));
    context.font = "11px system-ui";
    context.textBaseline = "middle";
    for (let tick = 0; tick <= (classes ? 3 : 4); tick++) {
      const value = classes ? tick : minimum + (maximum - minimum) * tick / 4;
      const row = classes ? y(tick) : TOP + plotHeight * (1 - tick / 4);
      context.strokeStyle = "#e4e9ed";
      context.beginPath(); context.moveTo(left, row); context.lineTo(width - RIGHT, row); context.stroke();
      context.fillStyle = "#63727d"; context.textAlign = "right";
      context.fillText(classes ? ["No snow", "Intermediate", "Undifferentiated", "High snow cover"][tick] : calibrated && value > ceiling ? `>${number(ceiling, 0)}` : number(value, calibrated ? 0 : 2), left - 8, row);
    }
    if (calibrated && maximum > ceiling) {
      context.fillStyle = "rgba(140,150,160,.09)";
      context.fillRect(left, TOP, plotWidth, y(ceiling) - TOP);
    }
    context.save(); context.beginPath(); context.rect(left, TOP, plotWidth, plotHeight); context.clip();
    for (const point of points) {
      const at = x(point.t), range = bounds(point, mode);
      if (classes) {
        const category = snowCategory(point.snow_class, point);
        if (category !== null) {
          context.fillStyle = [CLASS_COLOURS["snow.none"], CLASS_COLOURS["snow.intermediate"], CLASS_COLOURS["snow.undifferentiated"], CLASS_COLOURS["snow.high"]][category];
          context.strokeStyle = (point.snow_class ?? 0) >= 30 ? "#c62828" : "#fff";
          context.beginPath(); context.arc(at, y(category), 3.5, 0, Math.PI * 2); context.fill(); context.stroke();
        }
        continue;
      }
      context.strokeStyle = calibrated ? "#d47b28" : "#157e9c";
      context.globalAlpha = 0.65;
      context.lineWidth = 1.4;
      if (range) {
        context.beginPath(); context.moveTo(at, y(range[0])); context.lineTo(at, y(range[1])); context.stroke();
        for (const value of range) { context.beginPath(); context.moveTo(at - 2, y(value)); context.lineTo(at + 2, y(value)); context.stroke(); }
      }
      if (parameter === "snow" && mode === "raw") {
        context.globalAlpha = 1;
        for (const [value, colour] of [[point.snow_threshold_low, "#222222"], [point.snow_threshold_high, HIGH_SNOW_COLOUR]] as const) {
          if (value == null) continue;
          context.strokeStyle = colour;
          context.beginPath(); context.moveTo(at - 3, y(value)); context.lineTo(at + 3, y(value)); context.stroke();
        }
      }
      // Only a centre explicitly supplied by the publisher is drawn.
      if (calibrated && point.calibrated_center != null) {
        context.fillStyle = "#6e3a10"; context.beginPath(); context.arc(at, y(point.calibrated_center), 2, 0, Math.PI * 2); context.fill();
      }
    }
    context.restore(); context.globalAlpha = 1;
    context.fillStyle = "#63727d"; context.textBaseline = "top";
    for (let tick = 0; tick <= 3; tick++) {
      const stamp = new Date(from + (to - from) * tick / 3);
      context.textAlign = tick === 0 ? "left" : tick === 3 ? "right" : "center";
      const at = left + plotWidth * tick / 3;
      context.fillText(stamp.toISOString().slice(11, 16), at, height - 32);
      context.fillText(stamp.toISOString().slice(5, 10), at, height - 18);
    }
    for (const point of points) if (classes ? snowCategory(point.snow_class, point) === null : !bounds(point, mode)) {
      if (classes) {
        context.fillStyle = "#fff"; context.strokeStyle = "#9da9af";
        context.beginPath(); context.arc(x(point.t), height - BOTTOM - 3, 2.5, 0, Math.PI * 2); context.fill(); context.stroke();
      } else { context.fillStyle = "#b08b8b"; context.fillRect(x(point.t) - 1, height - BOTTOM + 2, 2, 4); }
    }
    if (hovered) {
      context.strokeStyle = "#4d6473"; context.setLineDash([3, 3]);
      context.beginPath(); context.moveTo(x(hovered.t), TOP); context.lineTo(x(hovered.t), height - BOTTOM); context.stroke();
    }
  }, [points, parameter, mode, calibrated, classes, left, ceiling, saturatedBand, from, to, width, hovered]);

  return <div className="interval-chart">
    <canvas ref={canvas} style={{ height }} role="img" tabIndex={0} aria-label={`${parameter} ${classes ? "categorical classes" : `${mode} prediction intervals`}, UTC. ${points.length} observations. Use arrow keys to inspect observations.`}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !points.length) return;
        event.preventDefault();
        const current = hovered ? points.findIndex(point => point.id === hovered.id) : -1;
        const next = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : current + (event.key === "ArrowLeft" ? -1 : 1);
        setHovered(points[Math.max(0, Math.min(points.length - 1, next))]);
      }}
      onMouseMove={event => {
        const offset = event.clientX - event.currentTarget.getBoundingClientRect().left;
        setHovered(closestPoint(points, from + Math.max(0, Math.min(1, (offset - left) / (width - left - RIGHT))) * (to - from)));
      }} onMouseLeave={() => setHovered(null)} />
    <div className="chart-readout" aria-live="polite">
      {hovered ? <><strong>{utc(hovered.t)}</strong>{!classes && <span>Interval: {mode === "raw" ? interval(hovered.lower, hovered.upper) : interval(hovered.calibrated_lower, hovered.calibrated_upper, "m")}</span>}
        {calibrated && <span>Published centre: {number(hovered.calibrated_center)} m</span>}
        {parameter === "snow" && <><span>Class: {snowClassLabel(hovered.snow_class, hovered)}</span>
          <span>Lower snow threshold: {number(hovered.snow_threshold_low, 6)}</span>
          <span>Upper snow threshold: {number(hovered.snow_threshold_high, 6)}</span></>}
        <span>Model: {hovered.model_version ?? "not supplied"} · QC: {hovered.quality_code ?? "not supplied"}</span></>
        : <span>{classes ? "Dots show snow classes; violet identifies high snow cover with two published thresholds. White dots mark unavailable classes." : "Bars show intervals; ticks below the axis mark missing intervals."} Move over the chart or use arrow keys to inspect observations. All times are UTC.</span>}
    </div>
  </div>;
}
