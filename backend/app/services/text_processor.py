"""Local manga/comic text cleanup and translation preparation pipeline.

The production upscaler must never pretend that translation happened when no
OCR/translation engine is installed.  This module therefore separates three
stages clearly:

1. visual text-region detection and cleanup, implemented with Pillow/NumPy;
2. optional OCR capability probing, currently Tesseract-compatible;
3. optional translation/render metadata with local translation memory.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import threading
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
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

    def __init__(self, config: TextProcessingConfig, history_path: Path | None = None) -> None:
        self.config = config
        self.history_path = history_path
        self.history_limit = 800
        self.context_lines = 4
        self._history_lock = threading.RLock()
        self._translation_memory: dict[tuple[str, str, str], str] = {}
        self._translation_history: list[dict[str, str]] = []
        self._load_translation_history()

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
            "translationAvailable": True,
            "translationProvider": "google-web",
            "translationMemoryEntries": len(self._translation_history),
            "message": (
                "Text cleanup is available. Install Tesseract + pytesseract for OCR. Translation uses a best-effort "
                "online Google Translate endpoint and local translation memory when OCR text is available."
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
        if caps["ocrAvailable"]:
            ocr_regions = self._recognize_text_regions(image, options)
            if ocr_regions:
                regions = ocr_regions
                mask = self._mask_from_regions(image.size, regions)
        processed = image.copy()
        mask_pixels = int(np.count_nonzero(np.asarray(mask, dtype=np.uint8)))

        if options.cleanup and mask_pixels > 0:
            processed = self._remove_text(processed, mask)

        translation_applied = False
        if options.translate:
            if not caps["ocrAvailable"]:
                warnings.append("OCR is not available; translation was skipped instead of guessing text.")
            elif not any(region.text for region in regions):
                warnings.append("OCR did not return usable text; translation was skipped.")

        if options.translate and caps["ocrAvailable"] and options.render_text:
            translated_regions, translation_warnings = self._translate_regions(regions, options)
            warnings.extend(translation_warnings)
            renderable = [region for region in translated_regions if region.translated_text]
            if renderable:
                processed = self._render_translations(processed, renderable)
                regions = translated_regions
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

    def _recognize_text_regions(self, image: Image.Image, options: TextProcessingOptions) -> list[TextRegion]:
        """Use Tesseract word boxes grouped by OCR line when available."""
        try:
            import pytesseract
            from pytesseract import Output
        except ImportError:
            return []

        try:
            data = pytesseract.image_to_data(
                image.convert("RGB"),
                lang=self._ocr_languages(options),
                output_type=Output.DICT,
                config="--psm 6",
            )
        except Exception:
            return []

        line_items: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
        count = len(data.get("text", []))
        for index in range(count):
            text = str(data["text"][index] or "").strip()
            if not text:
                continue
            try:
                confidence = float(data["conf"][index])
            except (TypeError, ValueError):
                confidence = -1.0
            if confidence < 25:
                continue
            item = {
                "text": text,
                "confidence": confidence,
                "x": int(data["left"][index]),
                "y": int(data["top"][index]),
                "width": int(data["width"][index]),
                "height": int(data["height"][index]),
            }
            key = (int(data["block_num"][index]), int(data["par_num"][index]), int(data["line_num"][index]))
            line_items.setdefault(key, []).append(item)

        regions: list[TextRegion] = []
        for items in line_items.values():
            if not items:
                continue
            x0 = max(0, min(item["x"] for item in items) - self.config.mask_padding * 2)
            y0 = max(0, min(item["y"] for item in items) - self.config.mask_padding * 2)
            x1 = min(image.width, max(item["x"] + item["width"] for item in items) + self.config.mask_padding * 2)
            y1 = min(image.height, max(item["y"] + item["height"] for item in items) + self.config.mask_padding * 3)
            text = " ".join(item["text"] for item in sorted(items, key=lambda value: value["x"]))
            area = max(1, (x1 - x0) * (y1 - y0))
            confidence = max(0.0, min(1.0, sum(item["confidence"] for item in items) / (len(items) * 100)))
            regions.append(
                TextRegion(
                    x=x0,
                    y=y0,
                    width=max(1, x1 - x0),
                    height=max(1, y1 - y0),
                    area=area,
                    confidence=confidence,
                    text=text,
                )
            )
        regions.sort(key=lambda region: (region.y, region.x))
        return regions[: self.config.max_regions]

    def _mask_from_regions(self, size: tuple[int, int], regions: list[TextRegion]) -> Image.Image:
        mask = Image.new("L", size, 0)
        draw = ImageDraw.Draw(mask)
        padding = max(1, self.config.mask_padding * 2)
        for region in regions:
            draw.rectangle(
                (
                    max(0, region.x - padding),
                    max(0, region.y - padding),
                    min(size[0], region.x + region.width + padding),
                    min(size[1], region.y + region.height + padding),
                ),
                fill=255,
            )
        return mask

    def _translate_regions(
        self,
        regions: list[TextRegion],
        options: TextProcessingOptions,
    ) -> tuple[list[TextRegion], list[str]]:
        warnings: list[str] = []
        translated: list[TextRegion] = []
        for region in regions:
            if not region.text:
                translated.append(region)
                continue
            try:
                translated_text = self._translate_text_with_memory(
                    region.text,
                    options.source_language,
                    options.target_language,
                )
            except Exception as exc:
                warnings.append(f"Translation failed for one text region: {exc}")
                translated_text = None
            translated.append(
                TextRegion(
                    x=region.x,
                    y=region.y,
                    width=region.width,
                    height=region.height,
                    area=region.area,
                    confidence=region.confidence,
                    text=region.text,
                    translated_text=translated_text,
                )
            )
        return translated, warnings

    def _translate_text_with_memory(self, text: str, source_language: str, target_language: str) -> str:
        normalized = self._normalize_translation_text(text)
        if not normalized:
            return ""
        source = source_language or "auto"
        target = target_language or self.config.target_language
        key = self._translation_key(normalized, source, target)
        cached = self._lookup_translation(key)
        if cached is not None:
            return cached
        context = self._recent_translation_context(source, target)
        translated = self._translate_text(normalized, source, target, context)
        self._remember_translation(normalized, translated, source, target)
        return translated

    def _translate_text(
        self,
        text: str,
        source_language: str,
        target_language: str,
        context: list[str] | None = None,
    ) -> str:
        """Translate text through a lightweight online endpoint without storing credentials."""
        normalized = self._normalize_translation_text(text)
        if not normalized:
            return ""
        source = "auto" if source_language == "auto" else source_language
        context = context or []
        query_text = "\n".join([*context, normalized]) if context else normalized
        query = urllib.parse.urlencode(
            {
                "client": "gtx",
                "sl": source,
                "tl": target_language or self.config.target_language,
                "dt": "t",
                "q": query_text,
            }
        )
        request = urllib.request.Request(
            f"https://translate.googleapis.com/translate_a/single?{query}",
            headers={"User-Agent": "AI-Manga-Upscaler/0.2"},
        )
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        parts = payload[0] if isinstance(payload, list) and payload else []
        translated = "".join(str(part[0]) for part in parts if isinstance(part, list) and part).strip()
        return self._extract_contextual_translation(translated, len(context))

    def _lookup_translation(self, key: tuple[str, str, str]) -> str | None:
        with self._history_lock:
            return self._translation_memory.get(key)

    def _remember_translation(self, source_text: str, translated_text: str, source_language: str, target_language: str) -> None:
        translated_text = self._normalize_translation_text(translated_text)
        if not source_text or not translated_text:
            return
        record = {
            "timestamp": str(round(time.time(), 3)),
            "sourceLanguage": source_language or "auto",
            "targetLanguage": target_language or self.config.target_language,
            "sourceText": source_text,
            "translatedText": translated_text,
        }
        key = self._translation_key(source_text, record["sourceLanguage"], record["targetLanguage"])
        with self._history_lock:
            self._translation_memory[key] = translated_text
            self._translation_history.append(record)
            if len(self._translation_history) > self.history_limit:
                self._translation_history = self._translation_history[-self.history_limit :]
            self._append_translation_record(record)

    def _recent_translation_context(self, source_language: str, target_language: str) -> list[str]:
        source = source_language or "auto"
        target = target_language or self.config.target_language
        with self._history_lock:
            matching = [
                f'{record["sourceText"]} => {record["translatedText"]}'
                for record in self._translation_history
                if record.get("sourceLanguage") == source and record.get("targetLanguage") == target
            ]
        return matching[-self.context_lines :]

    def _load_translation_history(self) -> None:
        if not self.history_path or not self.history_path.exists():
            return
        loaded: list[dict[str, str]] = []
        try:
            with self.history_path.open("r", encoding="utf-8") as history_file:
                for line in history_file:
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    source_text = self._normalize_translation_text(str(record.get("sourceText", "")))
                    translated_text = self._normalize_translation_text(str(record.get("translatedText", "")))
                    source_language = str(record.get("sourceLanguage", "auto") or "auto")
                    target_language = str(record.get("targetLanguage", self.config.target_language) or self.config.target_language)
                    if not source_text or not translated_text:
                        continue
                    loaded.append(
                        {
                            "timestamp": str(record.get("timestamp", "")),
                            "sourceLanguage": source_language,
                            "targetLanguage": target_language,
                            "sourceText": source_text,
                            "translatedText": translated_text,
                        }
                    )
        except OSError:
            return
        with self._history_lock:
            self._translation_history = loaded[-self.history_limit :]
            self._translation_memory = {
                self._translation_key(record["sourceText"], record["sourceLanguage"], record["targetLanguage"]): record[
                    "translatedText"
                ]
                for record in self._translation_history
            }

    def _append_translation_record(self, record: dict[str, str]) -> None:
        if not self.history_path:
            return
        try:
            self.history_path.parent.mkdir(parents=True, exist_ok=True)
            with self.history_path.open("a", encoding="utf-8") as history_file:
                history_file.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
        except OSError:
            return

    def _translation_key(self, text: str, source_language: str, target_language: str) -> tuple[str, str, str]:
        return (
            source_language or "auto",
            target_language or self.config.target_language,
            self._normalize_translation_text(text).casefold(),
        )

    def _normalize_translation_text(self, text: str) -> str:
        return re.sub(r"\s+", " ", text).strip()

    def _extract_contextual_translation(self, translated_text: str, context_count: int) -> str:
        if context_count <= 0:
            return translated_text.strip()
        lines = [line.strip() for line in translated_text.splitlines() if line.strip()]
        if len(lines) > context_count:
            return lines[-1]
        return translated_text.strip()

    def _render_translations(self, image: Image.Image, regions: list[TextRegion]) -> Image.Image:
        """Render translated text into cleaned regions."""
        output = image.copy()
        draw = ImageDraw.Draw(output)
        for region in regions:
            text = region.translated_text or ""
            if not text:
                continue
            font, wrapped = self._fit_text(text, region.width, region.height)
            draw.multiline_text(
                (region.x, region.y),
                wrapped,
                fill=(20, 20, 20),
                font=font,
                spacing=max(1, font.size // 5 if hasattr(font, "size") else 2),
                align="center",
            )
        return output

    def _fit_text(self, text: str, width: int, height: int) -> tuple[ImageFont.ImageFont, str]:
        """Find a readable font size and line wrapping that stays inside a region."""
        words = re.sub(r"\s+", " ", text).strip().split(" ")
        for size in range(min(48, max(10, height)), 8, -1):
            font = self._load_font(size)
            wrapped = self._wrap_words(words, font, width)
            bbox = ImageDraw.Draw(Image.new("RGB", (1, 1))).multiline_textbbox((0, 0), wrapped, font=font, spacing=max(1, size // 5))
            if bbox[2] - bbox[0] <= width and bbox[3] - bbox[1] <= height:
                return font, wrapped
        font = self._load_font(9)
        return font, self._wrap_words(words, font, width)

    def _wrap_words(self, words: list[str], font: ImageFont.ImageFont, width: int) -> str:
        draw = ImageDraw.Draw(Image.new("RGB", (1, 1)))
        lines: list[str] = []
        current = ""
        for word in words:
            candidate = word if not current else f"{current} {word}"
            if draw.textlength(candidate, font=font) <= width:
                current = candidate
                continue
            if current:
                lines.append(current)
            current = word
        if current:
            lines.append(current)
        return "\n".join(lines)

    def _load_font(self, size: int) -> ImageFont.ImageFont:
        for name in ("arial.ttf", "Arial.ttf", "DejaVuSans.ttf"):
            try:
                return ImageFont.truetype(name, size=size)
            except OSError:
                continue
        return ImageFont.load_default()

    def _ocr_languages(self, options: TextProcessingOptions) -> str:
        if options.source_language and options.source_language != "auto":
            return options.source_language
        return self.config.ocr_languages

    def _odd(self, value: int) -> int:
        value = max(3, int(value))
        return value if value % 2 == 1 else value + 1
