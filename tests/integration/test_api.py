import json

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from webcam_ui.api.app import create_app
from webcam_ui.ingestion.service import IngestionService
from webcam_ui.settings import (
    AuthSettings,
    BackendSettings,
    BoundingBox,
    FilterSettings,
    ROISettings,
)
from webcam_ui.storage.database import Database
from webcam_ui.storage.writer import ObservationWriter

pytestmark = pytest.mark.integration


@pytest.fixture
def api(database, tmp_path):
    password = tmp_path / "password_hash"
    password.write_text(PasswordHasher().hash("test-password-long-enough"))
    secret = tmp_path / "session_secret"
    secret.write_text("unit-test-session-secret-at-least-32-characters")
    frontend = tmp_path / "frontend.json"
    frontend.write_text('{"map":{"center":[2.398,47.084],"zoom":5.5}}')
    settings = BackendSettings(auth=AuthSettings(password_hash_file=password,
                                                session_secret_file=secret))
    settings.api.frontend_config_file = frontend
    dist = tmp_path / "frontend-dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text('<!doctype html><html><body><div id="root"></div></body></html>')
    (dist / "assets" / "app-example.js").write_text('console.log("test asset")')
    settings.api.frontend_dist_directory = dist
    # The application owns its own pool; the ingestion/test fixture retains another.
    app_database = Database(conninfo=database.pool.conninfo)
    with TestClient(create_app(settings, database=app_database), base_url="https://testserver") as client:
        yield client


def seed(database, feature, visibility=None):
    service = IngestionService(ObservationWriter(database, "test"), FilterSettings())
    return service.ingest(json.dumps([feature, visibility] if visibility else feature).encode())


def login(api):
    response = api.post("/api/admin/login", json={"username": "admin", "password": "test-password-long-enough"})
    assert response.status_code == 200, response.text
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "Secure" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]
    return response.json()["csrf_token"]


def test_health_status_and_frontend_configuration(api):
    assert api.get("/health/live").status_code == 200
    assert api.get("/health/ready").status_code == 200
    assert api.get("/api/status").json()["webcams"] == 0
    assert api.get("/frontend-config.json").json()["map"]["center"] == [2.398, 47.084]
    text = api.get("/api/config").text
    assert "password" not in text
    assert "mqtt.example" not in text


def test_country_configuration_drives_the_frontend_without_a_second_country_list(api):
    api.app.state.settings.filters.allowed_countries = ["GB", "FI"]
    api.app.state.settings.roi = ROISettings(name="United Kingdom", countries=["GB"])
    config = api.get("/frontend-config.json").json()
    assert config["countries"] == ["GB", "FI"]
    assert config["roi"] == {"name": "United Kingdom", "countries": ["GB"]}
    assert api.get("/api/config").json()["filters"]["allowed_countries"] == config["countries"]


def test_country_requests_and_deployment_bbox_filter_previously_stored_webcams(api, database, feature):
    from copy import deepcopy

    service = IngestionService(ObservationWriter(database, "test"),
                               FilterSettings(allowed_countries=["FR", "DE", "NL"],
                                              bounding_box=BoundingBox(enabled=False)))
    for index, (country, lon, lat) in enumerate([("FR", 2, 47), ("DE", 8, 49), ("DE", 13, 53),
                                                ("NL", 5, 51), (None, 3, 48)]):
        webcam = deepcopy(feature)
        webcam["properties"]["instrument"] = f"win{index + 1000000}_snow_t0_g0p0s0"
        webcam["geometry"]["coordinates"] = [lon, lat]
        if country:
            webcam["properties"]["history"] += f"; country={country}"
        assert service.ingest(json.dumps(webcam).encode()).accepted == 1
    for countries, count in [("FR", 1), ("FR,DE", 2), ("", 0)]:
        response = api.get("/api/map", params={"countries": countries, "include_unknown_country": False})
        assert response.status_code == 200
        assert response.json()["counts"]["cameras"] == count
        assert response.headers.get("content-type", "").startswith("application/json")
    assert api.get("/api/map", params={"countries": "", "include_unknown_country": True}).json()["counts"]["cameras"] == 1
    assert api.get("/api/map?countries=NL").status_code == 422
    assert api.get("/api/map?countries=FR,DE&bbox=12,52,14,54").json()["features"] == []
    assert api.get("/api/map?countries=DE&bbox=1,41,3,45").json()["features"] == []


def test_published_country_reaches_map_and_metadata_and_configuration_filters_existing_data(api, database, feature):
    feature["properties"]["history"] += "; country=FR"
    assert seed(database, feature).accepted == 1
    data = api.get("/api/map").json()
    camera = data["features"][0]["properties"]["cams"][0]
    assert camera["country"] == "FR"
    assert api.get(f"/api/webcams/{camera['p']}").json()["country"] == "FR"
    api.app.state.settings.filters.allowed_countries = ["GB"]
    assert api.get("/api/map").json()["features"] == []


def test_default_snow_view_withholds_unqualified_results_as_white_discs_and_uses_latest_status(api, database, feature):
    from copy import deepcopy

    for index, token in enumerate(["qualified", "disqualified", "incomplete", None]):
        webcam = deepcopy(feature)
        webcam["properties"]["instrument"] = f"win{1000000 + index}_snow_t0_g0p0s0"
        history = webcam["properties"]["history"].replace("snow_class=1", "snow_class=31")
        webcam["properties"]["history"] = (history.replace("snow_qualification=qualified", f"snow_qualification={token}")
                                             if token else history.replace("; snow_qualification=qualified", ""))
        seed(database, webcam)
    params = {"parameter": "snow", "at": "2026-11-17T10:10:00Z"}
    default = api.get("/api/map", params=params).json()
    assert default["counts"]["cameras"] == 4
    assert default["qualified_only"] is True
    cameras = [camera for site in default["features"] for camera in site["properties"]["cams"]]
    assert next(camera for camera in cameras if camera["qs"] == 2)["cls"] == "snow.undifferentiated"
    for camera in cameras:
        if camera["qs"] != 2:
            assert camera["cls"] == "white" and camera["u"] is False
            assert camera["w"] == ("qualification_unknown" if camera["qs"] is None else "scene_unqualified")
    unfiltered = api.get("/api/map", params={**params, "qualified_only": False}).json()
    assert unfiltered["counts"] == default["counts"]
    assert all(camera["cls"] == "snow.undifferentiated" and camera["u"]
               for site in unfiltered["features"] for camera in site["properties"]["cams"])
    from datetime import UTC, datetime

    from webcam_ui.storage.queries import Queries
    rows = Queries(database).map_rows("snow", datetime(2026, 11, 17, 11, tzinfo=UTC), 10, qualified_only=True)
    assert all(row["snow_class"] is None for row in rows if row["snow_qualification"] != 2)
    newest = deepcopy(feature)
    newest["properties"]["instrument"] = "win1000000_snow_t0_g0p0s0"
    newest["properties"]["datetime"] = "2026-11-17T10:05:00Z"
    newest["properties"]["history"] = newest["properties"]["history"].replace("snow_qualification=qualified", "snow_qualification=disqualified")
    seed(database, newest)
    refreshed = api.get("/api/map", params=params).json()
    # A newer disqualified result must never fall back to the older qualified class.
    assert refreshed["counts"]["cameras"] == 4
    assert all(camera["cls"] == "white" for site in refreshed["features"] for camera in site["properties"]["cams"])


def test_visibility_remains_qualified_and_is_unaffected_by_snow_view_filter(api, database, visibility):
    seed(database, visibility)
    params = {"parameter": "visibility", "at": "2026-11-17T10:10:00Z"}
    first = api.get("/api/map", params=params).json()
    second = api.get("/api/map", params={**params, "qualified_only": False}).json()
    assert first["features"] == second["features"]
    camera = first["features"][0]["properties"]["cams"][0]
    assert camera["qs"] == 2 and camera["cls"] != "white"
    detail = api.get(f"/api/webcams/{camera['p']}").json()
    assert detail["predictions"][0]["visibility_qualification"] == 2


@pytest.mark.parametrize("fixture,qualification", [("feature", "qualified"), ("feature", "disqualified"),
    ("feature", "incomplete"), ("feature", None), ("visibility", None)])
def test_map_expires_at_configured_download_age_before_qualification_and_ignores_later_pipeline_times(api, database, request, fixture, qualification):
    feature = request.getfixturevalue(fixture)
    history = feature["properties"]["history"]
    if fixture == "feature":
        history = (history.replace("snow_qualification=qualified", f"snow_qualification={qualification}")
                   if qualification else history.replace("; snow_qualification=qualified", ""))
    feature["properties"]["history"] = history.replace("acquisition_timestamp=2026-11-17T10:00:01Z", "acquisition_timestamp=2026-11-17T10:14:00Z")
    feature["properties"]["pubtime"] = "2026-11-17T10:14:30Z"
    assert seed(database, feature).accepted == 1
    parameter = "snow" if fixture == "feature" else "visibility"
    assert api.get("/api/config").json()["max_prediction_age_minutes"] == 15

    def camera(at, qualified_only=True):
        response = api.get("/api/map", params={"parameter": parameter, "at": at, "qualified_only": qualified_only})
        assert response.status_code == 200
        return response.json()["features"][0]["properties"]["cams"][0]

    recent = camera("2026-11-17T10:14:59Z")
    assert recent["w"] not in ("no_record", "stale")
    if fixture == "feature" and qualification != "qualified":
        assert recent["cls"] == "white"
        assert recent["w"] in ("scene_unqualified", "qualification_unknown")
    else:
        assert recent["cls"] != "white"
    for qualified_only in (True, False):
        expired = camera("2026-11-17T10:15:00Z", qualified_only)
        assert (expired["cls"], expired["w"], expired["u"]) == ("white", "stale", False)
        assert expired["vl"] is None and expired["vu"] is None and expired["value"] is None
        assert camera("2026-11-17T10:20:00Z", qualified_only)["w"] == "stale"
    api.app.state.settings.api.prediction_max_age_minutes = 30
    assert camera("2026-11-17T10:20:00Z")["w"] != "stale"


def test_high_snow_uses_each_observations_thresholds_and_keeps_qualification_filtering(api, database, feature):
    from copy import deepcopy

    cases = [(1, True, "qualified", "snow.high"), (31, True, "qualified", "snow.high"),
             (1, False, "qualified", "snow.undifferentiated"), (10, True, "qualified", "snow.intermediate"),
             (0, True, "qualified", "snow.none"), (1, True, "disqualified", "white")]
    for index, (code, both, qualification, _) in enumerate(cases):
        webcam = deepcopy(feature)
        webcam["properties"]["instrument"] = f"win{1000000 + index}_snow_t0_g0p0s0"
        webcam["properties"]["title"] = str(index)
        webcam["properties"]["history"] = webcam["properties"]["history"].replace("snow_class=1", f"snow_class={code}").replace("snow_qualification=qualified", f"snow_qualification={qualification}")
        webcam["properties"]["history"] += "; snow_threshold_low=-2.5" + ("; snow_threshold_high=0" if both else "")
        assert seed(database, webcam).accepted == 1
    params = {"parameter": "snow", "at": "2026-11-17T10:10:00Z"}
    response = api.get("/api/map", params=params)
    assert response.status_code == 200
    cameras = {camera["name"]: camera for site in response.json()["features"] for camera in site["properties"]["cams"]}
    assert [cameras[str(index)]["cls"] for index in range(len(cases))] == [case[3] for case in cases]
    assert cameras["1"]["u"] is True and cameras["0"]["u"] is False
    identifier = cameras["0"]["p"]
    prediction = api.get(f"/api/webcams/{identifier}").json()["predictions"][0]
    assert (prediction["snow_class"], prediction["snow_threshold_low"], prediction["snow_threshold_high"]) == (1, -2.5, 0)
    history = api.get(f"/api/webcams/{identifier}/history", params={"start": "2026-11-17T00:00:00Z", "end": "2026-11-18T00:00:00Z"}).json()
    point = history["intervals"][0]
    assert (point["snow_class"], point["snow_threshold_low"], point["snow_threshold_high"]) == (1, -2.5, 0)
    unfiltered = api.get("/api/map", params={**params, "qualified_only": False}).json()
    assert next(camera for site in unfiltered["features"] for camera in site["properties"]["cams"] if camera["name"] == "5")["cls"] == "snow.high"


def test_supplementary_catalogue_excludes_all_database_webcams_including_blacklisted(api, database, feature, tmp_path):
    import csv

    seed(database, feature)
    settings = api.app.state.settings.supplementary_webcams
    settings.enabled = True
    settings.csv_file = tmp_path / "extra.csv"
    with settings.csv_file.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=["id", "name", "lat", "lon", "altitude", "metadata_json"])
        writer.writeheader()
        writer.writerows([{"id": "near", "name": "Near existing webcam", "lat": 47.084, "lon": 2.398},
                          {"id": "far", "name": "Additional webcam", "lat": 48, "lon": 3,
                           "altitude": 120, "metadata_json": '{"custom":"preserved"}'}])
    identifier = api.get("/api/map").json()["features"][0]["properties"]["cams"][0]["p"]
    with database.connection() as connection:
        connection.execute("INSERT INTO webcam_blacklist(processing_stream_id,reason,updated_by) VALUES (%s,%s,%s)",
                           (identifier, "test", "test-admin"))
    data = api.get("/api/supplementary-webcams").json()
    assert data["counts"] == {"csv_webcams": 2, "visible": 1, "now_near_database": 1}
    assert data["features"][0]["properties"]["id"] == "far"
    assert api.get("/api/supplementary-webcams/far").json()["metadata"] == {"custom": "preserved"}
    assert api.get("/api/supplementary-webcams/missing").status_code == 404
    assert api.get("/api/supplementary-webcams?bbox=0,0,1,1").json()["features"] == []
    assert api.get("/api/supplementary-webcams?bbox=NaN,0,1,1").status_code == 422
    assert sum(row["observations"] for row in api.get("/api/status").json()["parameters"]) == 1


def test_altitude_bands_filter_individual_cameras_before_site_classification(api, database, feature):
    from copy import deepcopy

    for position, altitude in enumerate([499, 500, 1000, 1001, None]):
        webcam = deepcopy(feature)
        webcam["properties"]["instrument"] = f"win{position + 1000000}_snow_t0_g0p0s0"
        webcam["properties"]["hamsl"] = altitude
        seed(database, webcam)
    expected = {"all": 5, "low": 1, "middle": 2, "high": 1}
    for band, count in expected.items():
        response = api.get("/api/map", params={"altitude_band": band})
        assert response.status_code == 200
        assert response.json()["counts"]["cameras"] == count
        cameras = [camera for site in response.json()["features"] for camera in site["properties"]["cams"]]
        assert len(cameras) == count
        assert all("altitude" in camera for camera in cameras)


def test_frontend_delivery_keeps_api_and_missing_assets_distinct(api):
    response = api.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert 'id="root"' in response.text
    assert response.headers["cache-control"] == "no-cache"
    asset = api.get("/assets/app-example.js")
    assert asset.status_code == 200
    assert "immutable" in asset.headers["cache-control"]
    assert api.get("/assets/absent.js").status_code == 404
    assert api.get("/api/unknown-endpoint").status_code == 404
    assert api.get("/.secrets/admin_initial_password").status_code == 404


def test_map_popup_and_both_histories(api, database, feature, visibility):
    seed(database, feature, visibility)
    for parameter in ("snow", "visibility"):
        response = api.get("/api/map", params={"parameter": parameter, "at": "2026-11-17T10:10:00Z"})
        assert response.status_code == 200
        data = response.json()
        assert data["counts"] == {"sites": 1, "cameras": 1}
        camera = data["features"][0]["properties"]["cams"][0]
        assert camera["cls"] != "white"
        detail = api.get(f"/api/webcams/{camera['p']}").json()
        assert len(detail["predictions"]) == 2
        assert detail["provider"]["page_url"] == "https://www.windy.com/webcams/1234567"
        result = api.get(f"/api/webcams/{camera['p']}/history", params={
            "parameter": parameter, "start": "2026-11-17T00:00:00Z", "end": "2026-11-18T00:00:00Z"})
        assert result.status_code == 200
        interval = result.json()["intervals"][0]
        assert "status" not in interval
        assert "scene_index" not in interval
        assert "image" not in interval
        if parameter == "visibility":
            assert interval["calibrated_center"] == 5800


def test_history_paginates_without_losing_revisions(api, database, feature):
    for minute in range(5):
        feature["properties"]["datetime"] = f"2026-11-17T10:0{minute}:00Z"
        seed(database, feature)
    camera = api.get("/api/map", params={"at": "2026-11-17T11:00:00Z"}).json()["features"][0]["properties"]["cams"][0]["p"]
    params = {"start": "2026-11-17T00:00:00Z", "end": "2026-11-18T00:00:00Z", "limit": 2}
    found = []
    while True:
        data = api.get(f"/api/webcams/{camera}/history", params=params).json()
        found += [point["id"] for point in data["intervals"]]
        if not data["next_cursor"]:
            break
        params["cursor"] = data["next_cursor"]
    assert len(found) == len(set(found)) == 5


def test_missing_predictions_not_estimated(api, database, visibility):
    visibility["properties"]["history"] = visibility["properties"]["history"].split("; calibrated_interval")[0]
    visibility["properties"]["content"]["value"] = "NaN"
    seed(database, visibility)
    data = api.get("/api/map", params={"parameter": "visibility", "at": "2026-11-17T11:00:00Z"}).json()
    camera = data["features"][0]["properties"]["cams"][0]
    assert camera["cls"] == "white"
    assert camera["value"] is None


def test_all_administration_requires_session_and_csrf(api, database, feature):
    seed(database, feature)
    identifier = api.get("/api/map", params={"at": "2026-11-17T11:00:00Z"}).json()["features"][0]["properties"]["cams"][0]["p"]
    path = f"/api/admin/blacklist/{identifier}"
    assert api.get("/api/admin/blacklist").status_code == 401
    assert api.put(path, json={}).status_code == 401
    assert api.delete(path).status_code == 401
    assert api.post("/api/admin/login", json={"username": "viewer", "password": "wrong"}).status_code == 401
    csrf = login(api)
    assert api.put(path, json={}).status_code == 403
    assert api.put(path, json={}, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    assert api.put(path, json={}, headers={"X-CSRF-Token": csrf, "Origin": "https://evil.example"}).status_code == 403
    assert api.put(path, json={"reason": "Test local blacklist"}, headers={"X-CSRF-Token": csrf}).status_code == 200
    assert api.get("/api/map").json()["counts"]["cameras"] == 0
    assert len(api.get(f"/api/webcams/{identifier}").json()["predictions"]) == 1
    assert api.delete(path, headers={"X-CSRF-Token": csrf}).status_code == 204
    assert api.get("/api/map").json()["counts"]["cameras"] == 1
    assert api.post("/api/admin/logout", headers={"X-CSRF-Token": csrf}).status_code == 204
    assert api.get("/api/admin/blacklist").status_code == 401


def test_administration_forbidden_over_plain_http(api):
    response = api.post("http://testserver/api/admin/login", json={"username": "admin", "password": "test-password-long-enough"})
    assert response.status_code == 400


def test_login_rate_limit(api):
    for _ in range(10):
        assert api.post("/api/admin/login", json={"username": "admin", "password": "wrong"}).status_code == 401
    assert api.post("/api/admin/login", json={"username": "admin", "password": "wrong"}).status_code == 429


def test_unicode_login_is_rejected_without_server_error(api):
    assert api.post("/api/admin/login", json={"username": "administratéur", "password": "wrong"}).status_code == 401


@pytest.mark.parametrize("url", ["/api/map?bbox=1,2,3", "/api/map?bbox=NaN,0,10,20",
    "/api/map?at=2026-11-17", "/api/map?parameter=scene_history",
    "/api/webcams/missing", "/api/webcams/missing/history"])
def test_invalid_queries_fail_explicitly(api, url):
    assert api.get(url).status_code in (404, 422)
