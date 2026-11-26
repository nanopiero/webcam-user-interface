import { useMemo } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { PARAMETER_LABELS as parameterLabels, REASON_LABELS as reasonLabels, qualificationLabel as qualification, utc as timestamp } from "./format";
import { countryLabel as country } from "../features/map/countries";
import { snowClassLabel as snowClass } from "../features/history/series";

/** Locale-aware display only; timestamps remain UTC and stored values never change. */
export function usePresentation() {
  const { locale, t } = useI18n();
  return useMemo(() => {
    const number = (value: number | null | undefined, digits = 3) => value == null ? t("Not supplied")
      : value.toLocaleString(locale, { maximumFractionDigits: digits });
    const interval = (lower: number | null, upper: number | null, unit = "") => lower == null || upper == null
      ? t("Not published") : `${number(lower)} – ${number(upper)}${unit ? ` ${unit}` : ""}`;
    return { number, interval,
      utc: (value: string | null | undefined) => value ? timestamp(value) : t("Not supplied"),
      qualificationLabel: (value: number | null | undefined) => t(qualification(value)),
      snowClassLabel: (value: number | null, thresholds = {}) => snowClass(value, thresholds, t),
      countryLabel: (code: string) => country(code, locale),
      roiName: (roi: { name: string; countries: string[] }) => {
        const code = roi.countries[0];
        if (roi.countries.length !== 1 || !code) return roi.name;
        const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
        return [name?.toLowerCase(), code.toLowerCase()].includes(roi.name.toLowerCase())
          ? new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? roi.name : roi.name;
      },
      PARAMETER_LABELS: { snow: t(parameterLabels.snow), visibility: t(parameterLabels.visibility) },
      REASON_LABELS: Object.fromEntries(Object.entries(reasonLabels).map(([key, value]) => [key, t(value)])),
    };
  }, [locale, t]);
}
