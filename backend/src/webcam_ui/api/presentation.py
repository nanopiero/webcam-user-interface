"""Map and diagram contracts adapted from the reference admin UI, without invented ML state."""

import base64
import json
from collections import Counter
from datetime import datetime, timedelta

from webcam_ui.domain.classification import classify, visibility_class
from webcam_ui.domain.observations import stable_id
from webcam_ui.domain.qualification import snow_qualification_passed
from webcam_ui.ingestion.parser import timestamp
from webcam_ui.settings import FreshnessSettings


def build_map(rows: list[dict], parameter: str, at: datetime, freshness: FreshnessSettings,
              qualified_only: bool = True) -> dict:
    sites = {}
    fresh_cutoff = at - timedelta(minutes=freshness.fresh_minutes)
    expired_cutoff = at - timedelta(minutes=freshness.max_age_minutes)
    for row in rows:
        key = stable_id(row["naming_authority"], row["platform"])
        site = sites.setdefault(key, {"id": key, "platform": row["platform"],
                                     "name": row.get("platform_name"), "cams": []})
        downloaded = row.get("download_timestamp")
        age_band = ("missing" if downloaded is None else "expired" if downloaded <= expired_cutoff
                    else "ageing" if downloaded <= fresh_cutoff else "fresh")
        usable = age_band in ("fresh", "ageing")
        icon, uncertain, reason = classify(parameter, row if usable else None)
        qualification = row.get("snow_qualification") if parameter == "snow" else 2
        if parameter == "snow" and qualified_only and usable and not snow_qualification_passed(qualification):
            icon, uncertain = "white", False
            reason = "scene_unqualified" if qualification is not None else "qualification_unknown"
        if age_band == "expired":
            reason = "stale"
        camera = {"p": row["processing_stream_id"], "name": row["name"],
                  "provider_kind": row.get("provider_kind"), "source_stream_id": row.get("source_stream_id"),
                  "x": row["longitude"], "y": row["latitude"],
                  "altitude": row.get("altitude"),
                  "country": row.get("country"),
                  "qs": qualification,
                  "freshness": age_band,
                  "cls": icon, "u": uncertain, "w": reason,
                  "t": row["download_timestamp"].isoformat() if row.get("download_timestamp") else None,
                  "vl": row.get("visibility_lower") if usable else None,
                  "vu": row.get("visibility_upper") if usable else None,
                  "value": row.get("visibility_center") if usable else None}
        site["cams"].append(camera)
    features = []
    for site in sites.values():
        cameras = site["cams"]
        counts = Counter(camera["cls"] for camera in cameras)
        modal = counts.most_common(1)[0][0]
        site["cls"] = modal
        if parameter == "visibility":
            lowers = [c["vl"] for c in cameras if c["vl"] is not None]
            uppers = [c["vu"] for c in cameras if c["vu"] is not None]
            site["cls"] = visibility_class(min(lowers), max(uppers)) if lowers and uppers else "white"
        else:
            tied = [name for name, count in counts.items() if count == counts[modal]]
            if len(tied) > 1:
                site["tie"] = True
                site["pie"] = [camera["cls"] for camera in cameras][:12]
                site["pien"] = len(site["pie"])
        site["n"] = len(cameras)
        site["u"] = any(camera["u"] for camera in cameras)
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [
            sum(camera["x"] for camera in cameras) / len(cameras),
            sum(camera["y"] for camera in cameras) / len(cameras)]}, "properties": site})
    return {"type": "FeatureCollection", "parameter": parameter, "at": at.isoformat(),
            "freshness": freshness.model_dump(),
            "qualified_only": qualified_only,
            "counts": {"sites": len(features), "cameras": len(rows)}, "features": features}


def encode_cursor(row: dict) -> str:
    value = [row["download_timestamp"].isoformat(), row["output_id"]]
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")


def decode_cursor(value: str) -> tuple[datetime, int]:
    if len(value) > 256:
        raise ValueError("invalid cursor")
    try:
        stamp, identifier = json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
        stamp = timestamp(stamp, required=True)
        if isinstance(identifier, bool) or not isinstance(identifier, int) or identifier < 1:
            raise ValueError()
    except (ValueError, TypeError, UnicodeError):
        raise ValueError("invalid cursor") from None
    return stamp, identifier


def build_history(rows: list[dict], parameter: str, limit: int) -> dict:
    truncated = len(rows) > limit
    kept = rows[:limit]
    intervals, missing = [], []
    lower_field = "snow_raw_lower" if parameter == "snow" else "visibility_raw_lower"
    upper_field = "snow_raw_upper" if parameter == "snow" else "visibility_raw_upper"
    for row in reversed(kept):
        point = {"id": row["output_id"], "t": row["download_timestamp"].isoformat(),
                 "lower": row.get(lower_field), "upper": row.get(upper_field),
                 "snow_class": row.get("snow_class"),
                 "snow_threshold_low": row.get("snow_threshold_low"),
                 "snow_threshold_high": row.get("snow_threshold_high"),
                 "snow_qualification": row.get("snow_qualification"),
                 "visibility_qualification": row.get("visibility_qualification"),
                 "calibrated_lower": row.get("visibility_lower"),
                 "calibrated_upper": row.get("visibility_upper"),
                 "calibrated_center": row.get("visibility_center"),
                 "model_version": row.get("model_version"),
                 "postprocessing_version": row.get("postprocessing_version"),
                 "quality_code": row.get("quality_code")}
        if point["lower"] is None:
            missing.append(point)
        else:
            intervals.append(point)
    return {"parameter": parameter, "intervals": intervals, "without_raw_interval": missing,
            "truncated": truncated, "next_cursor": encode_cursor(kept[-1]) if truncated and kept else None}
