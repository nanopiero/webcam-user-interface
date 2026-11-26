-- Compact observation metadata. NULL means no qualification has been supplied.
-- Snow codes match the publisher's scene.snow_status: 0 failed, 1 incomplete, 2 qualified.
ALTER TABLE output
    ADD COLUMN snow_qualification smallint CHECK (snow_qualification IN (0, 1, 2)),
    ADD COLUMN visibility_qualification smallint;

COMMENT ON COLUMN output.snow_qualification IS
    'Published snow qualification: 0 disqualified, 1 incomplete, 2 qualified; NULL unknown';
COMMENT ON COLUMN output.visibility_qualification IS
    'Visibility cameras are considered qualified (2); no MQTT qualification lookup';

