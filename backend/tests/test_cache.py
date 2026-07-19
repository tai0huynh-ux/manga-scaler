"""Image cache accounting tests."""

import asyncio

from app.services.cache import ImageCache


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
