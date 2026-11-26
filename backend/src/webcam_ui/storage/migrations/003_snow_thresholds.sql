-- Thresholds belong to the observation that published them, not a mutable scene record.
-- Nullable columns add no rewrite/backfill of existing observations.
ALTER TABLE output
    ADD COLUMN snow_threshold_low double precision,
    ADD COLUMN snow_threshold_high double precision;

COMMENT ON COLUMN output.snow_threshold_low IS
    'Published lower snow threshold in raw model units; NULL when not supplied';
COMMENT ON COLUMN output.snow_threshold_high IS
    'Published upper snow threshold in raw model units; NULL when not supplied';
