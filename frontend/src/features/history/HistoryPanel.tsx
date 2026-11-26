import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { getHistory } from "../../api/client";
import type { DiagramMode, FrontendConfiguration, HistoryPayload, Parameter } from "../../api/contracts";
import { fromUTCInput, PARAMETER_LABELS, toUTCInput } from "../../shared/format";
import { bounds, mergeHistory, snowCategory } from "./series";

const HistoryChart = lazy(() => import("./HistoryChart"));

export interface DiagramRequest { key: string; id: string; name: string; parameter: Parameter; at: string | null }

export default function HistoryPanel({ diagram, configuration, mapTime, onClose }: {
  diagram: DiagramRequest; configuration: FrontendConfiguration; mapTime: string | null; onClose: () => void;
}) {
  const [range, setRange] = useState(() => {
    const end = diagram.at ?? new Date().toISOString();
    return { start: new Date(Date.parse(end) - Math.min(configuration.diagram.initial_days, configuration.diagram.max_days) * 86400000).toISOString(), end };
  });
  const [draft, setDraft] = useState({ start: toUTCInput(range.start), end: toUTCInput(range.end) });
  const [preset, setPreset] = useState(String(Math.min(configuration.diagram.initial_days, configuration.diagram.max_days)));
  const [showDates, setShowDates] = useState(false);
  const presets = [...new Set([1 / 24, 6 / 24, 1, 7, 30, 90, 366,
    Math.min(configuration.diagram.initial_days, configuration.diagram.max_days)])]
    .filter(days => days > 0 && days <= configuration.diagram.max_days).sort((a, b) => a - b);
  const [mode, setMode] = useState<DiagramMode>(diagram.parameter === "snow" ? "classes" : "raw");
  const [pages, setPages] = useState<HistoryPayload[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const abort = new AbortController();
    generation.current += 1;
    setBusy(true); setError(""); setPages([]);
    getHistory(diagram.id, diagram.parameter, range.start, range.end, undefined, abort.signal)
      .then(page => { if (!abort.signal.aborted) setPages([page]); })
      .catch(error => { if (!abort.signal.aborted) setError(error.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [diagram.id, diagram.parameter, range, revision]);
  const points = useMemo(() => mergeHistory(pages), [pages]);
  const next = pages.at(-1)?.next_cursor;
  const missing = points.filter(point => mode === "classes" ? snowCategory(point.snow_class) === null : !bounds(point, mode)).length;

  function applyRange(start: string, end: string) {
    try {
      const next = { start: fromUTCInput(start), end: fromUTCInput(end) };
      const days = (Date.parse(next.end) - Date.parse(next.start)) / 86400000;
      if (days <= 0 || days > configuration.diagram.max_days) throw new Error(`Choose an end after the start, within ${configuration.diagram.max_days} days.`);
      setRange(next); setPreset("custom"); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "Invalid date range"); }
  }
  function movePeriod(direction: -1 | 1) {
    const duration = Date.parse(range.end) - Date.parse(range.start);
    const end = new Date(Math.min(Date.now(), Date.parse(range.end) + direction * duration)).toISOString();
    const start = new Date(Date.parse(end) - duration).toISOString();
    setRange({ start, end }); setDraft({ start: toUTCInput(start), end: toUTCInput(end) });
  }
  async function loadOlder() {
    if (!next) return;
    const requestGeneration = generation.current;
    setBusy(true); setError("");
    try {
      const page = await getHistory(diagram.id, diagram.parameter, range.start, range.end, next);
      if (requestGeneration === generation.current) setPages(previous => [...previous, page]);
    }
    catch (error) { if (requestGeneration === generation.current) setError(error instanceof Error ? error.message : "History unavailable"); }
    finally { if (requestGeneration === generation.current) setBusy(false); }
  }

  return <article className="history-panel" aria-label={`${PARAMETER_LABELS[diagram.parameter]} history for ${diagram.name}`}>
    <div className="panel-heading"><div><span className="eyebrow">{PARAMETER_LABELS[diagram.parameter]} history</span><h2 title={diagram.name}>{diagram.name}</h2></div>
      <button className="icon-button" onClick={onClose} aria-label={`Close ${PARAMETER_LABELS[diagram.parameter]} history`}>×</button></div>
    <div className="chart-toolbar">
      <div className="segmented" aria-label="Prediction type">
        {diagram.parameter === "snow" && <button className={mode === "classes" ? "active" : ""} onClick={() => setMode("classes")}>Snow classes</button>}
        <button className={mode === "raw" ? "active" : ""} onClick={() => setMode("raw")}>Raw model interval</button>
        {diagram.parameter === "visibility" && <button className={mode === "calibrated" ? "active" : ""} onClick={() => setMode("calibrated")}>Calibrated · m</button>}
      </div>
      <div className="chart-period"><button disabled={busy} onClick={() => movePeriod(-1)} aria-label="Earlier period">← Earlier</button>
        <button disabled={busy || Date.parse(range.end) >= Date.now()} onClick={() => movePeriod(1)} aria-label="Later period">Later →</button></div>
      <label>Range <select aria-label="History time range" value={preset} onChange={event => {
        setPreset(event.target.value);
        if (event.target.value === "custom") { setShowDates(true); return; }
        const end = diagram.at ?? new Date().toISOString();
        const start = new Date(Date.parse(end) - Number(event.target.value) * 86400000).toISOString();
        setRange({ start, end }); setDraft({ start: toUTCInput(start), end: toUTCInput(end) });
      }}><option value="custom">Custom</option>{presets.map(days => <option key={days} value={days}>{days < 1 ? `${Math.round(days * 24)} hours` : `${days} day${days > 1 ? "s" : ""}`}</option>)}</select></label>
      <button className="quiet" aria-expanded={showDates} onClick={() => setShowDates(value => !value)}>Dates</button>
      <button className="quiet" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh</button>
    </div>
    {showDates && <form className="chart-range" onSubmit={event => { event.preventDefault(); applyRange(draft.start, draft.end); }}>
      <label>From (UTC)<input type="datetime-local" required value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })} /></label>
      <label>To (UTC)<input type="datetime-local" required value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })} /></label>
      <button type="submit" disabled={busy}>Apply</button>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
    {busy && !pages.length ? <p className="empty" role="status">Loading observations…</p> : <>
      <Suspense fallback={<p className="empty" role="status">Loading chart…</p>}>
        <HistoryChart points={points} parameter={diagram.parameter} mode={mode} start={range.start} end={range.end} mapTime={mapTime} configuration={configuration} />
      </Suspense>
      <div className="chart-footer"><span>{range.start.slice(0, 10)} → {range.end.slice(0, 10)} UTC · {points.length.toLocaleString()} observations · {missing.toLocaleString()} {mode === "classes" ? "without a published snow class" : `without a ${mode} interval`}{!points.length ? " · No observations received in this range" : ""}</span>
        {next && <button disabled={busy} onClick={loadOlder}>{busy ? "Loading…" : "Load older observations"}</button>}</div>
    </>}
    {mode === "calibrated" && <p className="muted small chart-note">Dots: published centre. Display capped above {configuration.visibility_display.ceiling_metres.toLocaleString()} m; hover shows original values.</p>}
    {diagram.parameter === "snow" && <p className="muted small chart-note">{mode === "classes"
      ? "Published snow classes · violet: high cover with two thresholds · red outline: uncertain"
      : "Raw model units, not coverage %. Black dashed lines show the lower threshold; violet dashed lines show the upper threshold. Missing thresholds leave gaps."}</p>}
  </article>;
}
