"""Read the operator's supplementary CSV without creating prediction/database records."""

import csv
import json
import math
from threading import Lock

from webcam_ui.domain.geography import RadiusIndex
from webcam_ui.ingestion.parser import safe_provider_url
from webcam_ui.providers.media import published_media
from webcam_ui.settings import SupplementaryWebcamSettings


class CatalogueUnavailable(Exception):
    pass


def numeric(value, *, optional=False):
    if optional and (value is None or value == ""):
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("non-finite catalogue coordinate or altitude")
    return result


class SupplementaryCatalogue:
    def __init__(self, settings: SupplementaryWebcamSettings):
        self.settings = settings
        self._lock = Lock()
        self._signature = None
        self._items = ()

    def items(self):
        if not self.settings.enabled:
            return ()
        try:
            with self._lock:
                stat = self.settings.csv_file.stat()
                signature = (stat.st_ino, stat.st_mtime_ns, stat.st_size)
                if signature == self._signature:
                    return self._items
                if stat.st_size > 32 * 1024 * 1024:
                    raise ValueError("catalogue too large")
                items, seen = [], set()
                with self.settings.csv_file.open(encoding="utf-8-sig", newline="") as stream:
                    reader = csv.DictReader(stream)
                    if not {"id", "name", "lat", "lon"}.issubset(reader.fieldnames or ()):
                        raise ValueError("missing catalogue columns")
                    for position, row in enumerate(reader):
                        if position >= self.settings.maximum_rows:
                            raise ValueError("catalogue exceeds configured row limit")
                        latitude, longitude = numeric(row["lat"]), numeric(row["lon"])
                        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                            raise ValueError("invalid catalogue coordinates")
                        identifier = row["id"]
                        if not identifier or len(identifier) > 128 or identifier in seen:
                            raise ValueError("invalid or repeated catalogue identifier")
                        seen.add(identifier)
                        metadata = json.loads(row.get("metadata_json") or "{}")
                        if not isinstance(metadata, dict):
                            raise ValueError("catalogue metadata must be an object")
                        urls = json.loads(row.get("links_json") or "[]")
                        if not isinstance(urls, list):
                            raise ValueError("catalogue links must be a list")
                        links = list(dict.fromkeys(url for value in urls if isinstance(value, str)
                                                   and (url := safe_provider_url(value))))
                        provider = safe_provider_url(row.get("provider_url"))
                        if provider and provider not in links:
                            links.insert(0, provider)
                        media = published_media(row.get("description", ""), links)
                        if row.get("media_json"):
                            declared = json.loads(row["media_json"])
                            if not isinstance(declared, list):
                                raise ValueError("catalogue media must be a list")
                            media = [{"kind": item["kind"], "url": url} for item in declared
                                     if isinstance(item, dict) and item.get("kind") in {"image", "video", "frame"}
                                     and (url := safe_provider_url(item.get("url")))]
                        items.append({"id": identifier, "name": row["name"], "latitude": latitude,
                                      "longitude": longitude, "altitude": numeric(row.get("altitude"), optional=True),
                                      "altitude_source": row.get("altitude_source") or None,
                                      "altitude_band": row.get("altitude_band") or None,
                                      "provider_url": provider, "links": links, "media": media,
                                      "description": row.get("description", ""),
                                      "source_map_url": safe_provider_url(row.get("source_map_url")),
                                      "source_map_name": row.get("source_map_name", "uMap"),
                                      "source_layer_name": row.get("source_layer_name", ""),
                                      "source_feature_id": row.get("source_feature_id", ""),
                                      "exported_at": row.get("exported_at") or None, "metadata": metadata})
                self._items, self._signature = tuple(items), signature
                return self._items
        except (OSError, ValueError, TypeError, csv.Error) as error:
            raise CatalogueUnavailable() from error

    def collection(self, coordinates, bbox=None):
        items = self.items()
        index = RadiusIndex(coordinates, self.settings.minimum_distance_metres) if items else None
        features, suppressed = [], 0
        for item in items:
            lat, lon = item["latitude"], item["longitude"]
            if index.contains_nearby(lat, lon):
                suppressed += 1
                continue
            if bbox and not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
                continue
            features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                             "properties": {key: item[key] for key in ("id", "name", "altitude", "source_layer_name")}})
        return {"type": "FeatureCollection", "enabled": self.settings.enabled,
                "minimum_distance_metres": self.settings.minimum_distance_metres,
                "counts": {"csv_webcams": len(items), "visible": len(features), "now_near_database": suppressed},
                "features": features}

    def detail(self, identifier):
        return next((item for item in self.items() if item["id"] == identifier), None)
