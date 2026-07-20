"""Image cache accounting tests."""

import asyncio

from app.services.cache import ImageCache
from app.services.upscaler import UpscalerService


def test_file_count_is_initialized_once_and_tracks_new_artifacts(tmp_path) -> None:
    (tmp_path / "existing.webp").write_bytes(b"existing")
    cache = ImageCache(tmp_path)

    assert cache.file_count == 1

    first_path, first_hit = asyncio.run(cache.save_named("new", b"first", ".png"))
    second_path, second_hit = asyncio.run(cache.save_named("new", b"second", ".png"))

    assert first_path == second_path
    assert first_hit is False
    assert second_hit is True
    assert cache.file_count == 2


def test_browser_png_original_cache_reuses_submitted_bytes_without_reencoding() -> None:
    class PipelineSpy:
        calls = 0

        async def encode_png(self, _image):
            self.calls += 1
            return b"reencoded"

    submitted = b"\x89PNG\r\n\x1a\nsubmitted-png"
    service = UpscalerService.__new__(UpscalerService)
    service.pipeline = PipelineSpy()

    cached = asyncio.run(service._original_cache_bytes(submitted, object()))

    assert cached == submitted
    assert service.pipeline.calls == 0
