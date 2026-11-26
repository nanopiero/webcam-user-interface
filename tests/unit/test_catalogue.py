import csv
import json
from math import degrees

import pytest
from webcam_ui.domain.geography import EARTH_RADIUS_METRES, RadiusIndex
from webcam_ui.providers.catalogue import CatalogueUnavailable, SupplementaryCatalogue
from webcam_ui.settings import SupplementaryWebcamSettings


def write_catalogue(path, rows):
    fields = ["id", "name", "lat", "lon", "altitude", "links_json", "metadata_json", "provider_url"]
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def test_geographic_radius_is_strict_at_250m_and_handles_dateline_and_poles():
    index = RadiusIndex([(0, 0)], 250)
    assert index.contains_nearby(0, 0)
    assert index.contains_nearby(degrees(249.99 / EARTH_RADIUS_METRES), 0)
    assert index.contains_nearby(degrees(250 / EARTH_RADIUS_METRES), 0)
    assert not index.contains_nearby(degrees(250.01 / EARTH_RADIUS_METRES), 0)
    assert RadiusIndex([(0, 179.999)], 250).contains_nearby(0, -179.999)
    assert RadiusIndex([(89.9999, 0)], 250).contains_nearby(89.9999, 180)
    assert not RadiusIndex([], 250).contains_nearby(0, 0)


def test_catalogue_preserves_metadata_and_missing_altitude_without_inventing_predictions(tmp_path):
    path = tmp_path / "webcams.csv"
    write_catalogue(path, [{"id": "external-example", "name": "Webcam, north", "lat": 47.1, "lon": 2.5,
                            "provider_url": "https://www.skaping.com/example",
                            "altitude": "", "metadata_json": json.dumps({"description": "line one\nline two", "custom": "kept"}),
                            "links_json": json.dumps(["https://example.org/camera", "javascript:alert(1)"])}])
    service = SupplementaryCatalogue(SupplementaryWebcamSettings(enabled=True, csv_file=path))
    data = service.collection([])
    assert data["features"][0]["geometry"]["coordinates"] == [2.5, 47.1]
    assert data["features"][0]["properties"]["altitude"] is None
    assert data["features"][0]["properties"]["provider_host"] == "www.skaping.com"
    detail = service.detail("external-example")
    assert detail["metadata"]["custom"] == "kept"
    assert detail["links"] == ["https://www.skaping.com/example", "https://example.org/camera"]
    assert "predictions" not in detail
    assert "snow_class" not in detail


def test_csv_reloads_after_atomic_replacement_and_rechecks_new_database_webcams(tmp_path):
    path = tmp_path / "webcams.csv"
    write_catalogue(path, [{"id": "one", "name": "First", "lat": 47, "lon": 2}])
    service = SupplementaryCatalogue(SupplementaryWebcamSettings(enabled=True, csv_file=path))
    assert service.collection([])["counts"]["visible"] == 1
    assert service.collection([(47, 2)])["counts"] == {"csv_webcams": 1, "visible": 0, "now_near_database": 1}
    replacement = tmp_path / "next.csv"
    write_catalogue(replacement, [{"id": "two", "name": "Second", "lat": 48, "lon": 3}])
    replacement.replace(path)
    assert service.collection([])["features"][0]["properties"]["id"] == "two"


def test_bad_csv_fails_without_exposing_its_filesystem_path(tmp_path):
    path = tmp_path / "private-path.csv"
    service = SupplementaryCatalogue(SupplementaryWebcamSettings(enabled=True, csv_file=path))
    with pytest.raises(CatalogueUnavailable) as error:
        service.items()
    assert "private-path" not in str(error.value)
    write_catalogue(path, [{"id": "invalid", "name": "Invalid", "lat": "NaN", "lon": 2}])
    with pytest.raises(CatalogueUnavailable):
        service.items()
    disabled = SupplementaryCatalogue(SupplementaryWebcamSettings(enabled=False, csv_file=path))
    assert disabled.collection([])["features"] == []
