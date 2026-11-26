import { usePresentation } from "../../shared/usePresentation";
import { useI18n } from "../../i18n/I18nProvider";
import { useEffect, useState } from "react";
import { getProvider, getWebcam } from "../../api/client";
import type { Parameter, ProviderLinks, SiteFeature, WebcamDetail } from "../../api/contracts";
import type { Administrator } from "../admin/useAdministrator";

import ProviderView from "./ProviderView";

export default function WebcamPanel({ site, cameraId, parameter, administrator, onHistory, onChanged, onClose, historical, revision }: {
  site: SiteFeature; cameraId: string; parameter: Parameter; administrator: Administrator;
  onHistory: (id: string, name: string, parameter: Parameter) => void;
  onChanged: () => void; onClose: () => void; historical: boolean; revision: number;
}) {
  const { t } = useI18n();
  const { snowClassLabel, countryLabel, interval, number, qualificationLabel, REASON_LABELS, utc } = usePresentation();
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
  const title = detail?.name ?? camera?.name ?? site.properties.name ?? site.properties.platform;
  const tags = detail?.tags ?? [];
  const [other] = (["snow", "visibility"] as Parameter[]).filter(item => item !== parameter);

  return <aside className="detail-panel" aria-label={t("Webcam details")}>
    <div className="panel-heading"><div><span className="eyebrow">{t(site.properties.n === 1 ? "{count} webcam at this site" : "{count} webcams at this site", { count: site.properties.n })}</span><h2 className="camera-name">{title}</h2></div>
      <button className="icon-button" aria-label={t("Close webcam details")} onClick={onClose}>×</button></div>
    <ProviderView provider={provider} providerKind={detail?.provider_kind} name={title} loading={imageLoading} error={t(imageError)} onRefresh={() => setImageRevision(value => value + 1)} />
    {error && <p className="error" role="alert">{t(error)}</p>}
    {!detail && !error ? <p role="status">{t("Loading webcam…")}</p> : detail && <>
      <dl className="metadata"><dt>{t("Platform")}</dt><dd>{detail.platform}</dd><dt>{t("Coordinates")}</dt><dd>{number(detail.latitude, 5)}°, {number(detail.longitude, 5)}°</dd>
        <dt>{t("Altitude")}</dt><dd>{detail.altitude == null ? t("Not supplied") : t("{value0} m", { value0: number(detail.altitude, 0) })}</dd><dt>{t("Country")}</dt><dd>{detail.country ? countryLabel(detail.country) : t("Not supplied")}</dd></dl>
      <section className="prediction-summary"><h3>{t(parameter === "snow" ? "Snow observation" : "Visibility observation")}</h3>
        {prediction && <>
          <div className="latest-prediction"><span className="eyebrow">{t("Latest prediction")}</span>
            <strong>{parameter === "snow" ? snowClassLabel(prediction.snow_class, prediction)
              : interval(prediction.visibility_lower, prediction.visibility_upper, "m")}</strong>
          </div>
          {historical && <p className="muted small">{t("Map selection uses the selected time. This is the latest received prediction.")}</p>}
          <dl className="metadata observation-times" aria-label={t("Observation timestamps")}>
            <dt>{t("Download in E-SOH")}</dt><dd>{utc(prediction.download_timestamp)}</dd>
            <dt>{t("Processed")}</dt><dd>{utc(prediction.processing_timestamp)}</dd>
            <dt>{t("UI backend reception")}</dt><dd>{utc(prediction.received_at)}</dd>
          </dl>
        </>}
        {camera?.w && <p className="notice">{REASON_LABELS[camera.w] ?? camera.w}</p>}
        {prediction ? <dl className="metadata">
          <dt>{t("Qualification")}</dt><dd>{qualificationLabel(parameter === "snow" ? prediction.snow_qualification : prediction.visibility_qualification)}</dd>
          <dt>{t("Raw interval")}</dt><dd>{parameter === "snow" ? interval(prediction.snow_raw_lower, prediction.snow_raw_upper) : interval(prediction.visibility_raw_lower, prediction.visibility_raw_upper)}</dd>
          {parameter === "snow" ? <>
            <dt>{t("Lower snow threshold")}</dt><dd>{number(prediction.snow_threshold_low, 6)}</dd>
            <dt>{t("Upper snow threshold")}</dt><dd>{number(prediction.snow_threshold_high, 6)}</dd></> : <>
            <dt>{t("Published centre")}</dt><dd>{prediction.visibility_center == null ? t("Not published") : t("{value0} m", { value0: number(prediction.visibility_center) })}</dd></>}
          <dt>{t("Model")}</dt><dd>{prediction.model_version ?? t("Not supplied")}</dd><dt>{t("Quality code")}</dt><dd>{prediction.quality_code ?? t("Not supplied")}</dd>
        </dl> : <p className="empty">{t(parameter === "snow" ? "No snow observation received." : "No visibility observation received.")}</p>}
      </section>
      <details className="webcam-metadata"><summary>{t("Tags ({count}) and stream identifiers", { count: tags.length })}</summary>
        <h4>{t("Published tags")}</h4>
        {tags.length ? <ul className="webcam-tags">{tags.map((tag, index) => <li key={`${index}:${tag}`}>{tag}</li>)}</ul>
          : <p className="muted small">{t("No tags published.")}</p>}
        <dl className="metadata stream-metadata">
          <dt>{t("Source stream ID")}</dt><dd><code>{detail.source_stream_id ?? t("Not published")}</code></dd>
          <dt>{t("Published derived suffix")}</dt><dd><code>{detail.derived_suffix ?? t("Not published")}</code></dd>
          <dt>{t("Published processing suffix")}</dt><dd><code>{detail.processing_suffix ?? t("Not published")}</code></dd>
          <dt>{t("UI derived stream ID")}</dt><dd><code>{detail.derived_stream_id ?? t("Unavailable")}</code></dd>
          <dt>{t("UI processing stream ID")}</dt><dd><code>{detail.processing_stream_id}</code></dd>
        </dl>
        <p className="muted small">{t("Tags come from the published keywords. UI stream IDs are local identifiers derived from the MQTT identity; the full operational IDs are not published.")}</p>
      </details>
      <div className="history-actions"><button className="primary" onClick={() => onHistory(cameraId, detail.name, parameter)}>{t(parameter === "snow" ? "Open snow history" : "Open visibility history")}</button>
        <button onClick={() => onHistory(cameraId, detail.name, other)}>{t(other === "snow" ? "Open snow history" : "Open visibility history")}</button></div>
      {administrator.session && <form className="blacklist-form" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError("");
        try { await administrator.change(cameraId, reason); onChanged(); onClose(); }
        catch (error) { setError(error instanceof Error ? error.message : "Could not hide webcam"); }
        finally { setBusy(false); }
      }}><h3>{t("Administrator")}</h3><label>{t("Reason for hiding")}<input maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} placeholder={t("Optional")} /></label>
        <button className="danger" disabled={busy} type="submit">{t("Hide webcam from this map")}</button></form>}
    </>}
  </aside>;
}
