import { useState } from "react";
import type { ProviderLinks } from "../../api/contracts";

export default function ProviderView({ provider, name, loading, error, onRefresh }: {
  provider: ProviderLinks | null; name: string; loading: boolean; error?: string; onRefresh?: () => void;
}) {
  const [failedURL, setFailedURL] = useState<string | null>(null);
  const image = provider?.image_embeddable && provider.image_url !== failedURL ? provider.image_url : null;
  return <section className="provider provider-preview" aria-label="Current provider view">
    <div className="provider-heading"><h3>Current webcam</h3>{onRefresh && <button className="quiet" disabled={loading} onClick={onRefresh}>Reload image</button>}</div>
    {loading && <p className="muted small" role="status">Loading the provider’s current image…</p>}
    {image && <a href={image} target="_blank" rel="noopener noreferrer"><img className="current-image" src={image} alt={`Current view from ${name}`} onError={() => setFailedURL(image)} /></a>}
    {!loading && !image && <p className="muted small">{error || "The provider does not expose an embeddable current image here."}</p>}
    {provider?.page_url && <a className="provider-link" href={provider.page_url} target="_blank" rel="noopener noreferrer">Open provider page ↗</a>}
    {!loading && !image && provider?.image_url && <a href={provider.image_url} target="_blank" rel="noopener noreferrer">Open provider image ↗</a>}
  </section>;
}
