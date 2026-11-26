from copy import deepcopy
from pathlib import Path

import pytest


@pytest.fixture
def feature():
    """Synthetic data following the implemented mapper, never a captured private payload."""
    return {
        "type": "Feature", "version": "v4.0",
        "geometry": {"type": "Point", "coordinates": {"lon": 2.398, "lat": 47.084}},
        "properties": {
            "naming_authority": "eu.eumetnet", "platform": "0-23003-1-win1234567",
            "platform_name": "Example site", "title": "Example webcam",
            "instrument": "win1234567_snow_t0_g0p0s0", "level": 0.0,
            "period": "PT0S", "function": "point", "hamsl": 123.0,
            "datetime": "2026-11-17T10:00:00Z", "processing_level": "derived",
            "quality_code": 0, "keywords": "outdoor, mountain",
            "history": "derived_stream=t0; processing_stream=g0p0s0; acquisition_timestamp=2026-11-17T10:00:01Z; processing_timestamp=2026-11-17T10:00:02Z; model=WEOW-example; postprocessing=V0; raw_interval=(-4.2, -3.1); snow_class=1; snow_qualification=qualified",
            "content": {"standard_name": "surface_snow_area_fraction", "unit": "1",
                        "encoding": "utf-8", "value": "NaN"},
            "data_id": "example:publication-1", "pubtime": "2026-11-17T10:00:03Z",
        },
        "links": [{"rel": "about", "href": "useAPI", "type": "text/html"}],
    }


@pytest.fixture
def visibility(feature):
    result = deepcopy(feature)
    p = result["properties"]
    p["instrument"] = "win1234567_visibility_t0_g0p0s0"
    p["content"].update(standard_name="visibility_in_air", unit="m", value="5800")
    p["history"] = p["history"].replace("raw_interval=(-4.2, -3.1); snow_class=1",
                                      "raw_interval=(-2.3, -1.0); calibrated_interval=(5000, 7000)")
    p["history"] = p["history"].replace("; snow_qualification=qualified", "")
    return result


@pytest.fixture(scope="session")
def postgres_uri(tmp_path_factory):
    import os
    if value := os.environ.get("WEBCAM_TEST_DATABASE_URL"):
        # This must be an exclusively disposable test database. Tests use a private schema.
        yield value
        return
    pgserver = pytest.importorskip("pgserver", reason="install .[dev] or set WEBCAM_TEST_DATABASE_URL")
    directory = tmp_path_factory.mktemp("postgres")
    server = pgserver.get_server(Path(directory) / "data", cleanup_mode="stop")
    try:
        yield server.get_uri()
    finally:
        server.cleanup()


@pytest.fixture
def database(postgres_uri):
    import uuid

    import psycopg
    from psycopg.conninfo import make_conninfo
    from webcam_ui.storage.database import Database
    schema = "test_" + uuid.uuid4().hex
    with psycopg.connect(postgres_uri, autocommit=True) as connection:
        connection.execute(psycopg.sql.SQL("CREATE SCHEMA {}").format(psycopg.sql.Identifier(schema)))
    database = Database(conninfo=make_conninfo(postgres_uri,
                         options=f"-c search_path={schema} -c timezone=UTC"))
    database.open()
    database.migrate()
    try:
        yield database
    finally:
        database.close()
        with psycopg.connect(postgres_uri, autocommit=True) as connection:
            connection.execute(psycopg.sql.SQL("DROP SCHEMA {} CASCADE").format(psycopg.sql.Identifier(schema)))
