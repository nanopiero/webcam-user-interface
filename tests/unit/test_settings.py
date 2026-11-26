from pathlib import Path

import pytest
from pydantic import ValidationError
from webcam_ui.cli import initialize
from webcam_ui.settings import (
    BackendSettings,
    BoundingBox,
    FilterSettings,
    FreshnessSettings,
    MQTTSettings,
    ROISettings,
    load_settings,
)


def test_examples_are_valid():
    settings = load_settings(Path(__file__).parents[2] / "config/backend.example.toml")
    assert settings.database.host_data_directory == Path("/data/db_ui")
    assert settings.filters.allowed_countries == ["FR", "ES", "IT", "DE", "CH", "LU", "BE"]
    assert settings.mqtt.qos == 1
    assert settings.filters.bounding_box.enabled
    assert settings.roi.name == "France"
    assert settings.roi.countries == ["FR"]
    assert settings.api.snow_freshness.model_dump() == {"fresh_minutes": 30, "max_age_minutes": 180}
    assert settings.api.visibility_freshness.model_dump() == {"fresh_minutes": 15, "max_age_minutes": 30}
    assert settings.api.snow_freshness == BackendSettings().api.snow_freshness
    assert "NL" not in settings.filters.allowed_countries


def test_europe_preset_loads_its_entire_domain_without_separate_neighbours():
    import json

    directory = Path(__file__).parents[2] / "config/presets/europe"
    settings = load_settings(directory / "backend.example.toml")
    frontend = json.loads((directory / "frontend.example.json").read_text())
    assert settings.roi.name == "Europe"
    assert settings.roi.countries == settings.filters.allowed_countries
    assert {"FR", "GB", "FI", "IS", "PT", "CY", "NL", "DE"} <= set(settings.roi.countries)
    box = settings.filters.bounding_box
    assert box.enabled
    for lon, lat in [(-31.2, 39.5), (-21.9, 64.1), (24.9, 70.0), (33.4, 35.2)]:
        assert box.west < lon < box.east and box.south < lat < box.north
    assert frontend["language"] == "roi"
    assert frontend["map"]["zoom"] < 4
    assert frontend["map"]["borders"] == {
        "national": True, "regions": False, "departments": False}


def test_country_configuration_is_portable_normalized_and_deduplicated():
    settings = FilterSettings(allowed_countries=[" gb ", "FI", "gb"])
    assert settings.allowed_countries == ["GB", "FI"]
    assert settings.bounding_box.enabled
    with pytest.raises(ValidationError):
        FilterSettings(allowed_countries=["Finland"])


@pytest.mark.parametrize("fresh,maximum", [(0, 30), (15, 0), (15, 15), (30, 15)])
def test_freshness_thresholds_must_be_positive_and_increasing(fresh, maximum):
    with pytest.raises(ValidationError):
        FreshnessSettings(fresh_minutes=fresh, max_age_minutes=maximum)


def test_roi_is_configurable_and_its_countries_must_be_allowed():
    settings = BackendSettings(roi=ROISettings(name=" Germany ", countries=[" de "]),
                               filters=FilterSettings(allowed_countries=["DE", "FR"]))
    assert settings.roi.name == "Germany"
    assert settings.roi.countries == ["DE"]
    with pytest.raises(ValidationError):
        BackendSettings(roi=ROISettings(name="Finland", countries=["FI"]))
    with pytest.raises(ValidationError):
        ROISettings(name=" ")


def test_unknown_settings_and_invalid_bounds_fail():
    with pytest.raises(ValidationError):
        BackendSettings.model_validate({"invented_setting": True})
    with pytest.raises(ValidationError):
        BoundingBox(west=10, east=-10)
    with pytest.raises(ValidationError):
        MQTTSettings(qos=0)


def test_init_is_idempotent_preserves_existing_broker_key_and_generates_strong_credentials(tmp_path):
    import shutil
    root = Path(__file__).parents[2]
    (tmp_path / "config").mkdir()
    for name in ("backend.example.toml", "frontend.example.json"):
        shutil.copyfile(root / "config" / name, tmp_path / "config" / name)
    secrets = tmp_path / ".secrets"
    secrets.mkdir()
    (secrets / "mosquitto_sub").write_text("-u example -P example-password")
    initialize(tmp_path)
    before = {p.name: p.read_text() for p in secrets.iterdir()}
    config = (tmp_path / "config/backend.local.toml").read_text()
    initialize(tmp_path, preset="europe")
    initialize(tmp_path)
    assert {p.name: p.read_text() for p in secrets.iterdir()} == before
    assert (tmp_path / "config/backend.local.toml").read_text() == config
    assert len(before["admin_initial_password"].strip()) >= 24
    assert before["admin_initial_password"].strip() != "1234"
    assert (secrets.stat().st_mode & 0o777) == 0o700
    assert all((p.stat().st_mode & 0o777) == 0o600 for p in secrets.iterdir())


def test_init_can_select_europe_without_overwriting_settings_or_credentials(tmp_path):
    import json
    import shutil

    root = Path(__file__).parents[2]
    shutil.copytree(root / "config/presets/europe", tmp_path / "config/presets/europe")
    initialize(tmp_path, preset="europe")
    backend = tmp_path / "config/backend.local.toml"
    frontend = tmp_path / "config/frontend.local.json"
    assert load_settings(backend).roi.name == "Europe"
    assert json.loads(frontend.read_text())["map"]["center"] == [12, 55]
    paths = [backend, frontend, *(tmp_path / ".secrets").iterdir()]
    before = {path: path.read_bytes() for path in paths}
    initialize(tmp_path)
    assert {path: path.read_bytes() for path in before} == before
