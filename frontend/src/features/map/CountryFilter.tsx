import { useI18n } from "../../i18n/I18nProvider";
interface Props {
  countries: string[];
  roi: { name: string; countries: string[] };
  value: boolean;
  onChange: (value: boolean) => void;
}

export default function CountryFilter({ countries, roi, value, onChange }: Props) {
  const { t } = useI18n();
  const hasBordering = countries.some(code => !roi.countries.includes(code));
  if (!hasBordering) return null;
  return <section className="country-filter" aria-label={t("WEOW country filter")}>
    <label className="checkbox bordering-toggle"><input type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} />{t("Show bordering webcams")}</label>
  </section>;
}
