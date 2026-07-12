"""Provider interfaces for cache, image loading, and future inference."""

from pathlib import Path
from typing import Protocol

from app.services.downloader import DownloadedImage


class ImageProvider(Protocol):
    """Provides image bytes from a source URL or future local source."""

    async def download(self, image_url: str) -> DownloadedImage:
        """Return validated image bytes for the requested URL."""
        ...


class CacheProvider(Protocol):
    """Stores and retrieves image artifacts by deterministic cache keys."""

    async def save(self, image_bytes: bytes, extension: str) -> tuple[str, Path, bool]:
        """Persist image bytes and return key, path, and cache-hit state."""
        ...


class UpscaleProvider(Protocol):
    """Defines the contract future AI upscalers must implement."""

    async def upscale(self, image_url: str):
        """Return an API-safe result for the requested image."""
        ...

