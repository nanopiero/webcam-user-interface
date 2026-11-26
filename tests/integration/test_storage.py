import json
from copy import deepcopy
from datetime import UTC, datetime

import pytest
from webcam_ui.ingestion.service import IngestionService
from webcam_ui.settings import BoundingBox, FilterSettings
from webcam_ui.storage.database import Database
from webcam_ui.storage.queries import Queries
from webcam_ui.storage.writer import ObservationWriter

pytestmark = pytest.mark.integration


def test_migrations_are_idempotent(database):
    database.migrate()
    with database.connection() as connection:
        assert connection.execute("SELECT count(*) AS n FROM schema_migration").fetchone()["n"] == 3


def test_upgrade_adds_nullable_thresholds_and_does_not_backfill_them_from_later_observations(database, feature):
    service = IngestionService(ObservationWriter(database, "threshold-upgrade"), FilterSettings())
    assert service.ingest(json.dumps(feature).encode()).accepted == 1
    with database.connection() as connection:
        original = connection.execute("SELECT output_id, fingerprint FROM output").fetchone()
        connection.execute("ALTER TABLE output DROP COLUMN snow_threshold_low, DROP COLUMN snow_threshold_high")
        connection.execute("DELETE FROM schema_migration WHERE version = 3")
    database.migrate()
    assert service.ingest(json.dumps(feature).encode()).duplicates == 1
    feature["properties"]["datetime"] = "2026-11-17T10:01:00Z"
    feature["properties"]["history"] += "; snow_threshold_low=-2.5; snow_threshold_high=0"
    assert service.ingest(json.dumps(feature).encode()).accepted == 1
    assert service.ingest(json.dumps(feature).encode()).duplicates == 1
    with database.connection() as connection:
        rows = connection.execute("SELECT output_id, fingerprint, snow_threshold_low, snow_threshold_high FROM output ORDER BY download_timestamp").fetchall()
    assert rows[0] == {**original, "snow_threshold_low": None, "snow_threshold_high": None}
    assert (rows[1]["snow_threshold_low"], rows[1]["snow_threshold_high"]) == (-2.5, 0.0)


def test_upgrade_fills_past_visibility_with_qualified_code_without_changing_deduplication(database, visibility):
    service = IngestionService(ObservationWriter(database, "upgrade-test"), FilterSettings())
    payload = json.dumps(visibility).encode()
    assert service.ingest(payload).accepted == 1
    # Recreate the original schema shape in this disposable test schema only.
    with database.connection() as connection:
        connection.execute("ALTER TABLE output DROP COLUMN snow_qualification, DROP COLUMN visibility_qualification")
        connection.execute("DELETE FROM schema_migration WHERE version = 2")
    database.migrate()
    database.migrate()
    assert ObservationWriter.backfill_visibility_qualification(database, batch_size=1) == 1
    assert ObservationWriter.backfill_visibility_qualification(database, batch_size=1) == 0
    with database.connection() as connection:
        row = connection.execute("SELECT snow_qualification, visibility_qualification FROM output").fetchone()
    assert row == {"snow_qualification": None, "visibility_qualification": 2}
    assert service.ingest(payload).duplicates == 1


def test_historical_snow_backfill_uses_current_webcam_status_and_keeps_published_qualifications(database, feature):
    legacy, qualified, current = deepcopy(feature), deepcopy(feature), deepcopy(feature)
    legacy["properties"]["history"] = legacy["properties"]["history"].replace("; snow_qualification=qualified", "")
    qualified["properties"]["datetime"] = "2026-11-17T10:01:00Z"
    current["properties"]["datetime"] = "2026-11-17T10:02:00Z"
    current["properties"]["history"] = current["properties"]["history"].replace("snow_qualification=qualified", "snow_qualification=disqualified")
    service = IngestionService(ObservationWriter(database, "backfill-test"), FilterSettings())
    assert service.ingest(json.dumps([current, legacy, qualified]).encode()).accepted == 3
    with database.connection() as connection:
        rows = connection.execute("SELECT snow_qualification, visibility_qualification FROM output ORDER BY download_timestamp").fetchall()
    assert [row["snow_qualification"] for row in rows] == [0, 2, 0]
    assert all(row["visibility_qualification"] is None for row in rows)
    assert service.ingest(json.dumps(legacy).encode()).duplicates == 1


def test_both_parameters_redelivery_and_latest(database, feature, visibility):
    service = IngestionService(ObservationWriter(database, "test-listener"), FilterSettings())
    payload = json.dumps([feature, visibility]).encode()
    assert service.ingest(payload).accepted == 2
    assert service.ingest(payload).duplicates == 2
    queries = Queries(database)
    counts = queries.statistics()
    assert counts["webcams"] == 1
    assert sum(row["observations"] for row in counts["parameters"]) == 2
    assert counts["listeners"][0]["duplicate_observations"] == 2
    camera = queries.map_rows("snow", datetime(2026, 11, 17, 11, tzinfo=UTC), 10)[0]
    latest = queries.latest(camera["processing_stream_id"])
    assert {row["parameter"] for row in latest} == {"snow", "visibility"}
    assert next(row for row in latest if row["parameter"] == "visibility")["visibility_center"] == 5800


def test_republication_ids_ignored_but_revised_prediction_retained(database, feature):
    service = IngestionService(ObservationWriter(database, "test"), FilterSettings())
    assert service.ingest(json.dumps(feature).encode()).accepted == 1
    feature["properties"]["data_id"] = "new-id"
    feature["properties"]["pubtime"] = "2026-11-17T12:00:00Z"
    assert service.ingest(json.dumps(feature).encode()).duplicates == 1
    feature["properties"]["history"] = feature["properties"]["history"].replace("snow_class=1", "snow_class=10")
    assert service.ingest(json.dumps(feature).encode()).accepted == 1
    assert Queries(database).statistics()["parameters"][0]["observations"] == 2


def test_mixed_batch_filters_only_rejected_observations(database, feature):
    rejected = deepcopy(feature)
    rejected["properties"]["country"] = "FI"
    bad = {"schema_version": "N0V0"}
    service = IngestionService(ObservationWriter(database, "test"), FilterSettings())
    result = service.ingest(json.dumps([feature, rejected, bad]).encode(), qos=0)
    assert (result.accepted, result.filtered, result.invalid) == (1, 1, 1)
    status = Queries(database).statistics()
    assert status["listeners"][0]["qos0_messages"] == 1
    with database.connection() as connection:
        assert connection.execute("SELECT country FROM output").fetchone()["country"] is None


def test_out_of_order_data_does_not_replace_latest(database, feature):
    service = IngestionService(ObservationWriter(database, "test"), FilterSettings())
    service.ingest(json.dumps(feature).encode())
    older = deepcopy(feature)
    older["properties"]["datetime"] = "2026-11-16T10:00:00Z"
    older["properties"]["title"] = "Old name"
    service.ingest(json.dumps(older).encode())
    queries = Queries(database)
    row = queries.map_rows("snow", datetime(2026, 11, 17, 11, tzinfo=UTC), 10)[0]
    assert row["name"] == "Example webcam"
    assert queries.latest(row["processing_stream_id"])[0]["download_timestamp"].day == 17
    assert queries.statistics()["parameters"][0]["observations"] == 2


def test_map_selects_latest_across_observation_streams_and_keeps_cameras_without_the_parameter(database, feature, visibility):
    service = IngestionService(ObservationWriter(database, "map-stream-order"), FilterSettings())
    second_stream = deepcopy(feature)
    second_stream["properties"].update(level=1, datetime="2026-11-17T10:03:00Z")
    second_stream["properties"]["history"] = second_stream["properties"]["history"].replace("snow_class=1", "snow_class=10")
    revision = deepcopy(second_stream)
    revision["properties"]["history"] = revision["properties"]["history"].replace("snow_class=10", "snow_class=0").replace("processing_timestamp=2026-11-17T10:00:02Z", "processing_timestamp=2026-11-17T10:03:05Z")
    tied = deepcopy(revision)
    tied["properties"]["history"] = tied["properties"]["history"].replace("snow_class=0", "snow_class=1")
    future = deepcopy(feature)
    future["properties"]["datetime"] = "2026-11-17T10:10:00Z"
    future["properties"]["history"] = future["properties"]["history"].replace("snow_class=1", "snow_class=0")
    visibility["properties"]["datetime"] = "2026-11-17T10:04:00Z"
    visibility_only = deepcopy(visibility)
    visibility_only["properties"]["instrument"] = "win7654321_visibility_t0_g0p0s0"
    assert service.ingest(json.dumps([feature, second_stream, revision, tied, future, visibility, visibility_only]).encode()).accepted == 7
    queries = Queries(database)

    def snow(at):
        rows = queries.map_rows("snow", datetime.fromisoformat(at), 10)
        assert len(rows) == 2
        assert sum(row["download_timestamp"] is None for row in rows) == 1
        return next(row for row in rows if row["download_timestamp"] is not None)

    assert snow("2026-11-17T10:01:00+00:00")["snow_class"] == 1
    # Same download time: later processing wins, then later output ID breaks its tie.
    chosen = snow("2026-11-17T10:04:00+00:00")
    assert chosen["snow_class"] == 1
    assert chosen["download_timestamp"] == datetime(2026, 11, 17, 10, 3, tzinfo=UTC)
    assert snow("2026-11-17T10:11:00+00:00")["snow_class"] == 0
    assert all(row["visibility_center"] == 5800 for row in queries.map_rows("visibility", datetime(2026, 11, 17, 10, 5, tzinfo=UTC), 10))


def test_history_country_is_persisted_and_missing_country_does_not_erase_camera_metadata(database, feature):
    service = IngestionService(ObservationWriter(database, "test"), FilterSettings(allowed_countries=["FI"], bounding_box=BoundingBox(enabled=False)))
    feature["geometry"]["coordinates"] = {"lat": 60.2, "lon": 24.5}
    feature["properties"]["history"] += "; country=FI"
    assert service.ingest(json.dumps(feature).encode()).accepted == 1
    feature["properties"]["datetime"] = "2026-11-17T10:05:00Z"
    feature["properties"]["history"] = feature["properties"]["history"].replace("; country=FI", "")
    assert service.ingest(json.dumps(feature).encode()).accepted == 1
    queries = Queries(database)
    at = datetime(2026, 11, 17, 11, tzinfo=UTC)
    row = queries.map_rows("snow", at, 10, allowed_countries=["FI"])[0]
    assert row["country"] == "FI"
    assert queries.webcam(row["processing_stream_id"])["country"] == "FI"
    assert queries.map_rows("snow", at, 10, allowed_countries=["FR"]) == []
    with database.connection() as connection:
        countries = connection.execute("SELECT country FROM output ORDER BY download_timestamp").fetchall()
    assert [row["country"] for row in countries] == ["FI", None]


def test_blacklist_hides_map_without_changing_history(database, feature):
    service = IngestionService(ObservationWriter(database, "test"), FilterSettings())
    service.ingest(json.dumps(feature).encode())
    queries = Queries(database)
    at = datetime(2026, 11, 17, 11, tzinfo=UTC)
    identifier = queries.map_rows("snow", at, 10)[0]["processing_stream_id"]
    assert queries.set_blacklisted(identifier, "example", "admin")
    assert queries.map_rows("snow", at, 10) == []
    assert len(queries.latest(identifier)) == 1
    queries.unblacklist(identifier)
    assert len(queries.map_rows("snow", at, 10)) == 1


def test_observations_history_and_blacklist_survive_postgres_restart(tmp_path, feature, visibility):
    pgserver = pytest.importorskip("pgserver")
    directory = tmp_path / "persistent-postgres"
    server = pgserver.get_server(directory, cleanup_mode="stop")
    original_pid = server.get_pid()
    database = Database(conninfo=server.get_uri())
    database.open()
    try:
        database.migrate()
        service = IngestionService(ObservationWriter(database, "restart-test"), FilterSettings())
        assert service.ingest(json.dumps([feature, visibility]).encode()).accepted == 2
        feature["properties"]["datetime"] = "2026-11-17T10:05:00Z"
        assert service.ingest(json.dumps(feature).encode()).accepted == 1
        queries = Queries(database)
        identifier = queries.map_rows("snow", datetime(2026, 11, 17, 11, tzinfo=UTC), 10)[0]["processing_stream_id"]
        queries.set_blacklisted(identifier, "Retained after restart", "test-admin")
    finally:
        database.close()
        server.cleanup()
    assert (directory / "PG_VERSION").is_file()

    server = pgserver.get_server(directory, cleanup_mode="stop")
    database = Database(conninfo=server.get_uri())
    database.open()
    try:
        assert server.get_pid() != original_pid
        database.migrate()
        queries = Queries(database)
        assert sum(row["observations"] for row in queries.statistics()["parameters"]) == 3
        assert queries.blacklist()[0]["reason"] == "Retained after restart"
        start, end = datetime(2026, 11, 17, tzinfo=UTC), datetime(2026, 11, 18, tzinfo=UTC)
        assert len(queries.history(identifier, "snow", start, end, 10)) == 2
        assert len(queries.history(identifier, "visibility", start, end, 10)) == 1
        service = IngestionService(ObservationWriter(database, "restart-test"), FilterSettings())
        assert service.ingest(json.dumps(feature).encode()).duplicates == 1
    finally:
        database.close()
        server.cleanup()
