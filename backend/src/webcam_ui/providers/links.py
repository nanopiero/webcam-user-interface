"""Use published HTTP(S) links first; Windy public pages need no API request."""

from pathlib import PurePosixPath
from urllib.parse import urlsplit

from webcam_ui.ingestion.parser import safe_provider_url


def published_links(webcam: dict) -> dict:
    url = safe_provider_url(webcam.get("provider_url"))
    image_url = None
    if url and PurePosixPath(urlsplit(url).path).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        image_url = url
    identifier = webcam.get("provider_webcam_id")
    if not url and webcam.get("provider_kind") == "windy" and identifier and identifier.isdecimal():
        url = f"https://www.windy.com/webcams/{identifier}"
    return {"page_url": url, "image_url": image_url, "available": bool(url),
            "image_embeddable": bool(image_url and image_url.startswith("https://"))}
