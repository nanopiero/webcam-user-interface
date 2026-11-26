import { useEffect, useState } from "react";
import { getSupplementaryWebcam } from "../../api/client";
import type { SupplementaryDetail, SupplementaryFeature } from "../../api/contracts";
import { number, utc } from "../../shared/format";
import CatalogueMedia from "./CatalogueMedia";

export default function SupplementaryPanel({ webcam, onClose }: { webcam: SupplementaryFeature; onClose: () => void }) {
  const [detail, setDetail] = useState<SupplementaryDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setDetail(null); setError("");
    getSupplementaryWebcam(webcam.properties.id, abort.signal).then(result => { if (!abort.signal.aborted) setDetail(result); })
      .catch(error => { if (!abort.signal.aborted) setError(error.message); });
    return () => abort.abort();
  }, [webcam.properties.id]);
  return <aside className="detail-panel" aria-label="Supplementary webcam details">
    <div className="panel-heading"><div><span className="eyebrow">Supplementary webcam · uMap</span><h2>{webcam.properties.name}</h2></div><button className="icon-button" aria-label="Close supplementary webcam" onClick={onClose}>×</button></div>
    <CatalogueMedia id={webcam.properties.id} name={webcam.properties.name} providerPageURL={detail?.provider_url} />
    <p className="notice">Not processed by WEOW in this application. No prediction history is available.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {!detail && !error && <p role="status">Loading webcam metadata…</p>}
    {detail && <>
      <dl className="metadata"><dt>Coordinates</dt><dd>{number(detail.latitude, 5)}°, {number(detail.longitude, 5)}°</dd>
        <dt>Altitude</dt><dd>{detail.altitude == null ? "Not published" : `${number(detail.altitude, 0)} m`}</dd>
        <dt>Altitude source</dt><dd>{detail.altitude_source === "name" ? "Published webcam name" : detail.altitude_source ?? "Not published"}</dd>
        <dt>Source layer</dt><dd>{detail.source_layer_name}</dd><dt>CSV updated</dt><dd>{detail.exported_at ? utc(detail.exported_at) : "Not supplied"}</dd></dl>
      {detail.links.some(url => url !== detail.provider_url) && <section className="catalogue-links"><h3>Other published links</h3><ul>{detail.links.filter(url => url !== detail.provider_url).map(url => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname} ↗</a></li>)}</ul></section>}
      {detail.description && <details><summary>Published description</summary><p className="source-description">{detail.description}</p></details>}
      <details><summary>All source metadata</summary><pre className="source-metadata">{JSON.stringify(detail.metadata, null, 2)}</pre></details>
      {detail.source_map_url && <p className="source-attribution"><a href={detail.source_map_url} target="_blank" rel="noopener noreferrer">{detail.source_map_name} · uMap ↗</a></p>}
    </>}
  </aside>;
}
