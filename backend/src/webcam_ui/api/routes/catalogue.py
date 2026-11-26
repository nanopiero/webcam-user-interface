"""Supplementary webcam catalogue: separate, read-only points with source attribution."""

from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Query, Request

from webcam_ui.api.geography import deployment_bounds
from webcam_ui.providers.catalogue import CatalogueUnavailable
from webcam_ui.providers.media import windy_identifier

router = APIRouter(prefix="/api/supplementary-webcams", tags=["supplementary webcams"])


@router.get("")
def catalogue(request: Request, bbox: str | None = Query(default=None, max_length=128)):
    bounds = None
    if bbox is not None:
        try:
            bounds = tuple(float(value) for value in bbox.split(","))
            if len(bounds) != 4 or not (-180 <= bounds[0] < bounds[2] <= 180
                                        and -90 <= bounds[1] < bounds[3] <= 90):
                raise ValueError()
        except ValueError:
            raise HTTPException(422, "bbox must be west,south,east,north") from None
    bounds = deployment_bounds(bounds, request.app.state.settings.filters.bounding_box)
    service = request.app.state.catalogue
    try:
        coordinates = request.app.state.queries.webcam_coordinates() if service.settings.enabled else []
        return service.collection(coordinates, bounds)
    except CatalogueUnavailable:
        raise HTTPException(503, "supplementary webcam catalogue unavailable") from None


@router.get("/{identifier}")
def detail(request: Request, identifier: str):
    try:
        result = request.app.state.catalogue.detail(identifier)
    except CatalogueUnavailable:
        raise HTTPException(503, "supplementary webcam catalogue unavailable") from None
    if result is None:
        raise HTTPException(404, "supplementary webcam not found")
    return result


@router.get("/{identifier}/provider")
def provider(request: Request, identifier: str):
    webcam = detail(request, identifier)
    media = [item for item in webcam["media"] if item["url"].startswith("https://")]
    image = None
    for url in webcam["links"]:
        if identifier := windy_identifier(url):
            image = request.app.state.provider.current(identifier)
            break
        if urlsplit(url).hostname in {"www.skaping.com", "skaping.com"}:
            image = request.app.state.skaping.current(url)
            break
    if image and image.startswith("https://"):
        media = [{"kind": "image", "url": image}, *[item for item in media if item["url"] != image]]
    if not media and webcam["provider_url"] and webcam["provider_url"].startswith("https://"):
        media = [{"kind": "frame", "url": webcam["provider_url"]}]
    return {"page_url": webcam["provider_url"], "media": media}
