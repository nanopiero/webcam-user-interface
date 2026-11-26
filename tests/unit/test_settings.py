from pathlib import Path

import pytest
from pydantic import ValidationError
from webcam_ui.cli import initialize
from webcam_ui.settings import (
    BackendSettings,
    BoundingBox,
    FilterSettings,
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
    assert settings.api.prediction_max_age_minutes == BackendSettings().api.prediction_max_age_minutes == 15
    assert "NL" not in settings.filters.allowed_countries


def test_country_configuration_is_portable_normalized_and_deduplicated():
    settings = FilterSettings(allowed_countries=[" gb ", "FI", "gb"])
    assert settings.allowed_countries == ["GB", "FI"]
    assert settings.bounding_box.enabled
    with pytest.raises(ValidationError):
        FilterSettings(allowed_countries=["Finland"])


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
    initialize(tmp_path)
    assert {p.name: p.read_text() for p in secrets.iterdir()} == before
    assert (tmp_path / "config/backend.local.toml").read_text() == config
    assert len(before["admin_initial_password"].strip()) >= 24
    assert before["admin_initial_password"].strip() != "1234"
    assert (secrets.stat().st_mode & 0o777) == 0o700
    assert all((p.stat().st_mode & 0o777) == 0o600 for p in secrets.iterdir())
