import type {
  AdminSession, BlacklistEntry, CollectionStatus, FrontendConfiguration,
  HistoryPayload, MapPayload, Parameter, ProviderLinks, WebcamDetail,
  SupplementaryPayload, SupplementaryDetail,
  AltitudeBand,
  ProviderMedia,
} from "./contracts";

export class APIError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { cache: "no-store", ...options, headers, credentials: "same-origin" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new APIError(response.status, typeof body?.detail === "string" ? body.detail : `Request failed (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const getConfiguration = () => request<FrontendConfiguration>("/frontend-config.json");
export const getCollectionStatus = (signal?: AbortSignal) => request<CollectionStatus>("/api/status", { signal });
export interface MapScope {
  altitudeBand?: AltitudeBand;
  countries?: string[];
  includeUnknownCountry?: boolean;
  qualifiedOnly?: boolean;
}

export function getMap(parameter: Parameter, at: string | null, signal?: AbortSignal, scope: MapScope = {}) {
  const query = new URLSearchParams({ parameter });
  if (at) query.set("at", at);
  query.set("qualified_only", String(scope.qualifiedOnly ?? true));
  if (scope.altitudeBand && scope.altitudeBand !== "all") query.set("altitude_band", scope.altitudeBand);
  if (scope.countries !== undefined) {
    query.set("countries", scope.countries.join(","));
    query.set("include_unknown_country", String(scope.includeUnknownCountry ?? false));
  }
  return request<MapPayload>(`/api/map?${query}`, { signal });
}
export const getWebcam = (id: string, signal?: AbortSignal) => request<WebcamDetail>(`/api/webcams/${encodeURIComponent(id)}`, { signal });
export const getProvider = (id: string, signal?: AbortSignal) => request<ProviderLinks>(`/api/webcams/${encodeURIComponent(id)}/provider?current_image=true`, { signal });
export const getSupplementary = (signal?: AbortSignal) => request<SupplementaryPayload>("/api/supplementary-webcams", { signal });
export const getSupplementaryWebcam = (id: string, signal?: AbortSignal) => request<SupplementaryDetail>(`/api/supplementary-webcams/${encodeURIComponent(id)}`, { signal });
export const getSupplementaryProvider = (id: string, signal?: AbortSignal) => request<ProviderMedia>(`/api/supplementary-webcams/${encodeURIComponent(id)}/provider`, { signal });
export function getHistory(id: string, parameter: Parameter, start: string, end: string, cursor?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ parameter, start, end, limit: "10000" });
  if (cursor) query.set("cursor", cursor);
  return request<HistoryPayload>(`/api/webcams/${encodeURIComponent(id)}/history?${query}`, { signal });
}
export const getSession = () => request<AdminSession>("/api/admin/session");
export const login = (username: string, password: string) => request<AdminSession>("/api/admin/login", {
  method: "POST", body: JSON.stringify({ username, password }),
});
export const logout = (csrf: string) => request<void>("/api/admin/logout", { method: "POST", headers: { "X-CSRF-Token": csrf } });
export const getBlacklist = () => request<{ items: BlacklistEntry[] }>("/api/admin/blacklist");
export const blacklist = (id: string, reason: string, csrf: string) => request(`/api/admin/blacklist/${encodeURIComponent(id)}`, {
  method: "PUT", headers: { "X-CSRF-Token": csrf }, body: JSON.stringify({ reason }),
});
export const restore = (id: string, csrf: string) => request<void>(`/api/admin/blacklist/${encodeURIComponent(id)}`, {
  method: "DELETE", headers: { "X-CSRF-Token": csrf },
});
