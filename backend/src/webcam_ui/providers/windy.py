"""A bounded short cache of Windy v3 image URLs; API keys stay on the backend."""

import time
from collections import OrderedDict
from threading import Lock

import httpx

from webcam_ui.ingestion.parser import safe_provider_url
from webcam_ui.settings import ProviderSettings, read_secret


class WindyImages:
    def __init__(self, settings: ProviderSettings, *, client: httpx.Client | None = None):
        self.settings = settings
        self.client = client or httpx.Client(timeout=settings.request_timeout_seconds,
                                            follow_redirects=False)
        self.cache: OrderedDict[str, tuple[float, str]] = OrderedDict()
        self.lock = Lock()

    def close(self):
        self.client.close()

    def current(self, identifier: str) -> str | None:
        if not self.settings.current_images_enabled or not identifier.isascii() or not identifier.isdecimal():
            return None
        with self.lock:
            cached = self.cache.get(identifier)
            if cached and cached[0] > time.monotonic():
                self.cache.move_to_end(identifier)
                return cached[1]
            try:
                key = read_secret(self.settings.windy_api_key_file)
                with self.client.stream(
                    "GET", f"https://api.windy.com/webcams/api/v3/webcams/{identifier}",
                    params={"include": "images"}, headers={"x-windy-api-key": key},
                ) as response:
                    if response.status_code != 200:
                        return None
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body.extend(chunk)
                        if len(body) > 262144:
                            return None
                    import json
                    data = json.loads(body)
                current = data.get("images", {}).get("current", {})
                image = next((url for size in ("preview", "thumbnail", "icon")
                              if (url := safe_provider_url(current.get(size)))), None)
                if image:
                    self.cache[identifier] = (time.monotonic() + self.settings.cache_seconds, image)
                    self.cache.move_to_end(identifier)
                    while len(self.cache) > self.settings.maximum_cached_cameras:
                        self.cache.popitem(last=False)
                return image
            except (httpx.HTTPError, ValueError, TypeError, AttributeError):
                return None
