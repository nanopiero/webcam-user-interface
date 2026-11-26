import type { Parameter } from "../../api/contracts";
import { CLASS_COLOURS, VISIBILITY_STEPS, VISIBILITY_STEP_COLOURS } from "./icons";

export default function Legend({ parameter }: { parameter: Parameter }) {
  const rows = parameter === "snow" ? [
    [CLASS_COLOURS["snow.none"], "No snow"],
    [CLASS_COLOURS["snow.intermediate"], "Intermediate snow cover"],
    [CLASS_COLOURS["snow.undifferentiated"], "Undifferentiated snow cover"],
    [CLASS_COLOURS["snow.high"], "High snow cover"],
  ] : [...VISIBILITY_STEPS].reverse().map(([from, to]) => [
    VISIBILITY_STEP_COLOURS[from], `${from.toLocaleString("en-GB")}–${to.toLocaleString("en-GB")} m`,
  ]);
  return <section className="legend" aria-label="Map legend">
    <h2>{parameter === "snow" ? "Snow legend" : "Visibility legend"}</h2>
    <ul className="keys">
      {rows.map(([colour, label]) => <li key={label}><span className="swatch" style={{ background: colour }} />{label}</li>)}
      <li><span className="swatch" style={{ background: "white" }} />{parameter === "snow" ? "Recent snow observation · unqualified" : "Processed · result unavailable"}</li>
      <li><span className="swatch catalogue-swatch" style={{ background: "white" }} />No recent {parameter} observation</li>
      <li><span className="swatch catalogue-swatch" style={{ background: "#111" }} />Additional webcams</li>
      {parameter === "snow" && <li><span className="swatch uncertain" />Published as uncertain</li>}
    </ul>
    <p className="muted small">{parameter === "visibility"
      ? "Two-tone markers show the interval’s upper bound above and lower bound below."
      : "Sites with equally frequent classes use a pie marker."}</p>
    <p className="muted small">Missing WEOW observations do not mean the provider has no new image.</p>
    {parameter === "snow" && <p className="muted small">Unknown qualification counts as unqualified.</p>}
  </section>;
}
