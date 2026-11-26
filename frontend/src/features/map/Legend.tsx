import { useI18n } from "../../i18n/I18nProvider";
import type { FreshnessPolicy, Parameter } from "../../api/contracts";
import { CLASS_COLOURS, VISIBILITY_STEPS, VISIBILITY_STEP_COLOURS } from "./icons";

function duration(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
}

export default function Legend({ parameter, freshness }: { parameter: Parameter; freshness?: FreshnessPolicy }) {
  const { t, locale } = useI18n();
  const freshnessColour = parameter === "visibility"
    ? VISIBILITY_STEP_COLOURS[3000] : CLASS_COLOURS["snow.undifferentiated"];
  const rows = parameter === "snow" ? [
    [CLASS_COLOURS["snow.none"], "No snow"],
    [CLASS_COLOURS["snow.intermediate"], "Intermediate snow cover"],
    [CLASS_COLOURS["snow.undifferentiated"], "Undifferentiated snow cover"],
    [CLASS_COLOURS["snow.high"], "High snow cover"],
  ] : [...VISIBILITY_STEPS].reverse().map(([from, to]) => [
    VISIBILITY_STEP_COLOURS[from], `${from.toLocaleString(locale)}–${to.toLocaleString(locale)} m`,
  ]);
  return <section className="legend" aria-label={t("Map legend")}>
    <ul className="keys">
      {rows.map(([colour, label]) => <li key={label}><span className="swatch" style={{ background: colour }} />{t(label)}</li>)}
      <li><span className="swatch" style={{ background: "white" }} />{parameter === "snow" ? t("Recent snow observation · unqualified") : t("Processed · result unavailable")}</li>
      <li><span className="swatch catalogue-swatch" style={{ background: "white" }} />{t(parameter === "snow" ? "No recent snow observation" : "No recent visibility observation")}</li>
      <li><span className="swatch catalogue-swatch" style={{ background: "#111" }} />{t("Additional webcams")}</li>
      {parameter === "snow" && <li><span className="swatch uncertain" />{t("Published as uncertain")}</li>}
    </ul>
    {freshness && <div className="freshness-legend" aria-label={t("Observation age")}>
      <h3>{t("Since download")}</h3>
      <ul className="keys">
        <li><span className="swatch freshness-solid" style={{ background: freshnessColour }} />{t("Under {duration}: solid", { duration: duration(freshness.fresh_minutes) })}</li>
        <li><span className="swatch freshness-ring" style={{ background: freshnessColour }} />{t("{fresh}–{maximum}: white ring", { fresh: duration(freshness.fresh_minutes), maximum: duration(freshness.max_age_minutes) })}</li>
        <li><span className="swatch catalogue-swatch" style={{ background: "white" }} />{t("From {duration}: small white dot", { duration: duration(freshness.max_age_minutes) })}</li>
      </ul>
      <p className="muted small">{t("Each camera’s sector shows its own age.")}</p>
    </div>}
    <p className="muted small">{parameter === "visibility"
      ? t("Two-tone markers show the interval’s upper bound above and lower bound below.")
      : t("Sites with equally frequent classes use a pie marker.")}</p>
    <p className="muted small">{t("Missing WEOW observations do not mean the provider has no new image.")}</p>
    {parameter === "snow" && <p className="muted small">{t("Unknown qualification counts as unqualified.")}</p>}
  </section>;
}
