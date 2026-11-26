import { useEffect, useState } from "react";
import { getSupplementaryProvider } from "../../api/client";
import type { ProviderMedia } from "../../api/contracts";
import ProviderLogo from "./ProviderLogo";

export default function CatalogueMedia({ id, name, providerPageURL }: { id: string; name: string; providerPageURL?: string | null }) {
  const [provider, setProvider] = useState<ProviderMedia | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    setProvider(null); setError(""); setSelected(0); setFailed([]);
    getSupplementaryProvider(id, abort.signal).then(result => { if (!abort.signal.aborted) setProvider(result); })
      .catch(error => { if (!abort.signal.aborted) setError(error.message); });
    return () => abort.abort();
  }, [id]);
  const available = provider?.media.filter(item => !failed.includes(item.url)) ?? [];
  const media = available[Math.min(selected, available.length - 1)];
  const pageURL = provider?.page_url ?? providerPageURL;
  const failedMedia = () => { if (media) { setFailed(previous => [...previous, media.url]); setSelected(0); } };
  return <section className="provider provider-preview" aria-label="Current supplementary provider view">
    <div className="provider-heading"><h3>Current webcam</h3></div>
    <ProviderLogo urls={[pageURL, media?.url]} />
    {!provider && !error && <p className="muted small" role="status">Loading the provider view…</p>}
    {error && <p className="muted small">{error}</p>}
    {available.length > 1 && <label className="provider-selector">Provider view<select value={Math.min(selected, available.length - 1)} onChange={event => setSelected(Number(event.target.value))}>
      {available.map((item, index) => <option key={item.url} value={index}>{index + 1} · {item.kind === "frame" ? "Player" : item.kind === "video" ? "Video" : "Image"}</option>)}
    </select></label>}
    {media?.kind === "image" && <a href={media.url} target="_blank" rel="noopener noreferrer"><img className="current-image" src={media.url} alt={`Provider view from ${name}`} onError={failedMedia} /></a>}
    {media?.kind === "video" && <video className="current-video" src={media.url} aria-label={`Provider video from ${name}`} controls autoPlay muted playsInline onError={failedMedia} />}
    {media?.kind === "frame" && <iframe className="current-player" title={`Provider player for ${name}`} src={media.url} sandbox="allow-scripts allow-same-origin allow-presentation" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />}
    {provider && !media && <p className="muted small">This provider view cannot be embedded. Use its original link below.</p>}
    {media && media.url !== pageURL && <a className="provider-link" href={media.url} target="_blank" rel="noopener noreferrer">Open this provider view ↗</a>}
    {pageURL && <a className="provider-link" href={pageURL} target="_blank" rel="noopener noreferrer">Open provider webcam ↗</a>}
  </section>;
}
