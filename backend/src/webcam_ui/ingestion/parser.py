"""Parse the implemented E-SOH v4.0 webcam publication contract, not N0V0 images."""

import json
import math
import re
from datetime import UTC, datetime
from urllib.parse import urlsplit

from webcam_ui.domain.observations import STANDARD_NAMES, Observation, StreamIdentity
from webcam_ui.domain.qualification import SNOW_QUALIFICATION_CODES


class ObservationError(ValueError):
    """A bounded reason code, deliberately containing no message or secret values."""


def timestamp(value: object, *, required: bool = False) -> datetime | None:
    if value is None or value == "":
        if required:
            raise ObservationError("missing_timestamp")
        return None
    if not isinstance(value, str):
        raise ObservationError("invalid_timestamp")
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ObservationError("invalid_timestamp") from None
    if result.tzinfo is None:
        raise ObservationError("timestamp_without_timezone")
    return result.astimezone(UTC)


def number(value: object, *, absent: bool = False) -> float | None:
    if absent and (value is None or value == "" or str(value).lower() == "nan"):
        return None
    if isinstance(value, bool):
        raise ObservationError("invalid_number")
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ObservationError("invalid_number") from None
    if not math.isfinite(result):
        raise ObservationError("non_finite_number")
    return 0.0 if result == 0 else result


def text(value: object, *, required: bool = False, limit: int = 2048) -> str | None:
    if value is None or value == "":
        if required:
            raise ObservationError("missing_identity")
        return None
    if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ObservationError("invalid_text")
    value = value.strip()
    if required and not value:
        raise ObservationError("missing_identity")
    return value or None


def history_fields(value: object) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, str) or len(value) > 16384:
        raise ObservationError("invalid_history")
    fields = {}
    for entry in value.split(";"):
        key, separator, content = entry.strip().partition("=")
        if separator:
            if key in fields and fields[key] != content.strip():
                raise ObservationError("conflicting_history_field")
            fields[key] = content.strip()
    return fields


def published_country(properties: dict, history: dict[str, str]) -> str | None:
    """Read the current history contract and legacy properties without guessing geography."""
    countries = set()
    for value in (history.get("country"), properties.get("country"), properties.get("country_code")):
        country = text(value, limit=32)
        if country is None:
            continue
        country = country.upper()
        if len(country) != 2 or not country.isascii() or not country.isalpha():
            raise ObservationError("invalid_country")
        countries.add(country)
    if len(countries) > 1:
        raise ObservationError("conflicting_country")
    return next(iter(countries), None)


def interval(value: str | None) -> tuple[float | None, float | None]:
    if value is None:
        return None, None
    match = re.fullmatch(r"\(\s*([^,()]+)\s*,\s*([^,()]+)\s*\)", value)
    if not match:
        raise ObservationError("invalid_interval")
    lower, upper = number(match[1]), number(match[2])
    if lower > upper:
        raise ObservationError("reversed_interval")
    return lower, upper


def safe_provider_url(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 4096 or any(c.isspace() for c in value):
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            return None
    except ValueError:
        return None
    return value


def payload_features(payload: bytes, maximum_bytes: int = 1048576) -> list[object]:
    if len(payload) > maximum_bytes:
        raise ObservationError("payload_too_large")
    try:
        value = json.loads(payload, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise ObservationError("invalid_json") from None
    if isinstance(value, dict) and value.get("type") == "FeatureCollection":
        value = value.get("features")
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list) and len(value) <= 10000:
        return value
    raise ObservationError("invalid_feature_collection")


def parse_feature(feature: object) -> Observation:
    if not isinstance(feature, dict) or feature.get("type") != "Feature":
        raise ObservationError("not_an_observation_feature")
    properties = feature.get("properties")
    geometry = feature.get("geometry")
    if not isinstance(properties, dict) or not isinstance(geometry, dict):
        raise ObservationError("missing_observation_fields")
    content = properties.get("content")
    if not isinstance(content, dict) or content.get("standard_name") not in STANDARD_NAMES:
        raise ObservationError("unsupported_parameter")
    if geometry.get("type") != "Point":
        raise ObservationError("unsupported_geometry")
    coordinates = geometry.get("coordinates")
    if isinstance(coordinates, dict):
        latitude, longitude = number(coordinates.get("lat")), number(coordinates.get("lon"))
    elif isinstance(coordinates, list) and len(coordinates) >= 2:
        longitude, latitude = number(coordinates[0]), number(coordinates[1])
    else:
        raise ObservationError("invalid_coordinates")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ObservationError("invalid_coordinates")
    history = history_fields(properties.get("history"))
    standard_name = content["standard_name"]
    parameter = STANDARD_NAMES[standard_name]
    instrument = text(properties.get("instrument"), required=True, limit=512)
    derived_suffix = text(history.get("derived_stream"), limit=128)
    processing_suffix = text(history.get("processing_stream"), limit=128)
    source_stream_id = None
    if derived_suffix is not None and processing_suffix is not None:
        suffix = f"_{parameter}_{derived_suffix}_{processing_suffix}"
        if instrument.endswith(suffix) and len(instrument) > len(suffix):
            source_stream_id = instrument[:-len(suffix)]
    identity = StreamIdentity(
        naming_authority=text(properties.get("naming_authority"), required=True, limit=256),
        platform=text(properties.get("platform"), required=True, limit=256),
        standard_name=standard_name,
        level=number(properties.get("level")),
        function=text(properties.get("function"), required=True, limit=64),
        period=text(properties.get("period"), required=True, limit=64),
        instrument=instrument, source_stream_id=source_stream_id,
        derived_suffix=derived_suffix, processing_suffix=processing_suffix,
    )
    raw_lower, raw_upper = interval(history.get("raw_interval"))
    calibrated_lower, calibrated_upper = interval(history.get("calibrated_interval"))
    scalar = number(content.get("value"), absent=True)
    snow_threshold_low = number(history.get("snow_threshold_low"), absent=True)
    snow_threshold_high = number(history.get("snow_threshold_high"), absent=True)
    if parameter != "snow" and (snow_threshold_low is not None or snow_threshold_high is not None):
        raise ObservationError("snow_threshold_on_visibility_observation")
    snow_class = None
    snow_qualification = None
    if "snow_qualification" in history:
        if parameter != "snow":
            raise ObservationError("snow_qualification_on_visibility_observation")
        token = text(history["snow_qualification"], limit=32)
        if token is not None:
            snow_qualification = SNOW_QUALIFICATION_CODES.get(token.lower())
            if snow_qualification is None:
                raise ObservationError("invalid_snow_qualification")
    if "snow_class" in history:
        candidate = number(history["snow_class"])
        if not candidate.is_integer() or not -(2**31) <= candidate < 2**31:
            raise ObservationError("invalid_snow_class")
        snow_class = int(candidate)
    if parameter == "snow" and calibrated_lower is not None:
        raise ObservationError("calibration_on_snow_observation")
    if parameter == "snow" and scalar is not None:
        raise ObservationError("unexpected_snow_scalar")
    if parameter == "visibility" and snow_class is not None:
        raise ObservationError("snow_class_on_visibility_observation")
    if parameter == "visibility" and any(v is not None and v < 0 for v in (scalar, calibrated_lower, calibrated_upper)):
        raise ObservationError("negative_visibility")
    if raw_lower is None and snow_class is None and scalar is None and calibrated_lower is None:
        raise ObservationError("no_published_prediction")
    country = published_country(properties, history)
    links = feature.get("links", [])
    if not isinstance(links, list):
        raise ObservationError("invalid_links")
    provider_url = next((url for link in links if isinstance(link, dict)
                         and link.get("rel") == "about"
                         and (url := safe_provider_url(link.get("href")))), None)
    provider_kind = None
    provider_webcam_id = None
    if source_stream_id and (match := re.fullmatch(r"win([0-9]+)", source_stream_id)):
        provider_kind, provider_webcam_id = "windy", match[1]
    elif source_stream_id and source_stream_id.startswith("ska"):
        provider_kind = "skaping"
    elif source_stream_id and source_stream_id.startswith("fin"):
        provider_kind = "fintraffic"
    keywords = properties.get("keywords") or ""
    if not isinstance(keywords, str) or len(keywords) > 4096:
        raise ObservationError("invalid_keywords")
    quality_code = properties.get("quality_code")
    if quality_code is not None and (isinstance(quality_code, bool) or not isinstance(quality_code, int)
                                     or not -(2**31) <= quality_code < 2**31):
        raise ObservationError("invalid_quality_code")
    return Observation(
        identity=identity, parameter=parameter,
        download_timestamp=timestamp(properties.get("datetime"), required=True),
        latitude=latitude, longitude=longitude,
        altitude=number(properties.get("hamsl"), absent=True), country=country,
        name=text(properties.get("title")) or source_stream_id or instrument,
        platform_name=text(properties.get("platform_name")), unit=text(content.get("unit")) or "",
        provider_url=provider_url, provider_kind=provider_kind, provider_webcam_id=provider_webcam_id,
        tags=tuple(part.strip() for part in keywords.split(",") if part.strip()),
        raw_lower=raw_lower, raw_upper=raw_upper, snow_class=snow_class,
        snow_qualification=snow_qualification,
        snow_threshold_low=snow_threshold_low, snow_threshold_high=snow_threshold_high,
        visibility_qualification=2 if parameter == "visibility" else None,
        visibility_lower=calibrated_lower, visibility_upper=calibrated_upper,
        visibility_center=scalar if parameter == "visibility" else None,
        acquisition_timestamp=timestamp(history.get("acquisition_timestamp")),
        processing_timestamp=timestamp(history.get("processing_timestamp")),
        provider_timestamp=timestamp(history.get("provider_timestamp")),
        publication_timestamp=timestamp(history.get("publication_timestamp")),
        model_version=text(history.get("model") or properties.get("source")),
        postprocessing_version=text(history.get("postprocessing")),
        image_access=text(history.get("image_access")),
        processing_level=text(properties.get("processing_level")), quality_code=quality_code,
        publication_id=text(properties.get("data_id") or feature.get("id"), limit=512),
        esoh_pubtime=timestamp(properties.get("pubtime")),
    )
