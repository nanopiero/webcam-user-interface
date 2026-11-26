"""Validated backend settings. Secrets are read from files, never configuration strings."""

import tomllib
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SettingsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DatabaseSettings(SettingsModel):
    host: str = "postgres"
    port: int = Field(default=5432, ge=1, le=65535)
    name: str = "webcam_ui"
    user: str = "webcam_ui"
    password_file: Path = Path("/run/secrets/db_password")
    host_data_directory: Path = Path("/data/db_ui")
    pool_size: int = Field(default=5, ge=1, le=30)
    connect_timeout_seconds: int = Field(default=5, ge=1, le=60)
    statement_timeout_seconds: int = Field(default=15, ge=1, le=120)


class BoundingBox(SettingsModel):
    enabled: bool = True
    west: float = Field(default=-6, ge=-180, le=180)
    south: float = Field(default=41, ge=-90, le=90)
    east: float = Field(default=10, ge=-180, le=180)
    north: float = Field(default=52, ge=-90, le=90)

    @model_validator(mode="after")
    def ordered(self):
        if self.west >= self.east or self.south >= self.north:
            raise ValueError("bounding box bounds must be ordered west/south/east/north")
        return self


class FilterSettings(SettingsModel):
    allowed_countries: list[str] = Field(default_factory=lambda: ["FR", "ES", "IT", "DE", "CH", "LU", "BE"])
    bounding_box: BoundingBox = Field(default_factory=BoundingBox)

    @model_validator(mode="after")
    def country_codes(self):
        self.allowed_countries = list(dict.fromkeys(code.upper().strip() for code in self.allowed_countries))
        if any(len(code) != 2 or not code.isascii() or not code.isalpha() for code in self.allowed_countries):
            raise ValueError("allowed_countries must contain ISO alpha-2 country codes")
        return self


class ROISettings(SettingsModel):
    name: str = Field(default="France", min_length=1, max_length=128)
    countries: list[str] = Field(default_factory=lambda: ["FR"], min_length=1)

    @model_validator(mode="after")
    def normalized(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("ROI name must not be blank")
        self.countries = FilterSettings(allowed_countries=self.countries).allowed_countries
        return self


class MQTTSettings(SettingsModel):
    host: str = "mqtt.example.invalid"
    port: int = Field(default=8883, ge=1, le=65535)
    topics: list[str] = Field(default_factory=lambda: ["eu.eumetnet/+/+"])
    client_id: str = "webcam-ui-observations"
    qos: Literal[1] = 1
    ca_file: Path = Path("/run/secrets/esoh-ca.crt")
    credentials_file: Path = Path("/run/secrets/mqtt_credentials")
    keepalive_seconds: int = Field(default=60, ge=15, le=300)
    maximum_payload_bytes: int = Field(default=1048576, ge=1024, le=16777216)
    reconnect_min_seconds: int = Field(default=2, ge=1)
    reconnect_max_seconds: int = Field(default=60, ge=2)
    metrics_port: int = Field(default=9090, ge=1024, le=65535)

    @model_validator(mode="after")
    def subscription(self):
        if not self.client_id.strip() or not self.topics or any(not topic.strip() for topic in self.topics):
            raise ValueError("a stable client_id and at least one nonempty MQTT topic are required")
        if self.reconnect_max_seconds < self.reconnect_min_seconds:
            raise ValueError("reconnect_max_seconds must be >= reconnect_min_seconds")
        return self


class AuthSettings(SettingsModel):
    username: str = "admin"
    password_hash_file: Path = Path("/run/secrets/admin_password_hash")
    session_secret_file: Path = Path("/run/secrets/session_secret")
    session_seconds: int = Field(default=28800, ge=60, le=86400)
    allow_development_credentials: bool = False
    login_attempts_per_minute: int = Field(default=10, ge=1, le=100)


class ProviderSettings(SettingsModel):
    windy_api_key_file: Path = Path("/run/secrets/windy_api_key")
    current_images_enabled: bool = True
    cache_seconds: int = Field(default=240, ge=0, le=300)
    maximum_cached_cameras: int = Field(default=1024, ge=1, le=10000)
    request_timeout_seconds: float = Field(default=10, gt=0, le=30)


class APISettings(SettingsModel):
    host: str = "0.0.0.0"
    port: int = Field(default=8080, ge=1024, le=65535)
    frontend_config_file: Path = Path("/app/config/frontend.json")
    frontend_dist_directory: Path = Path("/app/frontend/dist")
    maximum_map_cameras: int = Field(default=50000, ge=1, le=100000)
    maximum_history_points: int = Field(default=10000, ge=10, le=100000)
    maximum_history_days: int = Field(default=366, ge=1, le=366)
    prediction_max_age_minutes: int = Field(default=15, ge=1)


class SupplementaryWebcamSettings(SettingsModel):
    enabled: bool = False
    csv_file: Path = Path("/app/catalogue/umap-webcams.csv")
    host_directory: Path = Path("../var/catalogue")
    minimum_distance_metres: float = Field(default=250, gt=0, le=100000, allow_inf_nan=False)
    maximum_rows: int = Field(default=50000, ge=1, le=100000)


class BackendSettings(SettingsModel):
    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    roi: ROISettings = Field(default_factory=ROISettings)
    filters: FilterSettings = Field(default_factory=FilterSettings)
    mqtt: MQTTSettings = Field(default_factory=MQTTSettings)
    auth: AuthSettings = Field(default_factory=AuthSettings)
    providers: ProviderSettings = Field(default_factory=ProviderSettings)
    api: APISettings = Field(default_factory=APISettings)
    supplementary_webcams: SupplementaryWebcamSettings = Field(default_factory=SupplementaryWebcamSettings)

    @model_validator(mode="after")
    def roi_countries_are_allowed(self):
        if not set(self.roi.countries) <= set(self.filters.allowed_countries):
            raise ValueError("roi.countries must be included in filters.allowed_countries")
        return self


def load_settings(path: Path | str) -> BackendSettings:
    """Load TOML without executing it. Resolve relative secret paths against the config file."""
    path = Path(path).resolve()
    with path.open("rb") as stream:
        settings = BackendSettings.model_validate(tomllib.load(stream))
    for block in (settings.database, settings.mqtt, settings.auth, settings.providers, settings.api,
                  settings.supplementary_webcams):
        for name in type(block).model_fields:
            value = getattr(block, name)
            if isinstance(value, Path) and not value.is_absolute():
                setattr(block, name, (path.parent / value).resolve())
    return settings


def read_secret(path: Path) -> str:
    """Keep secret values out of configuration errors and tracebacks."""
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        raise ValueError(f"cannot read required secret file: {path.name}") from None
    if not value:
        raise ValueError(f"required secret file is empty: {path.name}")
    return value
