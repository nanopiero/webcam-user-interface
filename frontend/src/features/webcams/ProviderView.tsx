import { useI18n } from "../../i18n/I18nProvider";
import { useState } from "react";
import type { ProviderLinks } from "../../api/contracts";
import ProviderLogo from "./ProviderLogo";

export default function ProviderView({ provider, providerKind, name, loading, error, onRefresh }: {
  provider: ProviderLinks | null; providerKind?: string | null; name: string; loading: boolean; error?: string; onRefresh?: () => void;
}) {
  const { t } = useI18n();
  const [failedURL, setFailedURL] = useState<string | null>(null);
  const image = provider?.image_embeddable && provider.image_url !== failedURL ? provider.image_url : null;
  return <section className="provider provider-preview" aria-label={t("Current provider view")}>
    <div className="provider-heading"><h3>{t("Current image")}</h3>
      <ProviderLogo kind={providerKind} urls={[provider?.page_url, image]} />
      {onRefresh && <button className="quiet" disabled={loading} onClick={onRefresh}>{t("Reload image")}</button>}</div>
    {loading && <p className="muted small" role="status">{t("Loading the provider’s current image…")}</p>}
    {image && <a href={image} target="_blank" rel="noopener noreferrer"><img className="current-image" src={image} alt={t("Current view from {value0}", { value0: name })} onError={() => setFailedURL(image)} /></a>}
    {image && <p className="muted small image-provenance">{t("Provider’s current image. An exact match to the processed observation is not verified.")}</p>}
    {!loading && !image && <p className="muted small">{error ? t(error) : t("The provider does not expose an embeddable current image here.")}</p>}
    {provider?.page_url && <a className="provider-link" href={provider.page_url} target="_blank" rel="noopener noreferrer">{t("Open provider page ↗")}</a>}
    {!loading && !image && provider?.image_url && <a href={provider.image_url} target="_blank" rel="noopener noreferrer">{t("Open provider image ↗")}</a>}
  </section>;
}
