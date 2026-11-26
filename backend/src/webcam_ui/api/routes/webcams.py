"""Read-only map, webcam, history, and provider metadata endpoints."""

from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from webcam_ui.api.geography import deployment_bounds, empty_bounds
from webcam_ui.api.presentation import build_history, build_map, decode_cursor
from webcam_ui.ingestion.parser import timestamp
from webcam_ui.providers.links import published_links

router = APIRouter(prefix="/api", tags=["observations"])
Parameter = Literal["snow", "visibility"]


def instant(value: str | None, default: datetime) -> datetime:
    if value is None:
        return default
    try:
        return timestamp(value, required=True)
    except ValueError:
        raise HTTPException(422, "timestamps must be timezone-aware ISO 8601") from None


def camera(request: Request, identifier: str):
    result = request.app.state.queries.webcam(identifier)
    if result is None:
        raise HTTPException(404, "webcam not found")
    return result


@router.get("/map")
def map_data(request: Request, parameter: Parameter = "snow", at: str | None = None,
             bbox: str | None = Query(default=None, max_length=128),
             altitude_band: Literal["all", "low", "middle", "high"] = "all",
             countries: str | None = Query(default=None, max_length=2048),
             include_unknown_country: bool = True, qualified_only: bool = True):
    at_time = instant(at, datetime.now(UTC))
    bounds = None
    if bbox is not None:
        try:
            bounds = tuple(float(value) for value in bbox.split(","))
            if len(bounds) != 4 or not (-180 <= bounds[0] < bounds[2] <= 180
                                        and -90 <= bounds[1] < bounds[3] <= 90):
                raise ValueError()
        except ValueError:
            raise HTTPException(422, "bbox must be west,south,east,north") from None
    deployment = request.app.state.settings
    settings = deployment.api
    selected_countries = deployment.filters.allowed_countries
    if countries is not None:
        selected_countries = list(dict.fromkeys(value.strip().upper() for value in countries.split(","))) if countries.strip() else []
        if any(code not in deployment.filters.allowed_countries for code in selected_countries):
            raise HTTPException(422, "countries must be listed in filters.allowed_countries")
    bounds = deployment_bounds(bounds, deployment.filters.bounding_box)
    if empty_bounds(bounds):
        return build_map([], parameter, at_time, settings.prediction_max_age_minutes, qualified_only)
    rows = request.app.state.queries.map_rows(parameter, at_time, settings.maximum_map_cameras,
                                            bounds, altitude_band,
                                            selected_countries, include_unknown_country, qualified_only)
    if len(rows) > settings.maximum_map_cameras:
        raise HTTPException(413, "map contains too many cameras; request a smaller bbox")
    return build_map(rows, parameter, at_time, settings.prediction_max_age_minutes, qualified_only)


@router.get("/webcams/{processing_stream_id}")
def detail(request: Request, processing_stream_id: str):
    result = camera(request, processing_stream_id)
    result["predictions"] = request.app.state.queries.latest(processing_stream_id)
    result["provider"] = published_links(result)
    return result


@router.get("/webcams/{processing_stream_id}/history")
def history(request: Request, processing_stream_id: str, parameter: Parameter = "snow",
            start: str | None = None, end: str | None = None,
            limit: int = Query(default=1000, ge=1, le=100000),
            cursor: str | None = Query(default=None, max_length=256)):
    camera(request, processing_stream_id)
    end_time = instant(end, datetime.now(UTC))
    start_time = instant(start, end_time - timedelta(days=1))
    settings = request.app.state.settings.api
    if start_time > end_time or end_time - start_time > timedelta(days=settings.maximum_history_days):
        raise HTTPException(422, f"history range must be ordered and at most {settings.maximum_history_days} days")
    try:
        before = decode_cursor(cursor) if cursor else None
    except ValueError:
        raise HTTPException(422, "invalid history cursor") from None
    limit = min(limit, settings.maximum_history_points)
    rows = request.app.state.queries.history(processing_stream_id, parameter, start_time,
                                           end_time, limit, before)
    return {"processing_stream_id": processing_stream_id,
            "start": start_time.isoformat(), "end": end_time.isoformat(),
            **build_history(rows, parameter, limit)}


@router.get("/webcams/{processing_stream_id}/provider")
def provider(request: Request, processing_stream_id: str, current_image: bool = False):
    webcam = camera(request, processing_stream_id)
    result = published_links(webcam)
    if current_image and not result["image_url"] and webcam["provider_kind"] == "windy":
        identifier = webcam.get("provider_webcam_id")
        result["image_url"] = request.app.state.provider.current(identifier) if identifier else None
        result["image_embeddable"] = bool(result["image_url"] and result["image_url"].startswith("https://"))
        if not result["image_url"]:
            result["image_unavailable_reason"] = "current_image_unavailable"
    elif current_image and not result["image_url"] and webcam["provider_kind"] == "skaping":
        result["image_url"] = request.app.state.skaping.current(result["page_url"])
        result["image_embeddable"] = bool(result["image_url"])
        if not result["image_url"]:
            result["image_unavailable_reason"] = "current_image_unavailable"
    return result
