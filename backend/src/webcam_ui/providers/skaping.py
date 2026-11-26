"""Resolve Skaping's public current-image metadata, without downloading image bytes."""

import time
from collections import OrderedDict
from html.parser import HTMLParser
from threading import Lock
from urllib.parse import urljoin, urlsplit

import httpx

from webcam_ui.ingestion.parser import safe_provider_url
from webcam_ui.settings import ProviderSettings

PAGE_HOSTS = {"www.skaping.com", "skaping.com"}
IMAGE_HOSTS = {"skaping.s3.gra.io.cloud.ovh.net", "images.skaping.com", "www.skaping.com"}


class PageImage(HTMLParser):
    image = None

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag == "meta" and attributes.get("property") == "og:image":
            candidate = safe_provider_url(attributes.get("content"))
            if candidate and urlsplit(candidate).scheme == "https" and urlsplit(candidate).hostname in IMAGE_HOSTS:
                self.image = candidate


class SkapingImages:
    def __init__(self, settings: ProviderSettings, *, client: httpx.Client | None = None):
        self.settings = settings
        self.client = client or httpx.Client(timeout=settings.request_timeout_seconds, follow_redirects=False)
        self.cache = OrderedDict()
        self.lock = Lock()

    def close(self):
        self.client.close()

    def current(self, provider_url: str | None) -> str | None:
        if not self.settings.current_images_enabled or not (provider_url := safe_provider_url(provider_url)):
            return None
        parsed = urlsplit(provider_url)
        if parsed.hostname not in PAGE_HOSTS or parsed.port not in (None, 80, 443):
            return None
        url = "https://www.skaping.com" + (parsed.path or "/")
        with self.lock:
            cached = self.cache.get(url)
            if cached and cached[0] > time.monotonic():
                self.cache.move_to_end(url)
                return cached[1]
            try:
                current = url
                for _ in range(3):
                    with self.client.stream("GET", current) as response:
                        if response.is_redirect:
                            current = urljoin(current, response.headers.get("location", ""))
                            target = urlsplit(current)
                            if target.scheme != "https" or target.hostname not in PAGE_HOSTS or target.port not in (None, 443):
                                return None
                            continue
                        if response.status_code != 200 or "text/html" not in response.headers.get("content-type", ""):
                            return None
                        body = bytearray()
                        for chunk in response.iter_bytes():
                            body.extend(chunk)
                            if len(body) > 1048576:
                                return None
                    parser = PageImage()
                    parser.feed(body.decode("utf-8", errors="replace"))
                    if parser.image:
                        self.cache[url] = (time.monotonic() + self.settings.cache_seconds, parser.image)
                        self.cache.move_to_end(url)
                        while len(self.cache) > self.settings.maximum_cached_cameras:
                            self.cache.popitem(last=False)
                    return parser.image
            except (httpx.HTTPError, ValueError):
                return None
        return None
