"""Liveness, database readiness, and non-secret ingestion status."""

import json

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(tags=["health"])


@router.get("/health/live")
def live():
    return {"status": "ok"}


@router.get("/health/ready")
def ready(request: Request):
    request.app.state.database.ready()
    return {"status": "ready"}


@router.get("/api/status")
def status(request: Request):
    return request.app.state.queries.statistics()


@router.get("/api/config")
def configuration(request: Request):
    settings = request.app.state.settings
    return {"parameters": ["snow", "visibility"],
            "roi": settings.roi.model_dump(),
            "max_prediction_age_minutes": settings.api.prediction_max_age_minutes,
            "diagram": {"initial_days": 1, "max_days": settings.api.maximum_history_days},
            "filters": settings.filters.model_dump(),
            "frontend_configuration": "/frontend-config.json"}


@router.get("/frontend-config.json")
def frontend_configuration(request: Request):
    try:
        result = json.loads(request.app.state.settings.api.frontend_config_file.read_text())
        if not isinstance(result, dict):
            raise ValueError()
    except (OSError, ValueError):
        raise HTTPException(503, "frontend configuration unavailable") from None
    # One deployment setting drives both ingestion and browser controls.
    result["countries"] = request.app.state.settings.filters.allowed_countries
    result["roi"] = request.app.state.settings.roi.model_dump()
    return result
