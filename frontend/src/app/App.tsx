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
import { fromUTCInput, PARAMETER_LABELS, toUTCInput, utc } from "../shared/format";

const MapView = lazy(() => import("../features/map/MapView"));
const EMPTY_SITES: SiteFeature[] = [];
const EMPTY_SUPPLEMENTARY: SupplementaryFeature[] = [];

export default function App() {
  const [configuration, setConfiguration] = useState<FrontendConfiguration | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    getConfiguration().then(value => {
      if (!value.roi?.name || !value.roi.countries?.length || !Array.isArray(value.countries) || !Array.isArray(value.map?.center) || !value.map.basemap?.tiles?.length || !value.parameters?.length || !value.diagram || !value.visibility_display) throw new Error("Frontend configuration is incomplete.");
      if (active) setConfiguration(value);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [retry]);
  if (!configuration) return <main className="boot"><div className="brand-mark">W</div><h1>Webcam observations</h1>{error
    ? <><p className="error" role="alert">{error}</p><button onClick={() => setRetry(value => value + 1)}>Try again</button></>
    : <p role="status">Loading configuration…</p>}</main>;
  return <Observations configuration={configuration} />;
}

function searchable(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

function Observations({ configuration }: { configuration: FrontendConfiguration }) {
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
    <header className="topbar"><div className="brand"><span className="brand-mark">W</span><div><h1>Webcam observations</h1><span className="brand-subtitle">EUMETNET · Snow & visibility · <span className="roi-label">ROI: {configuration.roi.name}</span></span></div></div>
      <div className="topbar-right"><span className={`connection ${listener ? "connected" : ""}`}><i />{status ? listener ? "Receiving observations" : "Listener offline" : "Status unavailable"}</span>
        <button className={showAdmin ? "active" : ""} onClick={() => setShowAdmin(value => !value)}>{administrator.session ? "Administrator" : "Admin"}</button></div></header>
    <div className="toolbar">
      <button className="explorer-toggle" aria-expanded={explorerOpen} onClick={() => setExplorerOpen(value => !value)}>Filters</button>
      <div className="segmented parameter-switch" aria-label="Observation parameter">{configuration.parameters.map(value => <button key={value} className={parameter === value ? "active" : ""} aria-pressed={parameter === value} onClick={() => setParameter(value)}>{PARAMETER_LABELS[value]}</button>)}</div>
      <form className="time-selector" onSubmit={event => { event.preventDefault(); try { setAt(fromUTCInput(timeDraft)); setError(""); } catch { setError("Choose a valid UTC date and time."); } }}>
        <label>Map time (UTC)<input type="datetime-local" required value={timeDraft} onChange={event => setTimeDraft(event.target.value)} /></label><button type="submit">View time</button>
        <button type="button" className={at === null ? "active" : ""} onClick={() => { setAt(null); setRevision(value => value + 1); }}>Latest</button>
      </form>
      <div className="refresh-controls"><label><input type="checkbox" checked={autoRefresh} disabled={at !== null} onChange={event => setAutoRefresh(event.target.checked)} />Auto · 30 s</label><button disabled={busy} onClick={() => setRevision(value => value + 1)}>{busy ? "Loading…" : "Refresh"}</button></div>
    </div>
    {displayError && <div className="error-banner" role="alert">{displayError}<button onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    {supplementaryError && <div className="error-banner" role="alert">Additional webcams: {supplementaryError}<button onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    <div className={`workspace ${diagrams.length ? "with-history" : ""}`}>
      <aside className={`sidebar ${explorerOpen ? "sidebar-open" : ""}`} aria-label="Webcam explorer">
        <div className="sidebar-search"><label htmlFor="webcam-search">Find a webcam</label><input id="webcam-search" type="search" placeholder="Name, ID or provider…" value={search} onChange={event => setSearch(event.target.value)} />
          <label className="checkbox"><input type="checkbox" checked={showObserved} onChange={event => setShowObserved(event.target.checked)} />WEOW webcams</label>
          <label className="checkbox"><input type="checkbox" checked={qualifiedOnly} onChange={event => { setQualifiedOnly(event.target.checked); setSelectedId(null); }} />Qualified scenes only</label>
          <label className="checkbox"><input type="checkbox" checked={hideWhite} onChange={event => setHideWhite(event.target.checked)} />Hide white markers</label></div>
        {supplementary?.enabled && <label className="checkbox catalogue-toggle"><input type="checkbox" checked={showSupplementary} onChange={event => setShowSupplementary(event.target.checked)} />Additional webcams · black dots</label>}
        <CountryFilter countries={configuration.countries} roi={configuration.roi} value={showBordering} onChange={value => { setShowBordering(value); setSelectedId(null); }} />
        <BorderControls value={borders} onChange={setBorders} roi={configuration.roi.name} />
        <AltitudeFilter value={altitudeBand} onChange={value => { setAltitudeBand(value); setSelectedId(null); setSupplementaryId(null); }} />
        {search.trim() && <div className="search-results" aria-label="Webcam search results">{sites.slice(0, 8).map(site => <button className="search-result" key={site.properties.id} onClick={() => select(site)}>
          <span className="site-dot" /><span><strong>{site.properties.name ?? site.properties.platform}</strong><small>{site.properties.platform} · {site.properties.n} view{site.properties.n === 1 ? "" : "s"}</small></span></button>)}
          {!sites.length && <p className="empty">{busy ? "Loading webcams…" : hideWhite ? "No classified sites match. Clear the filter to see raw observations." : search ? "No matching webcam." : "No webcams received for this view yet."}</p>}
          {sites.length > 8 && <p className="muted small list-note">Refine the search for more results.</p>}</div>}
        {supplementary?.enabled && search.trim() && <div className="search-results" aria-label="Additional webcam search results">{additional.slice(0, 8).map(item => <button key={item.properties.id} className="search-result" onClick={() => selectAdditional(item)}>
          <span className="site-dot catalogue-dot" /><span><strong>{item.properties.name}</strong><small>{item.properties.altitude == null ? "Altitude not published" : `${item.properties.altitude.toLocaleString()} m`} · uMap</small></span></button>)}
          {!additional.length && <p className="empty">No matching additional webcam.</p>}{additional.length > 8 && <p className="muted small list-note">Refine the search for more results.</p>}</div>}
      </aside>
      <section className="map-area" aria-label="Observation explorer"><Suspense fallback={<p className="empty" role="status">Loading map…</p>}><MapView configuration={configuration} sites={sites} allSites={countrySites} parameter={data?.parameter ?? parameter} altitudeBand={altitudeBand} showObserved={showObserved} showSupplementary={showSupplementary} borders={borders} selected={selected} onClearSelection={clearSelection} onSelect={select} supplementary={additional} allSupplementary={supplementary?.features ?? EMPTY_SUPPLEMENTARY} selectedSupplementary={selectedAdditional} onSelectSupplementary={selectAdditional} /></Suspense>
        <div className="map-caption"><span className="eyebrow">{PARAMETER_LABELS[parameter]}</span><span>{at ? `As of ${utc(at)}` : "Latest observations"}</span></div>
        {showAdmin ? <AdminPanel administrator={administrator} revision={revision} onChanged={() => setRevision(value => value + 1)} onClose={() => setShowAdmin(false)} />
          : selectedAdditional ? <SupplementaryPanel webcam={selectedAdditional} onClose={() => setSupplementaryId(null)} />
          : selected && <WebcamPanel key={cameraId} site={selected} cameraId={cameraId} parameter={parameter} administrator={administrator} onHistory={openHistory} onChanged={() => setRevision(value => value + 1)} onClose={() => setSelectedId(null)} historical={at !== null} revision={revision} />}
        {!selected && !selectedAdditional && !showAdmin && !busy && sites.length > 0 && <div className="map-hint">Select a marker or webcam to explore</div>}
      </section>
      <aside className="legend-band" aria-label="Map colour legend">
        <div className="webcam-counts" aria-label="Webcam counts">
          <div className="site-summary" aria-label="Visible WEOW webcams"><strong>{count.toLocaleString()}</strong> WEOW webcams · {sites.length.toLocaleString()} sites</div>
          {supplementary?.enabled && <div className="site-summary" aria-label="Visible additional webcams"><strong>{additional.length.toLocaleString()}</strong> additional webcams</div>}
        </div>
        <Legend parameter={parameter} freshness={data?.freshness} />
      </aside>
    </div>
    {diagrams.length > 0 && <section className="histories" aria-label="Prediction histories"><div className="histories-heading"><span>{diagrams.length} open histor{diagrams.length === 1 ? "y" : "ies"}</span><button className="quiet" onClick={() => setDiagrams([])}>Close all histories</button></div>
      <div className="history-grid">{diagrams.map(diagram => <HistoryPanel key={diagram.key} diagram={diagram} configuration={configuration} onClose={() => setDiagrams(previous => previous.filter(item => item.key !== diagram.key))} />)}</div></section>}
    <footer className="statusbar"><span>{data ? `Map updated ${utc(data.at)}` : "Waiting for map data"}</span><span>{status ? status.parameters.map(item => `${item.parameter}: ${item.observations.toLocaleString()}`).join(" · ") + " observations stored" : ""}</span></footer>
  </main>;
}
