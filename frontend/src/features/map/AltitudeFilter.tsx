import type { AltitudeBand } from "../../api/contracts";

export function matchesAltitude(altitude: number | null, band: AltitudeBand): boolean {
  if (band === "all") return true;
  if (altitude == null || !Number.isFinite(altitude)) return false;
  if (band === "low") return altitude < 500;
  if (band === "middle") return altitude >= 500 && altitude <= 1000;
  return altitude > 1000;
}

export default function AltitudeFilter({ value, onChange }: { value: AltitudeBand; onChange: (value: AltitudeBand) => void }) {
  const choices: [AltitudeBand, string][] = [["all", "All altitudes"], ["low", "Below 500 m"], ["middle", "500–1,000 m"], ["high", "Above 1,000 m"]];
  return <section className="altitude-filter" aria-label="Camera altitude filter"><h2>Altitude</h2>
    <div className="altitude-buttons">{choices.map(([key, label]) => <button key={key} className={value === key ? "active" : ""} aria-pressed={value === key} onClick={() => onChange(key === value ? "all" : key)}>{label}</button>)}</div>
  </section>;
}
