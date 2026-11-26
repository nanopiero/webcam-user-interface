import { usePresentation } from "../../shared/usePresentation";
import { useI18n } from "../../i18n/I18nProvider";
import type { DiagramMode, HistoryPoint, Parameter } from "../../api/contracts";

/** Pointer tooltips and keyboard readouts use the same original published values. */
export default function HistoryReadout({ point, parameter, mode }: { point: HistoryPoint; parameter: Parameter; mode: DiagramMode }) {
  const { t } = useI18n();
  const { interval, number, utc, snowClassLabel } = usePresentation();
  return <><strong>{utc(point.t)}</strong>
    {mode !== "classes" && <span>{t("Interval:")}{" "}{mode === "raw" ? interval(point.lower, point.upper) : interval(point.calibrated_lower, point.calibrated_upper, "m")}</span>}
    {mode === "calibrated" && <span>{t("Published centre:")}{" "}{number(point.calibrated_center)}{point.calibrated_center != null ? " m" : ""}</span>}
    {parameter === "snow" && <><span>{t("Class:")}{" "}{snowClassLabel(point.snow_class, point)}</span>
      {mode === "raw" && <><span>{t("Lower snow threshold:")}{" "}{number(point.snow_threshold_low, 6)}</span>
        <span>{t("Upper snow threshold:")}{" "}{number(point.snow_threshold_high, 6)}</span></>}</>}
    <span>{t("Model:")}{" "}{point.model_version ?? t("not supplied")}{" "}{t("· QC:")}{" "}{point.quality_code ?? t("not supplied")}</span>
  </>;
}
