-- Independent UI database: no operational processing state, images, payloads or outbox.
CREATE TABLE derived_stream (
    derived_stream_id text PRIMARY KEY,
    naming_authority text NOT NULL,
    platform text NOT NULL,
    source_stream_id text,
    derived_suffix text,
    platform_name text
);

CREATE TABLE processing_stream (
    processing_stream_id text PRIMARY KEY,
    derived_stream_id text NOT NULL REFERENCES derived_stream,
    processing_suffix text,
    name text NOT NULL,
    latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    altitude double precision,
    country text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
    provider_kind text,
    provider_webcam_id text,
    provider_url text,
    tags text[] NOT NULL DEFAULT '{}',
    metadata_timestamp timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX processing_stream_coordinates_idx ON processing_stream (longitude, latitude);
CREATE INDEX processing_stream_site_idx ON processing_stream (derived_stream_id);

CREATE TABLE observation_stream (
    observation_stream_id text PRIMARY KEY,
    processing_stream_id text NOT NULL REFERENCES processing_stream,
    naming_authority text NOT NULL,
    platform text NOT NULL,
    standard_name text NOT NULL,
    level double precision NOT NULL,
    function text NOT NULL,
    period text NOT NULL,
    instrument text NOT NULL,
    parameter text NOT NULL CHECK (parameter IN ('snow', 'visibility')),
    unit text NOT NULL,
    UNIQUE (naming_authority, platform, standard_name, level, function, period, instrument)
);
CREATE INDEX observation_stream_camera_parameter_idx
    ON observation_stream (processing_stream_id, parameter);

CREATE TABLE output (
    output_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    observation_stream_id text NOT NULL REFERENCES observation_stream,
    fingerprint text NOT NULL UNIQUE,
    download_timestamp timestamptz NOT NULL,
    latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    altitude double precision,
    country text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
    snow_raw_lower double precision,
    snow_raw_upper double precision,
    snow_class integer,
    visibility_raw_lower double precision,
    visibility_raw_upper double precision,
    visibility_lower double precision,
    visibility_upper double precision,
    visibility_center double precision,
    acquisition_timestamp timestamptz,
    processing_timestamp timestamptz,
    provider_timestamp timestamptz,
    publication_timestamp timestamptz,
    esoh_pubtime timestamptz,
    publication_id text,
    model_version text,
    postprocessing_version text,
    image_access text,
    processing_level text,
    quality_code integer,
    received_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((snow_raw_lower IS NULL) = (snow_raw_upper IS NULL)),
    CHECK ((visibility_raw_lower IS NULL) = (visibility_raw_upper IS NULL)),
    CHECK ((visibility_lower IS NULL) = (visibility_upper IS NULL)),
    CHECK (snow_raw_lower <= snow_raw_upper),
    CHECK (visibility_raw_lower <= visibility_raw_upper),
    CHECK (visibility_lower >= 0 AND visibility_lower <= visibility_upper),
    CHECK (visibility_center >= 0)
);
CREATE INDEX output_stream_latest_idx ON output (
    observation_stream_id, download_timestamp DESC,
    processing_timestamp DESC NULLS LAST, output_id DESC
);
CREATE INDEX output_time_idx ON output (download_timestamp DESC);

CREATE VIEW latest_snow_outputs AS
SELECT DISTINCT ON (s.processing_stream_id) s.processing_stream_id, o.*
FROM output o JOIN observation_stream s USING (observation_stream_id)
WHERE s.parameter = 'snow'
ORDER BY s.processing_stream_id, o.download_timestamp DESC,
         o.processing_timestamp DESC NULLS LAST, o.output_id DESC;

CREATE VIEW latest_visibility_outputs AS
SELECT DISTINCT ON (s.processing_stream_id) s.processing_stream_id, o.*
FROM output o JOIN observation_stream s USING (observation_stream_id)
WHERE s.parameter = 'visibility'
ORDER BY s.processing_stream_id, o.download_timestamp DESC,
         o.processing_timestamp DESC NULLS LAST, o.output_id DESC;

CREATE TABLE webcam_blacklist (
    processing_stream_id text PRIMARY KEY REFERENCES processing_stream,
    reason text NOT NULL DEFAULT '',
    updated_by text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Listener health is ingestion telemetry, never an invented ML processing status.
CREATE TABLE listener_state (
    client_id text PRIMARY KEY,
    connected boolean NOT NULL DEFAULT false,
    heartbeat_at timestamptz NOT NULL DEFAULT now(),
    last_message_at timestamptz,
    last_persisted_at timestamptz,
    received_messages bigint NOT NULL DEFAULT 0,
    accepted_observations bigint NOT NULL DEFAULT 0,
    duplicate_observations bigint NOT NULL DEFAULT 0,
    filtered_observations bigint NOT NULL DEFAULT 0,
    invalid_observations bigint NOT NULL DEFAULT 0,
    qos0_messages bigint NOT NULL DEFAULT 0,
    qos1_messages bigint NOT NULL DEFAULT 0
);
