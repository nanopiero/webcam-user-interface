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
    return { start: new Date(Date.parse(end) - configuration.diagram.initial_days * 86400000).toISOString(), end };
  });
  const [draft, setDraft] = useState({ start: toUTCInput(range.start), end: toUTCInput(range.end) });
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
      setRange(next); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "Invalid date range"); }
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
      <label>Range <select aria-label="History time range" defaultValue="custom" onChange={event => {
        if (event.target.value === "custom") return;
        const end = diagram.at ?? new Date().toISOString();
        const start = new Date(Date.parse(end) - Number(event.target.value) * 86400000).toISOString();
        setRange({ start, end }); setDraft({ start: toUTCInput(start), end: toUTCInput(end) });
      }}><option value="custom">Custom</option><option value={1 / 24}>1 hour</option><option value={6 / 24}>6 hours</option>{[1, 7, 30, 90, 366].filter(days => days <= configuration.diagram.max_days).map(days => <option key={days} value={days}>{days} day{days > 1 ? "s" : ""}</option>)}</select></label>
      <button className="quiet" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh</button>
    </div>
    <form className="chart-range" onSubmit={event => { event.preventDefault(); applyRange(draft.start, draft.end); }}>
      <label>From (UTC)<input type="datetime-local" required value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })} /></label>
      <label>To (UTC)<input type="datetime-local" required value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })} /></label>
      <button type="submit" disabled={busy}>Apply</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {busy && !pages.length ? <p className="empty" role="status">Loading observations…</p> : <>
      <Suspense fallback={<p className="empty" role="status">Loading chart…</p>}>
        <HistoryChart points={points} parameter={diagram.parameter} mode={mode} start={range.start} end={range.end} mapTime={mapTime} configuration={configuration} />
      </Suspense>
      <div className="chart-footer"><span>{points.length.toLocaleString()} observations · {missing.toLocaleString()} {mode === "classes" ? "without a published snow class" : `without a ${mode} interval`}{!points.length ? " · No observations received in this range" : ""}</span>
        {next && <button disabled={busy} onClick={loadOlder}>{busy ? "Loading…" : "Load older observations"}</button>}</div>
    </>}
    {mode === "calibrated" && <p className="muted small chart-note">Dots show the published centre. Values above {configuration.visibility_display.ceiling_metres.toLocaleString()} m share a display band; the readout retains the original values.</p>}
    {diagram.parameter === "snow" && <p className="muted small chart-note">Snow classes are categorical: no snow, intermediate cover, undifferentiated snow, and high cover when both thresholds were published. Raw model values are not a coverage percentage.
      {" Black dashed lines show the lower threshold; violet dashed lines show the upper threshold, as published with each observation. Missing thresholds leave gaps."}
      {mode === "classes" && " Threshold values use the separate right-hand axis in raw model units."}</p>}
  </article>;
}
