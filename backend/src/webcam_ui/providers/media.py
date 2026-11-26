"""Interpret provider embeds explicitly published by uMap, without fetching arbitrary URLs."""

import html
import re
from urllib.parse import urlsplit

from webcam_ui.ingestion.parser import safe_provider_url


def media_kind(url: str, fallback: str = "image") -> str:
    path = urlsplit(url).path.lower()
    if path.endswith((".mp4", ".webm", ".ogv", ".ogg")):
        return "video"
    if path.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")):
        return "image"
    return fallback


def published_media(description: str, links: list[str]) -> list[dict]:
    media, seen = [], set()

    def add(value, kind):
        url = safe_provider_url(html.unescape(value))
        if url and url not in seen:
            seen.add(url)
            media.append({"kind": media_kind(url, kind), "url": url})

    for match in re.finditer(r"(\{\{\{?)(https?://[^\s{}|]+)(?:\|[^{}]*)?\}\}\}?", description):
        add(match[2], "frame" if len(match[1]) == 3 else "image")
    for url in links:
        if media_kind(url, ""):
            add(url, media_kind(url))
    return media


def windy_identifier(url: str) -> str | None:
    parsed = urlsplit(url)
    if parsed.hostname in {"www.windy.com", "windy.com"}:
        match = re.search(r"/webcams/(\d+)(?:/|$)", parsed.path)
    elif parsed.hostname == "images-webcams.windy.com":
        match = re.search(r"/(\d{5,})/current/", parsed.path)
    else:
        return None
    return match[1] if match else None
