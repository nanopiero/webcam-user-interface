import json
from datetime import UTC, datetime

import pytest
from webcam_ui.domain.classification import classify, visibility_class
from webcam_ui.ingestion.filtering import rejection_reason
from webcam_ui.ingestion.parser import ObservationError, parse_feature, payload_features
from webcam_ui.settings import BoundingBox, FilterSettings


def test_snow_preserves_raw_interval_and_class(feature):
    observation = parse_feature(feature)
    assert (observation.raw_lower, observation.raw_upper) == (-4.2, -3.1)
    assert observation.snow_class == 1
    assert observation.visibility_center is None
    assert observation.identity.source_stream_id == "win1234567"
    assert observation.provider_webcam_id == "1234567"
    assert observation.provider_url is None
    assert observation.snow_qualification == 2
    assert observation.visibility_qualification is None


def test_visibility_keeps_published_centre_not_bounds_midpoint(visibility):
    observation = parse_feature(visibility)
    assert observation.visibility_center == 5800
    assert (observation.visibility_lower, observation.visibility_upper) == (5000, 7000)
    assert observation.visibility_center != (observation.visibility_lower + observation.visibility_upper) / 2
    assert observation.visibility_qualification == 2
    assert observation.snow_qualification is None


@pytest.mark.parametrize("token,code", [("disqualified", 0), ("incomplete", 1), ("qualified", 2)])
def test_snow_qualification_uses_the_published_ml_status_codes(feature, token, code):
    feature["properties"]["history"] = feature["properties"]["history"].replace("snow_qualification=qualified", f"snow_qualification={token}")
    assert parse_feature(feature).snow_qualification == code


def test_missing_qualification_is_not_inferred_from_a_snow_class_or_quality_code(feature):
    feature["properties"]["history"] = feature["properties"]["history"].replace("; snow_qualification=qualified", "")
    assert parse_feature(feature).snow_qualification is None
    feature["properties"]["history"] += "; snow_qualification=unexpected"
    with pytest.raises(ObservationError, match="invalid_snow_qualification"):
        parse_feature(feature)


@pytest.mark.parametrize("fixture", ["feature", "visibility"])
def test_optional_qualification_metadata_preserves_legacy_fingerprints(request, fixture):
    import hashlib
    from dataclasses import asdict

    feature = request.getfixturevalue(fixture)
    feature["properties"]["history"] = feature["properties"]["history"].replace("; snow_qualification=qualified", "")
    observation = parse_feature(feature)
    legacy = asdict(observation)
    for key in ("publication_id", "esoh_pubtime", "snow_qualification", "visibility_qualification", "snow_threshold_low", "snow_threshold_high"):
        legacy.pop(key)
    expected = hashlib.sha256(json.dumps(legacy, default=str, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert observation.fingerprint == expected


def test_same_image_different_parameter_has_distinct_series_shared_camera(feature, visibility):
    snow, vis = parse_feature(feature), parse_feature(visibility)
    assert snow.identity.processing_stream_id == vis.identity.processing_stream_id
    assert snow.identity.observation_stream_id != vis.identity.observation_stream_id
    assert snow.fingerprint != vis.fingerprint


def test_raw_only_remains_a_prediction_but_not_a_derived_class(visibility):
    visibility["properties"]["history"] = visibility["properties"]["history"].split("; calibrated_interval")[0]
    visibility["properties"]["content"]["value"] = "NaN"
    result = parse_feature(visibility)
    assert result.raw_lower == -2.3
    assert result.visibility_center is None
    assert result.visibility_lower is None
    assert classify("visibility", {"visibility_lower": None})[0] == "white"


def test_republication_transport_id_does_not_duplicate(feature):
    first = parse_feature(feature)
    feature["properties"]["data_id"] = "different-publication"
    feature["properties"]["pubtime"] = "2026-11-17T10:10:00Z"
    assert parse_feature(feature).fingerprint == first.fingerprint


def test_changed_prediction_is_a_distinct_observation(feature):
    first = parse_feature(feature)
    feature["properties"]["history"] = feature["properties"]["history"].replace("snow_class=1", "snow_class=10")
    assert parse_feature(feature).fingerprint != first.fingerprint


def test_standard_geojson_coordinate_array_supported(feature):
    first = parse_feature(feature)
    feature["geometry"]["coordinates"] = [2.398, 47.084]
    assert parse_feature(feature).fingerprint == first.fingerprint


@pytest.mark.parametrize("country,expected", [(None, None), ("FR", None), ("fr", None), ("FI", "country")])
def test_country_filter_only_if_supplied(feature, country, expected):
    if country is not None:
        feature["properties"]["country"] = country
    observation = parse_feature(feature)
    assert rejection_reason(observation, FilterSettings()) == expected
    assert observation.country == (country.upper() if country else None)


def test_country_never_inferred_from_platform_or_coordinates(feature):
    feature["properties"]["platform"] = "0-20000-0-FI1234"
    assert parse_feature(feature).country is None
    assert rejection_reason(parse_feature(feature), FilterSettings()) is None


def test_bbox_applies_even_without_country(feature):
    feature["geometry"]["coordinates"] = {"lat": 60.2, "lon": 24.5}
    observation = parse_feature(feature)
    assert rejection_reason(observation, FilterSettings(bounding_box=BoundingBox(enabled=True))) == "bounding_box"
    assert rejection_reason(observation, FilterSettings(bounding_box=BoundingBox(enabled=False))) is None


@pytest.mark.parametrize("fixture", ["feature", "visibility"])
def test_country_is_read_from_history_for_both_parameters(request, fixture):
    feature = request.getfixturevalue(fixture)
    feature["properties"]["history"] += "; country= fi "
    observation = parse_feature(feature)
    assert observation.country == "FI"
    assert rejection_reason(observation, FilterSettings(allowed_countries=["FI"])) is None
    assert rejection_reason(observation, FilterSettings(allowed_countries=["FR"])) == "country"


def test_country_sources_agree_after_normalization_and_empty_legacy_field_does_not_mask_history(feature):
    feature["properties"].update(country="", country_code="fr")
    feature["properties"]["history"] += "; country=FR"
    assert parse_feature(feature).country == "FR"
    feature["properties"]["country"] = "DE"
    with pytest.raises(ObservationError, match="conflicting_country"):
        parse_feature(feature)


@pytest.mark.parametrize("country", ["France", "F1", "F", "ＦＲ"])
def test_invalid_history_country_is_rejected(feature, country):
    feature["properties"]["history"] += f"; country={country}"
    with pytest.raises(ObservationError, match="invalid_country"):
        parse_feature(feature)


@pytest.mark.parametrize("history", ["raw_interval=(NaN, 1)", "raw_interval=(2, 1)",
                                      "raw_interval=(1, 2, 3)", "raw_interval=(1, inf)"])
def test_bad_interval_is_rejected(feature, history):
    feature["properties"]["history"] = history
    with pytest.raises(ObservationError):
        parse_feature(feature)


def test_naive_timestamp_is_rejected(feature):
    feature["properties"]["datetime"] = "2026-11-17T10:00:00"
    with pytest.raises(ObservationError, match="timezone"):
        parse_feature(feature)


def test_offset_timestamp_is_normalized(feature):
    feature["properties"]["datetime"] = "2026-11-17T11:00:00+01:00"
    assert parse_feature(feature).download_timestamp == datetime(2026, 11, 17, 10, tzinfo=UTC)


def test_n0v0_is_not_an_observation():
    with pytest.raises(ObservationError):
        parse_feature({"schema_version": "N0V0", "storage": {"bucket": "example"}})


def test_payload_limits_and_json_nonfinite(feature):
    with pytest.raises(ObservationError, match="too_large"):
        payload_features(b"x" * 11, 10)
    with pytest.raises(ObservationError, match="invalid_json"):
        payload_features(b'{"x":NaN}')
    assert payload_features(json.dumps(feature).encode()) == [feature]
    assert payload_features(json.dumps([feature]).encode()) == [feature]
    assert payload_features(json.dumps({"type": "FeatureCollection", "features": [feature]}).encode()) == [feature]


@pytest.mark.parametrize("snow_class,icon,uncertain", [(0, "snow.none", False),
    (1, "snow.undifferentiated", False), (10, "snow.intermediate", False),
    (30, "snow.none", True), (31, "snow.undifferentiated", True), (310, "snow.intermediate", True)])
def test_legacy_snow_classes(snow_class, icon, uncertain):
    assert classify("snow", {"snow_class": snow_class}) == (icon, uncertain, None)


@pytest.mark.parametrize("code,icon,uncertain", [(0, "snow.none", False), (30, "snow.none", True),
    (10, "snow.intermediate", False), (310, "snow.intermediate", True),
    (1, "snow.high", False), (31, "snow.high", True)])
def test_two_thresholds_distinguish_high_snow_without_reclassifying_no_snow_or_intermediate(code, icon, uncertain):
    assert classify("snow", {"snow_class": code, "snow_threshold_low": -2.5,
                             "snow_threshold_high": 0.0}) == (icon, uncertain, None)


@pytest.mark.parametrize("low,high", [(None, None), (-2.5, None), (None, 0.0)])
def test_missing_either_threshold_keeps_snow_undifferentiated(low, high):
    assert classify("snow", {"snow_class": 1, "snow_threshold_low": low,
                             "snow_threshold_high": high}) == ("snow.undifferentiated", False, None)


def test_threshold_metadata_is_parsed_and_changes_the_observation_fingerprint(feature, visibility):
    previous = parse_feature(feature)
    feature["properties"]["history"] += "; snow_threshold_low=-2.5; snow_threshold_high=0"
    observation = parse_feature(feature)
    assert (observation.snow_threshold_low, observation.snow_threshold_high) == (-2.5, 0.0)
    assert observation.fingerprint != previous.fingerprint
    visibility["properties"]["history"] += "; snow_threshold_high=0"
    with pytest.raises(ObservationError, match="snow_threshold_on_visibility_observation"):
        parse_feature(visibility)


@pytest.mark.parametrize("value", ["Infinity", "-Infinity", "invalid"])
def test_thresholds_must_be_finite_numbers(feature, value):
    feature["properties"]["history"] += f"; snow_threshold_high={value}"
    with pytest.raises(ObservationError):
        parse_feature(feature)


def test_legacy_visibility_band_uses_calibrated_bounds():
    assert visibility_class(5000, 7000) == "visibility.5000_8000"
    assert visibility_class(20000, 20000) == "visibility.10000_20000"
    assert visibility_class(None, None) is None
