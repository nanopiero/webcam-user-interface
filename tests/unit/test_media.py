from webcam_ui.providers.media import published_media, windy_identifier


def test_umap_images_videos_and_iframes_keep_their_published_connection_method():
    media = published_media(
        "{{https://example.org/latest.jpg|400}}\n"
        "{{{https://example.org/player?camera=one}}}\n"
        "{{{https://example.org/current.mp4}}}",
        ["https://example.org/latest.jpg", "https://example.org/current.mp4"],
    )
    assert media == [{"kind": "image", "url": "https://example.org/latest.jpg"},
                     {"kind": "frame", "url": "https://example.org/player?camera=one"},
                     {"kind": "video", "url": "https://example.org/current.mp4"}]


def test_windy_identifier_requires_published_provider_identity_not_coordinates():
    assert windy_identifier("https://www.windy.com/webcams/1234567890") == "1234567890"
    assert windy_identifier("https://images-webcams.windy.com/90/1234567890/current/full/image.jpg") == "1234567890"
    assert windy_identifier("https://www.windy.com/?45,6,16") is None
    assert windy_identifier("https://other.example/webcams/1234567890") is None
