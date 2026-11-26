import { useEffect, useRef, useState } from "react";
import { getMap } from "../../api/client";
import type { MapPayload, Parameter } from "../../api/contracts";
import { mergeMapPayload } from "./cache";
import type { CountrySelection } from "./countries";

interface Cache {
  context: string;
  revision: number;
  loaded: Set<string | null>;
  data: MapPayload | null;
}

export function useMapData(parameter: Parameter, at: string | null, revision: number, countries: CountrySelection, qualifiedOnly = true) {
  const qualificationFilter = qualifiedOnly;
  const context = JSON.stringify([parameter, at, qualificationFilter]);
  const selection = JSON.stringify([...countries].sort());
  const cache = useRef<Cache>({ context, revision: -1, loaded: new Set(), data: null });
  const [result, setResult] = useState<Cache>(cache.current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (cache.current.context !== context) cache.current = { context, revision: -1, loaded: new Set(), data: null };
    const current = cache.current;
    const selected = new Set<string | null>(JSON.parse(selection));
    setError("");
    if (!selected.size || (current.revision === revision && [...selected].every(country => current.loaded.has(country)))) {
      setResult(current); setBusy(false);
      return;
    }
    const abort = new AbortController();
    setResult(current); setBusy(true);
    getMap(parameter, at, abort.signal, {
      countries: [...selected].filter((value): value is string => value !== null),
      includeUnknownCountry: selected.has(null),
      qualifiedOnly: qualificationFilter,
    }).then(incoming => {
      if (abort.signal.aborted) return;
      const next = { context, revision, loaded: new Set([...current.loaded, ...selected]),
        data: mergeMapPayload(current.data, incoming, selected) };
      cache.current = next; setResult(next);
    }).catch(error => { if (!abort.signal.aborted) setError(error.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [context, selection, revision, parameter, at, qualificationFilter]);

  return { data: result.context === context ? result.data : null,
    loadedCountries: result.context === context ? result.loaded : new Set<string | null>(), busy, error };
}
