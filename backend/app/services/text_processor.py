"""Local manga/comic text cleanup and translation preparation pipeline.

The production upscaler must never pretend that translation happened when no
OCR/translation engine is installed.  This module therefore separates three
stages clearly:

1. visual text-region detection and cleanup, implemented with Pillow/NumPy;
2. optional OCR capability probing, currently Tesseract-compatible;
3. optional translation/render metadata, reported as unavailable until a real
   provider is configured.
"""

from __future__ import annotations

import asyncio
import shutil
from dataclasses import dataclass
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.core.config import TextProcessingConfig


@dataclass(frozen=True)
class TextRegion:
    """A detected text-like region in image coordinates."""

    x: int
    y: int
    width: int
    height: int
    area: int
    confidence: float
    text: str | None = None
    translated_text: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "area": self.area,
            "confidence": round(self.confidence, 4),
            "text": self.text,
            "translatedText": self.translated_text,
        }


@dataclass(frozen=True)
class TextProcessingResult:
    """Result of text cleanup and optional translation rendering."""

    image: Image.Image
    regions: list[TextRegion]
    mask_pixels: int
    ocr_available: bool
    translation_available: bool
    translation_applied: bool
    warnings: list[str]

    def metadata(self) -> dict[str, Any]:
        return {
            "regions": [region.as_dict() for region in self.regions],
            "regionCount": len(self.regions),
            "maskPixels": self.mask_pixels,
            "ocrAvailable": self.ocr_available,
            "translationAvailable": self.translation_available,
            "translationApplied": self.translation_applied,
            "warnings": self.warnings,
        }


@dataclass(frozen=True)
class TextProcessingOptions:
    """Per-request text processing options."""

    enabled: bool = False
    cleanup: bool = True
    translate: bool = False
    source_language: str = "auto"
    target_language: str = "vi"
    render_text: bool = True

    @classmethod
    def from_payload(cls, payload: Any) -> "TextProcessingOptions":
        if payload is None:
            return cls()
        if isinstance(payload, TextProcessingOptions):
            return payload
        return cls(
            enabled=bool(getattr(payload, "enabled", False)),
            cleanup=bool(getattr(payload, "cleanup", True)),
            translate=bool(getattr(payload, "translate", False)),
            source_language=str(getattr(payload, "source_language", "auto") or "auto"),
            target_language=str(getattr(payload, "target_language", "vi") or "vi"),
            render_text=bool(getattr(payload, "render_text", True)),
        )


class TextProcessor:
    """Detect text-like marks, remove old text, and prepare translation metadata."""

    def __init__(self, config: TextProcessingConfig) -> None:
        self.config = config

    def capabilities(self) -> dict[str, Any]:
        """Return deterministic capability diagnostics for UI and tests."""
        tesseract_path = shutil.which("tesseract")
        try:
            import pytesseract  # noqa: F401

            pytesseract_available = True
        except ImportError:
            pytesseract_available = False
        return {
            "cleanupAvailable": True,
            "ocrAvailable": bool(tesseract_path and pytesseract_available),
            "ocrEngine": "tesseract" if tesseract_path and pytesseract_available else None,
            "tesseractPath": tesseract_path,
            "pytesseractAvailable": pytesseract_available,
            "translationAvailable": False,
            "translationProvider": None,
            "message": (
                "Text cleanup is available. Install Tesseract + pytesseract and configure a translation provider "
                "before enabling real OCR translation."
            ),
        }

    async def process(self, image: Image.Image, options: TextProcessingOptions | None = None) -> TextProcessingResult:
        """Run the text pipeline off the event loop."""
        return await asyncio.to_thread(self._process_sync, image, options or TextProcessingOptions())

    def _process_sync(self, image: Image.Image, options: TextProcessingOptions) -> TextProcessingResult:
        caps = self.capabilities()
        warnings: list[str] = []
        if not options.enabled:
            return TextProcessingResult(
                image=image,
                regions=[],
                mask_pixels=0,
                ocr_available=bool(caps["ocrAvailable"]),
                translation_available=False,
                translation_applied=False,
                warnings=[],
            )

        mask = self._detect_text_mask(image)
        regions = self._detect_regions(mask, image.width, image.height)
        processed = image.copy()
        mask_pixels = int(np.count_nonzero(np.asarray(mask, dtype=np.uint8)))

        if options.cleanup and mask_pixels > 0:
            processed = self._remove_text(processed, mask)

        translation_applied = False
        if options.translate:
            if not caps["ocrAvailable"]:
                warnings.append("OCR is not available; translation was skipped instead of guessing text.")
            if not caps["translationAvailable"]:
                warnings.append("No translation provider is configured; translated text was not rendered.")

        if options.translate and caps["ocrAvailable"] and caps["translationAvailable"] and options.render_text:
            # Reserved integration point for the real OCR/translation provider.
            # Keeping this branch explicit prevents a future implementation from
            # accidentally reporting translation success without rendered text.
            processed = self._render_translations(processed, [])
            translation_applied = True

        return TextProcessingResult(
            image=processed,
            regions=regions,
            mask_pixels=mask_pixels,
            ocr_available=bool(caps["ocrAvailable"]),
            translation_available=bool(caps["translationAvailable"]),
            translation_applied=translation_applied,
            warnings=warnings,
        )

    def _detect_text_mask(self, image: Image.Image) -> Image.Image:
        """Detect dark glyph-like pixels that sit inside a light local background."""
        rgb = image.convert("RGB")
        grayscale = rgb.convert("L")
        light_background = grayscale.filter(ImageFilter.MaxFilter(self._odd(self.config.background_radius)))
        luminance = np.asarray(grayscale, dtype=np.uint8)
        background = np.asarray(light_background, dtype=np.uint8)

        # Dark pixels alone would also catch hair/clothes.  Requiring a bright
        # neighborhood biases the mask toward speech bubbles, captions, and page
        # margins, which are the text areas that should be cleaned first.
        mask_array = (luminance <= self.config.dark_threshold) & (background >= self.config.light_threshold)
        mask = Image.fromarray(mask_array.astype(np.uint8) * 255)

        if self.config.mask_padding > 0:
            mask = mask.filter(ImageFilter.MaxFilter(self._odd(self.config.mask_padding * 2 + 1)))
        return mask

    def _detect_regions(self, mask: Image.Image, source_width: int, source_height: int) -> list[TextRegion]:
        """Find connected regions on a downscaled mask for speed."""
        scale = max(1, int(max(source_width, source_height) / 1400))
        small_width = max(1, source_width // scale)
        small_height = max(1, source_height // scale)
        small = mask.resize((small_width, small_height), Image.Resampling.NEAREST)
        data = np.asarray(small, dtype=np.uint8) > 0
        visited = np.zeros(data.shape, dtype=bool)
        regions: list[TextRegion] = []
        max_area = int(source_width * source_height * self.config.max_region_area_ratio)

        for y in range(small_height):
            for x in range(small_width):
                if visited[y, x] or not data[y, x]:
                    continue
                sx0, sy0, sx1, sy1, count = self._flood_component(data, visited, x, y)
                area = count * scale * scale
                if area < self.config.min_region_area or area > max_area:
                    continue
                x0 = max(0, sx0 * scale)
                y0 = max(0, sy0 * scale)
                x1 = min(source_width, (sx1 + 1) * scale)
                y1 = min(source_height, (sy1 + 1) * scale)
                width = max(1, x1 - x0)
                height = max(1, y1 - y0)
                aspect = width / height
                if aspect > 30 or aspect < 0.03:
                    continue
                fill_ratio = min(1.0, area / max(width * height, 1))
                confidence = min(1.0, 0.35 + fill_ratio * 1.8)
                regions.append(TextRegion(x=x0, y=y0, width=width, height=height, area=area, confidence=confidence))
                if len(regions) >= self.config.max_regions:
                    return regions
        regions.sort(key=lambda region: (region.y, region.x))
        return regions

    def _flood_component(
        self,
        data: np.ndarray,
        visited: np.ndarray,
        start_x: int,
        start_y: int,
    ) -> tuple[int, int, int, int, int]:
        height, width = data.shape
        stack = [(start_x, start_y)]
        visited[start_y, start_x] = True
        x0 = x1 = start_x
        y0 = y1 = start_y
        count = 0
        while stack:
            x, y = stack.pop()
            count += 1
            x0, x1 = min(x0, x), max(x1, x)
            y0, y1 = min(y0, y), max(y1, y)
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or ny < 0 or nx >= width or ny >= height:
                    continue
                if visited[ny, nx] or not data[ny, nx]:
                    continue
                visited[ny, nx] = True
                stack.append((nx, ny))
        return x0, y0, x1, y1, count

    def _remove_text(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        """Replace detected text pixels with a locally smoothed background."""
        background = image.filter(ImageFilter.MedianFilter(size=15)).filter(ImageFilter.GaussianBlur(radius=2.4))
        cleaned = image.copy()
        cleaned.paste(background, mask=mask)
        return cleaned

    def _render_translations(self, image: Image.Image, regions: list[TextRegion]) -> Image.Image:
        """Render translated text into cleaned regions."""
        output = image.copy()
        draw = ImageDraw.Draw(output)
        font = ImageFont.load_default()
        for region in regions:
            text = region.translated_text or ""
            if not text:
                continue
            draw.multiline_text((region.x, region.y), text, fill=(20, 20, 20), font=font, spacing=2)
        return output

    def _odd(self, value: int) -> int:
        value = max(3, int(value))
        return value if value % 2 == 1 else value + 1
