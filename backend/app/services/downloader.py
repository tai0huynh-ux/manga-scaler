"""Async image downloader with timeout and content validation."""

import logging
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class DownloadedImage:
    """Container for downloaded image bytes and response metadata."""

    url: str
    content: bytes
    content_type: str


class ImageDownloader:
    """Downloads remote images asynchronously with size and MIME checks."""

    def __init__(
        self,
        timeout_seconds: float,
        max_download_bytes: int,
        allowed_content_types: tuple[str, ...],
    ) -> None:
        self.max_download_bytes = max_download_bytes
        self.allowed_content_types = allowed_content_types
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=True,
            headers={"User-Agent": "AI-Manga-Upscaler/0.1"},
        )

    async def download(self, image_url: str) -> DownloadedImage:
        """Fetch an image URL and return validated bytes."""
        self._validate_url(image_url)

        try:
            async with self.client.stream("GET", image_url) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").split(";")[0].lower()
                if content_type not in self.allowed_content_types:
                    raise ValueError(f"Unsupported image content type: {content_type or 'unknown'}")

                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > self.max_download_bytes:
                        raise ValueError("Image exceeds configured download size limit.")
                    chunks.append(chunk)

                content = b"".join(chunks)
                if not content:
                    raise ValueError("Downloaded image is empty.")

                LOGGER.info("Downloaded image url=%s bytes=%s", image_url, len(content))
                return DownloadedImage(url=image_url, content=content, content_type=content_type)
        except httpx.TimeoutException as exc:
            raise TimeoutError("Image download timed out.") from exc
        except httpx.HTTPStatusError as exc:
            raise ValueError(f"Image download failed with status {exc.response.status_code}.") from exc
        except httpx.HTTPError as exc:
            raise ValueError("Image download failed.") from exc

    async def close(self) -> None:
        """Release the underlying HTTP client connection pool."""
        await self.client.aclose()

    def _validate_url(self, image_url: str) -> None:
        """Reject non-HTTP URLs before making network requests."""
        parsed = urlparse(image_url)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("Only http and https image URLs are supported.")
        if not parsed.netloc:
            raise ValueError("Image URL must include a host.")

