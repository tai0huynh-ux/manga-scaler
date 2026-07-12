"""SHA256-addressed image cache implementation."""

import asyncio
import os
from pathlib import Path
from uuid import uuid4

from app.utils.hashing import sha256_bytes


class ImageCache:
    """Stores downloaded images by content hash for deterministic cache reuse."""

    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    async def save(self, image_bytes: bytes, extension: str) -> tuple[str, Path, bool]:
        """Persist image bytes and return the SHA256 key, path, and hit state."""
        digest = sha256_bytes(image_bytes)
        target = self.cache_dir / f"{digest}{extension}"

        if target.exists():
            return digest, target, True

        await asyncio.to_thread(self._atomic_write, target, image_bytes)
        return digest, target, False

    async def save_named(self, key: str, image_bytes: bytes, extension: str) -> tuple[Path, bool]:
        """Persist image bytes under a caller-provided deterministic key."""
        target = self.cache_dir / f"{key}{extension}"
        if target.exists():
            return target, True

        await asyncio.to_thread(self._atomic_write, target, image_bytes)
        return target, False

    def public_filename(self, path: Path) -> str:
        """Return a cache filename suitable for the static cache route."""
        return path.name

    def _atomic_write(self, target: Path, content: bytes) -> None:
        """Write and atomically publish a cache artifact."""
        temporary = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
        try:
            temporary.write_bytes(content)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
