import httpx
from webcam_ui.providers.links import published_links
from webcam_ui.providers.skaping import SkapingImages
from webcam_ui.providers.windy import WindyImages
from webcam_ui.settings import ProviderSettings


def test_public_link_reused_and_windy_page_needs_no_api():
    assert published_links({"provider_url": "https://example.org/camera"})["page_url"] == "https://example.org/camera"
    assert published_links({"provider_kind": "windy", "provider_webcam_id": "123"})["page_url"] == "https://www.windy.com/webcams/123"
    assert published_links({"provider_url": "useAPI"})["available"] is False


def test_unsafe_provider_schemes_and_credentials_are_not_returned():
    for url in ["javascript:alert(1)", "file:///etc/passwd", "https://user:password@example.org/a"]:
        assert published_links({"provider_url": url})["page_url"] is None


def test_direct_image_link_identified_without_downloading():
    result = published_links({"provider_url": "https://example.org/current.jpg"})
    assert result["image_url"] == result["page_url"]
    assert result["image_embeddable"]


def test_windy_api_is_backend_only_and_cached(tmp_path):
    key = tmp_path / "windy_key"
    key.write_text("example-test-api-key")
    calls = []
    def handle(request):
        calls.append(request)
        assert request.url.host == "api.windy.com"
        assert request.headers["x-windy-api-key"] == "example-test-api-key"
        return httpx.Response(200, json={"images": {"current": {"preview": "https://images.example.org/current.jpg?token=example"}}})
    resolver = WindyImages(ProviderSettings(windy_api_key_file=key), client=httpx.Client(transport=httpx.MockTransport(handle)))
    first = resolver.current("123")
    assert first == resolver.current("123")
    assert "example-test-api-key" not in first
    assert len(calls) == 1
    resolver.close()


def test_missing_key_and_provider_failure_are_graceful(tmp_path):
    resolver = WindyImages(ProviderSettings(windy_api_key_file=tmp_path / "missing"))
    assert resolver.current("123") is None
    resolver.close()
    key = tmp_path / "key"
    key.write_text("example")
    resolver = WindyImages(ProviderSettings(windy_api_key_file=key), client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(429))))
    assert resolver.current("123") is None
    assert resolver.current("not-a-webcam-id") is None
    resolver.close()


def test_skaping_current_image_uses_public_metadata_and_never_downloads_image_bytes():
    calls = []
    def handle(request):
        calls.append(request)
        assert request.url.host == "www.skaping.com"
        return httpx.Response(200, headers={"content-type": "text/html"},
                              text='<meta property="og:image" content="https://skaping.s3.gra.io.cloud.ovh.net/example/current.jpg">')
    resolver = SkapingImages(ProviderSettings(), client=httpx.Client(transport=httpx.MockTransport(handle)))
    assert resolver.current("http://www.skaping.com/example/camera").endswith("/current.jpg")
    assert resolver.current("https://www.skaping.com/example/camera").endswith("/current.jpg")
    assert len(calls) == 1
    assert resolver.current("http://127.0.0.1/private") is None
    resolver.close()


def test_skaping_does_not_follow_redirects_to_private_or_other_hosts():
    resolver = SkapingImages(ProviderSettings(), client=httpx.Client(transport=httpx.MockTransport(
        lambda _: httpx.Response(302, headers={"location": "https://127.0.0.1/private"}))))
    assert resolver.current("https://www.skaping.com/example/camera") is None
    resolver.close()
