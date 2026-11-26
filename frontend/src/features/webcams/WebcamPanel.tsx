import { useEffect, useState } from "react";
import { getProvider, getWebcam } from "../../api/client";
import type { Parameter, ProviderLinks, SiteFeature, WebcamDetail } from "../../api/contracts";
import type { Administrator } from "../admin/useAdministrator";
import { snowClassLabel } from "../history/series";
import { countryLabel } from "../map/countries";
import { interval, number, PARAMETER_LABELS, qualificationLabel, REASON_LABELS, utc } from "../../shared/format";
import ProviderView from "./ProviderView";

export default function WebcamPanel({ site, cameraId, parameter, administrator, onHistory, onChanged, onClose, historical, revision }: {
  site: SiteFeature; cameraId: string; parameter: Parameter; administrator: Administrator;
  onHistory: (id: string, name: string, parameter: Parameter) => void;
  onChanged: () => void; onClose: () => void; historical: boolean; revision: number;
}) {
  const [detail, setDetail] = useState<WebcamDetail | null>(null);
  const [provider, setProvider] = useState<ProviderLinks | null>(null);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageRevision, setImageRevision] = useState(0);
  const [imageError, setImageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    getWebcam(cameraId, abort.signal).then(result => {
      if (!abort.signal.aborted) { setDetail(result); setProvider(previous => previous ?? result.provider); }
    }).catch(error => { if (!abort.signal.aborted) setError(error.message); });
    return () => abort.abort();
  }, [cameraId, revision]);
  useEffect(() => {
    const abort = new AbortController();
    setImageLoading(true); setImageError("");
    getProvider(cameraId, abort.signal).then(result => { if (!abort.signal.aborted) setProvider(result); })
      .catch(error => { if (!abort.signal.aborted) setImageError(error.message); })
      .finally(() => { if (!abort.signal.aborted) setImageLoading(false); });
    return () => abort.abort();
  }, [cameraId, imageRevision]);
  const camera = site.properties.cams.find(item => item.p === cameraId);
  const prediction = detail?.predictions.find(item => item.parameter === parameter);
  const [other] = (["snow", "visibility"] as Parameter[]).filter(item => item !== parameter);

  return <aside className="detail-panel" aria-label="Webcam details">
    <div className="panel-heading"><div><span className="eyebrow">{site.properties.n} webcam{site.properties.n === 1 ? "" : "s"} at this site</span><h2>{site.properties.name ?? site.properties.platform}</h2></div>
      <button className="icon-button" aria-label="Close webcam details" onClick={onClose}>×</button></div>
    <ProviderView provider={provider} name={detail?.name ?? camera?.name ?? "webcam"} loading={imageLoading} error={imageError} onRefresh={() => setImageRevision(value => value + 1)} />
    {error && <p className="error" role="alert">{error}</p>}
    {!detail && !error ? <p role="status">Loading webcam…</p> : detail && <>
      <p className="camera-name">{detail.name}</p>
      <dl className="metadata"><dt>Platform</dt><dd>{detail.platform}</dd><dt>Coordinates</dt><dd>{number(detail.latitude, 5)}°, {number(detail.longitude, 5)}°</dd>
        <dt>Altitude</dt><dd>{detail.altitude == null ? "Not supplied" : `${number(detail.altitude, 0)} m`}</dd><dt>Country</dt><dd>{detail.country ? countryLabel(detail.country) : "Not supplied"}</dd></dl>
      <section className="prediction-summary"><h3>{PARAMETER_LABELS[parameter]} observation</h3>
        {prediction && <>
          <div className="latest-prediction"><span className="eyebrow">Latest prediction</span>
            <strong>{parameter === "snow" ? snowClassLabel(prediction.snow_class, prediction)
              : interval(prediction.visibility_lower, prediction.visibility_upper, "m")}</strong>
          </div>
          {historical && <p className="muted small">Map selection uses the selected time. This is the latest received prediction.</p>}
          <dl className="metadata observation-times" aria-label="Observation timestamps">
            <dt>Download in E-SOH</dt><dd>{utc(prediction.download_timestamp)}</dd>
            <dt>Processed</dt><dd>{utc(prediction.processing_timestamp)}</dd>
            <dt>UI backend reception</dt><dd>{utc(prediction.received_at)}</dd>
          </dl>
        </>}
        {camera?.w && <p className="notice">{REASON_LABELS[camera.w] ?? camera.w}</p>}
        {prediction ? <dl className="metadata">
          <dt>Qualification</dt><dd>{qualificationLabel(parameter === "snow" ? prediction.snow_qualification : prediction.visibility_qualification)}</dd>
          <dt>Raw interval</dt><dd>{parameter === "snow" ? interval(prediction.snow_raw_lower, prediction.snow_raw_upper) : interval(prediction.visibility_raw_lower, prediction.visibility_raw_upper)}</dd>
          {parameter === "snow" ? <>
            <dt>Lower snow threshold</dt><dd>{number(prediction.snow_threshold_low, 6)}</dd>
            <dt>Upper snow threshold</dt><dd>{number(prediction.snow_threshold_high, 6)}</dd></> : <>
            <dt>Published centre</dt><dd>{prediction.visibility_center == null ? "Not published" : `${number(prediction.visibility_center)} m`}</dd></>}
          <dt>Model</dt><dd>{prediction.model_version ?? "Not supplied"}</dd><dt>Quality code</dt><dd>{prediction.quality_code ?? "Not supplied"}</dd>
        </dl> : <p className="empty">No {parameter} observation received.</p>}
      </section>
      <div className="history-actions"><button className="primary" onClick={() => onHistory(cameraId, detail.name, parameter)}>Open {parameter} history</button>
        <button onClick={() => onHistory(cameraId, detail.name, other)}>Open {other} history</button></div>
      {administrator.session && <form className="blacklist-form" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError("");
        try { await administrator.change(cameraId, reason); onChanged(); onClose(); }
        catch (error) { setError(error instanceof Error ? error.message : "Could not hide webcam"); }
        finally { setBusy(false); }
      }}><h3>Administrator</h3><label>Reason for hiding<input maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Optional" /></label>
        <button className="danger" disabled={busy} type="submit">Hide webcam from this map</button></form>}
    </>}
  </aside>;
}
