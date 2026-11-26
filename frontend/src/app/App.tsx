import { usePresentation } from "../shared/usePresentation";
import { I18nProvider, preferredLanguage, useI18n } from "../i18n/I18nProvider";
import { loadLanguage } from "../i18n/core";
import LanguageMenu from "../i18n/LanguageMenu";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { getCollectionStatus, getConfiguration, getSupplementary } from "../api/client";
import type { AltitudeBand, BorderVisibility, CollectionStatus, FrontendConfiguration, Parameter, SiteFeature, SupplementaryFeature, SupplementaryPayload } from "../api/contracts";
import AdminPanel from "../features/admin/AdminPanel";
import { useAdministrator } from "../features/admin/useAdministrator";
import HistoryPanel, { type DiagramRequest } from "../features/history/HistoryPanel";
import Legend from "../features/map/Legend";
import AltitudeFilter, { matchesAltitude } from "../features/map/AltitudeFilter";
import BorderControls from "../features/map/BorderControls";
import CountryFilter from "../features/map/CountryFilter";
import { initialBorderVisibility } from "../features/map/roi";
import { useMapData } from "../features/map/useMapData";
import { siteForAltitude, siteForCountries } from "../features/map/presentation";
import WebcamPanel from "../features/webcams/WebcamPanel";
import SupplementaryPanel from "../features/webcams/SupplementaryPanel";
import { fromUTCInput, toUTCInput } from "../shared/format";

const MapView = lazy(() => import("../features/map/MapView"));
const EMPTY_SITES: SiteFeature[] = [];
const EMPTY_SUPPLEMENTARY: SupplementaryFeature[] = [];

export default function App() {
  const { t } = useI18n();
  const [configuration, setConfiguration] = useState<FrontendConfiguration | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    getConfiguration().then(async value => {
      if (!value.roi?.name || !value.roi.countries?.length || !Array.isArray(value.countries) || !Array.isArray(value.map?.center) || !value.map.basemap?.tiles?.length || !value.parameters?.length || !value.diagram || !value.visibility_display) throw new Error("Frontend configuration is incomplete.");
      await loadLanguage(preferredLanguage(value));
      if (active) setConfiguration(value);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [retry]);
  if (!configuration) return <main className="boot"><div className="brand-mark">W</div><h1>{t("Webcam observations")}</h1>{error
    ? <><p className="error" role="alert">{t(error)}</p><button onClick={() => setRetry(value => value + 1)}>{t("Try again")}</button></>
    : <p role="status">{t("Loading configuration…")}</p>}</main>;
  return <I18nProvider configuration={configuration}><Observations configuration={configuration} /></I18nProvider>;
}

function searchable(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

function Observations({ configuration }: { configuration: FrontendConfiguration }) {
  const { t, locale, error: languageError } = useI18n();
  const { PARAMETER_LABELS, utc, roiName } = usePresentation();
  const [parameter, setParameter] = useState<Parameter>(configuration.default_parameter);
  const [at, setAt] = useState<string | null>(null);
  const [timeDraft, setTimeDraft] = useState(toUTCInput(new Date().toISOString()));
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<CollectionStatus | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [hideWhite, setHideWhite] = useState(false);
  const [qualifiedOnly, setQualifiedOnly] = useState(true);
  const [altitudeBand, setAltitudeBand] = useState<AltitudeBand>("all");
  const [showObserved, setShowObserved] = useState(true);
  const [showBordering, setShowBordering] = useState(false);
  const countries = useMemo<Set<string | null>>(() => new Set(showBordering ? configuration.countries : configuration.roi.countries), [showBordering, configuration]);
  const [borders, setBorders] = useState<BorderVisibility>(() => initialBorderVisibility(configuration.roi.name, configuration.map.borders));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [supplementary, setSupplementary] = useState<SupplementaryPayload | null>(null);
  const [supplementaryError, setSupplementaryError] = useState("");
  const [supplementaryId, setSupplementaryId] = useState<string | null>(null);
  const [showSupplementary, setShowSupplementary] = useState(true);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [diagrams, setDiagrams] = useState<DiagramRequest[]>([]);
  const administrator = useAdministrator();
  const { data, busy, error: mapError } = useMapData(parameter, at, revision, countries, qualifiedOnly);
  const displayError = error || mapError;

  useEffect(() => {
    const abort = new AbortController();
    getCollectionStatus(abort.signal).then(result => { if (!abort.signal.aborted) setStatus(result); })
      .catch(() => { if (!abort.signal.aborted) setStatus(null); });
    return () => abort.abort();
  }, [parameter, at, revision]);

  useEffect(() => {
    const abort = new AbortController();
    getSupplementary(abort.signal).then(result => {
      if (!abort.signal.aborted) { setSupplementary(result); setSupplementaryError(""); }
    }).catch(error => { if (!abort.signal.aborted) setSupplementaryError(error.message); });
    return () => abort.abort();
  }, [revision]);

  useEffect(() => {
    if (!autoRefresh || at) return;
    const timer = window.setInterval(() => setRevision(value => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, at]);

  const countrySites = useMemo(() => (data?.features ?? EMPTY_SITES).flatMap(site => {
    const variant = siteForCountries(site, countries, data?.parameter ?? parameter);
    return variant ? [variant] : [];
  }), [data, countries, parameter]);
  const sites = useMemo(() => {
    const query = searchable(search.trim());
    if (!showObserved) return [];
    const variants = countrySites.flatMap(site => {
      const variant = siteForAltitude(site, altitudeBand, data?.parameter ?? parameter);
      return variant ? [variant] : [];
    });
    return variants.filter(site => (!hideWhite || site.properties.cls !== "white") && (!query ||
      searchable([site.properties.name, site.properties.platform,
        ...site.properties.cams.flatMap(camera => [camera.name, camera.provider_kind, camera.source_stream_id])].join(" ")).includes(query)))
      .sort((a, b) => (a.properties.name ?? a.properties.platform).localeCompare(b.properties.name ?? b.properties.platform));
  }, [countrySites, data, search, hideWhite, showObserved, altitudeBand, parameter]);
  const selected = sites.find(site => site.properties.id === selectedId) ?? null;
  const additional = useMemo(() => {
    const query = searchable(search.trim());
    return showSupplementary ? (supplementary?.features ?? []).filter(item => matchesAltitude(item.properties.altitude, altitudeBand) && (!query || searchable(`${item.properties.name} ${item.properties.source_layer_name} ${item.properties.provider_host ?? ""}`).includes(query))) : [];
  }, [supplementary, search, showSupplementary, altitudeBand]);
  const selectedAdditional = additional.find(item => item.properties.id === supplementaryId) ?? null;
  const count = sites.reduce((sum, site) => sum + site.properties.n, 0);
  const listener = status?.listeners.some(item => item.connected && Date.now() - Date.parse(item.heartbeat_at) < 120000);
  function select(site: SiteFeature, camera?: string) { setSelectedId(site.properties.id); setCameraId(camera ?? site.properties.cams[0].p); setSupplementaryId(null); setShowAdmin(false); setExplorerOpen(false); }
  function clearSelection() { setSelectedId(null); setSupplementaryId(null); setShowAdmin(false); setExplorerOpen(false); }
  function selectAdditional(item: SupplementaryFeature) { setSupplementaryId(item.properties.id); setSelectedId(null); setShowAdmin(false); setExplorerOpen(false); }
  function openHistory(id: string, name: string, parameter: Parameter) {
    const key = `${id}:${parameter}:${at ?? "latest"}`;
    setDiagrams(previous => previous.some(item => item.key === key) ? previous : [...previous, { key, id, name, parameter, at }]);
  }

  return <main className="application">
    <header className="topbar"><div className="brand"><span className="brand-mark">W</span><div><h1>{t("Webcam observations")}</h1><span className="brand-subtitle">{t("EUMETNET · Snow & visibility ·")}{" "}<span className="roi-label">ROI: {roiName(configuration.roi)}</span></span></div></div>
      <div className="topbar-right"><span className={`connection ${listener ? "connected" : ""}`}><i />{status ? listener ? t("Receiving observations") : t("Listener offline") : t("Status unavailable")}</span>
        <LanguageMenu />
        <button className={showAdmin ? "active" : ""} onClick={() => setShowAdmin(value => !value)}>{administrator.session ? t("Administrator") : t("Admin")}</button></div></header>
    <div className="toolbar">
      <button className="explorer-toggle" aria-expanded={explorerOpen} onClick={() => setExplorerOpen(value => !value)}>{t("Filters")}</button>
      <div className="segmented parameter-switch" aria-label={t("Observation parameter")}>{configuration.parameters.map(value => <button key={value} className={parameter === value ? "active" : ""} aria-pressed={parameter === value} onClick={() => setParameter(value)}>{PARAMETER_LABELS[value]}</button>)}</div>
      <form className="time-selector" onSubmit={event => { event.preventDefault(); try { setAt(fromUTCInput(timeDraft)); setError(""); } catch { setError("Choose a valid UTC date and time."); } }}>
        <label>{t("Map time (UTC)")}<input type="datetime-local" required value={timeDraft} onChange={event => setTimeDraft(event.target.value)} /></label><button type="submit">{t("View time")}</button>
        <button type="button" className={at === null ? "active" : ""} onClick={() => { setAt(null); setRevision(value => value + 1); }}>{t("Latest")}</button>
      </form>
      <div className="refresh-controls"><label><input type="checkbox" checked={autoRefresh} disabled={at !== null} onChange={event => setAutoRefresh(event.target.checked)} />{t("Auto · 30 s")}</label><button disabled={busy} onClick={() => setRevision(value => value + 1)}>{busy ? t("Loading…") : t("Refresh")}</button></div>
    </div>
    {languageError && <div className="error-banner" role="alert">{t(languageError)}</div>}
    {displayError && <div className="error-banner" role="alert">{t(displayError)}<button onClick={() => setRevision(value => value + 1)}>{t("Retry")}</button></div>}
    {supplementaryError && <div className="error-banner" role="alert">{t("Additional webcams:")}{" "}{t(supplementaryError)}<button onClick={() => setRevision(value => value + 1)}>{t("Retry")}</button></div>}
    <div className={`workspace ${diagrams.length ? "with-history" : ""}`}>
      <aside className={`sidebar ${explorerOpen ? "sidebar-open" : ""}`} aria-label={t("Webcam explorer")}>
        <div className="sidebar-search"><label htmlFor="webcam-search">{t("Find a webcam")}</label><input id="webcam-search" type="search" placeholder={t("Name, ID or provider…")} value={search} onChange={event => setSearch(event.target.value)} />
          <label className="checkbox"><input type="checkbox" checked={showObserved} onChange={event => setShowObserved(event.target.checked)} />{t("WEOW webcams")}</label>
          <label className="checkbox"><input type="checkbox" checked={qualifiedOnly} onChange={event => { setQualifiedOnly(event.target.checked); setSelectedId(null); }} />{t("Qualified scenes only")}</label>
          <label className="checkbox"><input type="checkbox" checked={hideWhite} onChange={event => setHideWhite(event.target.checked)} />{t("Hide white markers")}</label></div>
        {supplementary?.enabled && <label className="checkbox catalogue-toggle"><input type="checkbox" checked={showSupplementary} onChange={event => setShowSupplementary(event.target.checked)} />{t("Additional webcams · black dots")}</label>}
        <CountryFilter countries={configuration.countries} roi={configuration.roi} value={showBordering} onChange={value => { setShowBordering(value); setSelectedId(null); }} />
        <BorderControls value={borders} onChange={setBorders} roi={configuration.roi.name} />
        <AltitudeFilter value={altitudeBand} onChange={value => { setAltitudeBand(value); setSelectedId(null); setSupplementaryId(null); }} />
        {search.trim() && <div className="search-results" aria-label={t("Webcam search results")}>{sites.slice(0, 8).map(site => <button className="search-result" key={site.properties.id} onClick={() => select(site)}>
          <span className="site-dot" /><span><strong>{site.properties.name ?? site.properties.platform}</strong><small>{site.properties.platform} · {t(site.properties.n === 1 ? "{count} view" : "{count} views", { count: site.properties.n })}</small></span></button>)}
          {!sites.length && <p className="empty">{busy ? t("Loading webcams…") : hideWhite ? t("No classified sites match. Clear the filter to see raw observations.") : search ? t("No matching webcam.") : t("No webcams received for this view yet.")}</p>}
          {sites.length > 8 && <p className="muted small list-note">{t("Refine the search for more results.")}</p>}</div>}
        {supplementary?.enabled && search.trim() && <div className="search-results" aria-label={t("Additional webcam search results")}>{additional.slice(0, 8).map(item => <button key={item.properties.id} className="search-result" onClick={() => selectAdditional(item)}>
          <span className="site-dot catalogue-dot" /><span><strong>{item.properties.name}</strong><small>{item.properties.altitude == null ? t("Altitude not published") : t("{value0} m", { value0: item.properties.altitude.toLocaleString(locale) })}{" "}{t("· uMap")}</small></span></button>)}
          {!additional.length && <p className="empty">{t("No matching additional webcam.")}</p>}{additional.length > 8 && <p className="muted small list-note">{t("Refine the search for more results.")}</p>}</div>}
      </aside>
      <section className="map-area" aria-label={t("Observation explorer")}><Suspense fallback={<p className="empty" role="status">{t("Loading map…")}</p>}><MapView configuration={configuration} sites={sites} allSites={countrySites} parameter={data?.parameter ?? parameter} altitudeBand={altitudeBand} showObserved={showObserved} showSupplementary={showSupplementary} borders={borders} selected={selected} onClearSelection={clearSelection} onSelect={select} supplementary={additional} allSupplementary={supplementary?.features ?? EMPTY_SUPPLEMENTARY} selectedSupplementary={selectedAdditional} onSelectSupplementary={selectAdditional} /></Suspense>
        <div className="map-caption"><span className="eyebrow">{PARAMETER_LABELS[parameter]}</span><span>{at ? t("As of {value0}", { value0: utc(at) }) : t("Latest observations")}</span></div>
        {showAdmin ? <AdminPanel administrator={administrator} revision={revision} onChanged={() => setRevision(value => value + 1)} onClose={() => setShowAdmin(false)} />
          : selectedAdditional ? <SupplementaryPanel webcam={selectedAdditional} onClose={() => setSupplementaryId(null)} />
          : selected && <WebcamPanel key={cameraId} site={selected} cameraId={cameraId} parameter={parameter} administrator={administrator} onHistory={openHistory} onChanged={() => setRevision(value => value + 1)} onClose={() => setSelectedId(null)} historical={at !== null} revision={revision} />}
        {!selected && !selectedAdditional && !showAdmin && !busy && sites.length > 0 && <div className="map-hint">{t("Select a marker or webcam to explore")}</div>}
      </section>
      <aside className="legend-band" aria-label={t("Map colour legend")}>
        <div className="webcam-counts" aria-label={t("Webcam counts")}>
          <div className="site-summary" aria-label={t("Visible WEOW webcams")}><strong>{count.toLocaleString(locale)}</strong>{" "}{t("WEOW webcams ·")}{" "}{sites.length.toLocaleString(locale)}{" "}{t("sites")}</div>
          {supplementary?.enabled && <div className="site-summary" aria-label={t("Visible additional webcams")}><strong>{additional.length.toLocaleString(locale)}</strong>{" "}{t("additional webcams")}</div>}
        </div>
        <Legend parameter={parameter} freshness={data?.freshness} />
      </aside>
    </div>
    {diagrams.length > 0 && <section className="histories" aria-label={t("Prediction histories")}><div className="histories-heading"><span>{t(diagrams.length === 1 ? "{count} open history" : "{count} open histories", { count: diagrams.length })}</span><button className="quiet" onClick={() => setDiagrams([])}>{t("Close all histories")}</button></div>
      <div className="history-grid">{diagrams.map(diagram => <HistoryPanel key={diagram.key} diagram={diagram} configuration={configuration} mapTime={at ?? data?.at ?? null} onClose={() => setDiagrams(previous => previous.filter(item => item.key !== diagram.key))} />)}</div></section>}
    <footer className="statusbar"><span>{data ? t("Map updated {value0}", { value0: utc(data.at) }) : t("Waiting for map data")}</span><span>{status ? status.parameters.map(item => t("{value0}: {value1}", { value0: PARAMETER_LABELS[item.parameter], value1: item.observations.toLocaleString(locale) })).join(" · ") + t(" observations stored") : ""}</span></footer>
  </main>;
}
