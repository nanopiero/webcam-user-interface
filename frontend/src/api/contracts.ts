/** Public read/admin contracts; no operational namespaces, scene state or image archives. */
export type Parameter = "snow" | "visibility";
export type AltitudeBand = "all" | "low" | "middle" | "high";
export interface BorderVisibility { national: boolean; regions: boolean; departments: boolean }
export type DiagramMode = "raw" | "calibrated" | "classes";

export interface FrontendConfiguration {
  countries: string[];
  roi: { name: string; countries: string[] };
  map: {
    center: [number, number];
    zoom: number;
    marker_scale?: number;
    borders?: BorderVisibility;
    basemap: { tiles: string[]; attribution: string; maxzoom?: number };
  };
  default_parameter: Parameter;
  parameters: Parameter[];
  pie_sector_limit: number;
  diagram: { initial_days: number; max_days: number };
  visibility_display: { ceiling_metres: number; saturated_band_metres: number };
}

export interface Camera {
  p: string;
  name: string;
  x: number;
  y: number;
  altitude: number | null;
  country: string | null;
  qs?: number | null;
  freshness?: "fresh" | "ageing" | "expired" | "missing";
  cls: string;
  u: boolean;
  w: string | null;
  t: string | null;
  vl: number | null;
  vu: number | null;
  value: number | null;
}

export interface SiteFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: string;
    platform: string;
    name: string | null;
    cams: Camera[];
    n: number;
    cls: string;
    u: boolean;
    tie?: boolean;
    pie?: string[];
  };
}

export interface FreshnessPolicy {
  fresh_minutes: number;
  max_age_minutes: number;
}

export interface MapPayload {
  type: "FeatureCollection";
  parameter: Parameter;
  at: string;
  qualified_only?: boolean;
  freshness?: FreshnessPolicy;
  counts: { sites: number; cameras: number };
  features: SiteFeature[];
}

export interface SupplementaryFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { id: string; name: string; altitude: number | null; source_layer_name: string };
}
export interface SupplementaryPayload {
  type: "FeatureCollection";
  enabled: boolean;
  minimum_distance_metres: number;
  counts: { csv_webcams: number; visible: number; now_near_database: number };
  features: SupplementaryFeature[];
}
export interface SupplementaryDetail {
  id: string; name: string; latitude: number; longitude: number; altitude: number | null;
  altitude_source: string | null; altitude_band: string | null;
  provider_url: string | null; links: string[]; description: string;
  source_map_url: string | null; source_map_name: string; source_layer_name: string;
  source_feature_id: string; exported_at: string | null; metadata: Record<string, unknown>;
}
export interface ProviderMedia { page_url: string | null; media: { kind: "image" | "video" | "frame"; url: string }[] }

export interface SnowThresholds {
  snow_threshold_low?: number | null;
  snow_threshold_high?: number | null;
}

export interface Prediction extends SnowThresholds {
  output_id: number;
  parameter: Parameter;
  download_timestamp: string;
  acquisition_timestamp: string | null;
  processing_timestamp: string | null;
  received_at: string;
  provider_timestamp: string | null;
  publication_timestamp: string | null;
  snow_raw_lower: number | null;
  snow_raw_upper: number | null;
  snow_class: number | null;
  snow_qualification?: number | null;
  visibility_qualification?: number | null;
  visibility_raw_lower: number | null;
  visibility_raw_upper: number | null;
  visibility_lower: number | null;
  visibility_upper: number | null;
  visibility_center: number | null;
  model_version: string | null;
  quality_code: number | null;
}

export interface ProviderLinks {
  page_url: string | null;
  image_url: string | null;
  available: boolean;
  image_embeddable: boolean;
  image_unavailable_reason?: string;
}

export interface WebcamDetail {
  processing_stream_id: string;
  derived_stream_id: string;
  source_stream_id: string | null;
  derived_suffix: string | null;
  processing_suffix: string | null;
  platform: string;
  platform_name: string | null;
  name: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  country: string | null;
  provider_kind: string | null;
  tags: string[];
  blacklisted: boolean;
  predictions: Prediction[];
  provider: ProviderLinks;
}

export interface HistoryPoint extends SnowThresholds {
  id: number;
  t: string;
  lower: number | null;
  upper: number | null;
  snow_class: number | null;
  snow_qualification?: number | null;
  visibility_qualification?: number | null;
  calibrated_lower: number | null;
  calibrated_upper: number | null;
  calibrated_center: number | null;
  model_version: string | null;
  postprocessing_version: string | null;
  quality_code: number | null;
}

export interface HistoryPayload {
  processing_stream_id: string;
  parameter: Parameter;
  start: string;
  end: string;
  intervals: HistoryPoint[];
  without_raw_interval: HistoryPoint[];
  truncated: boolean;
  next_cursor: string | null;
}

export interface CollectionStatus {
  webcams: number;
  blacklisted: number;
  parameters: { parameter: Parameter; observations: number; newest: string | null }[];
  listeners: { connected: boolean; heartbeat_at: string; last_message_at: string | null }[];
}

export interface AdminSession { username: string; csrf_token: string }
export interface BlacklistEntry {
  processing_stream_id: string;
  name: string;
  reason: string;
  updated_at: string;
  updated_by: string;
}
