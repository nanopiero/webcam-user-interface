import { useI18n } from "../../i18n/I18nProvider";
import { providerBrand } from "./providerBrand";

export default function ProviderLogo({ kind, urls }: { kind?: string | null; urls: (string | null | undefined)[] }) {
  const { t } = useI18n();
  const brand = providerBrand(kind, urls);
  return brand ? <a className="provider-logo" href={brand.website} target="_blank" rel="noopener noreferrer"
    title={t("Provider: {value0}", { value0: brand.name })}><img src={brand.logo} alt={t("{value0} logo", { value0: brand.name })} /></a> : null;
}
