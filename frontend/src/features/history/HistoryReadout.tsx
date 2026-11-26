import type { DiagramMode, HistoryPoint, Parameter } from "../../api/contracts";
import { interval, number, utc } from "../../shared/format";
import { snowClassLabel } from "./series";

/** Pointer tooltips and keyboard readouts use the same original published values. */
export default function HistoryReadout({ point, parameter, mode }: { point: HistoryPoint; parameter: Parameter; mode: DiagramMode }) {
  return <><strong>{utc(point.t)}</strong>
    {mode !== "classes" && <span>Interval: {mode === "raw" ? interval(point.lower, point.upper) : interval(point.calibrated_lower, point.calibrated_upper, "m")}</span>}
    {mode === "calibrated" && <span>Published centre: {number(point.calibrated_center)}{point.calibrated_center != null ? " m" : ""}</span>}
    {parameter === "snow" && <><span>Class: {snowClassLabel(point.snow_class, point)}</span>
      {mode === "raw" && <><span>Lower snow threshold: {number(point.snow_threshold_low, 6)}</span>
        <span>Upper snow threshold: {number(point.snow_threshold_high, 6)}</span></>}</>}
    <span>Model: {point.model_version ?? "not supplied"} · QC: {point.quality_code ?? "not supplied"}</span>
  </>;
}
