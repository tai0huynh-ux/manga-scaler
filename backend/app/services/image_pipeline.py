"""Pillow and NumPy image processing pipeline for tiled ONNX inference."""

import asyncio
import io
import time
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, UnidentifiedImageError

from app.core.config import EncodingConfig, EnhancementConfig
from app.services.model_manager import LoadedModel


@dataclass(frozen=True)
class EncodedImage:
    """Encoded upscaled image artifact."""

    content: bytes
    content_type: str
    width: int | None
    height: int | None
    gpu_time_ms: float


@dataclass(frozen=True)
class InferenceImage:
    """Merged RGB model output before final encoding."""

    image: Image.Image
    gpu_time_ms: float


class ImagePipeline:
    """Decodes, tiles, runs inference, merges tiles, and encodes WebP."""

    def __init__(self, encoding: EncodingConfig, enhancement: EnhancementConfig) -> None:
        self.encoding = encoding
        self.enhancement = enhancement

    async def decode(self, image_bytes: bytes) -> Image.Image:
        """Decode image bytes and convert to RGB."""
        return await asyncio.to_thread(self._decode_sync, image_bytes)

    async def encode_webp(self, image: Image.Image) -> bytes:
        """Encode an RGB image to WebP bytes."""
        return await asyncio.to_thread(self._encode_webp_sync, image)

    async def encode_png(self, image: Image.Image) -> bytes:
        """Encode a lossless verification copy of the browser input."""
        return await asyncio.to_thread(self._encode_png_sync, image)

    def _encode_png_sync(self, image: Image.Image) -> bytes:
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        return output.getvalue()

    async def enhance(self, image: Image.Image, level: float) -> Image.Image:
        """Apply configurable, bounded post-processing at the requested strength."""
        return await asyncio.to_thread(self._enhance_sync, image, level)

    async def fit_for_model_scale(self, image: Image.Image, scale: int) -> Image.Image:
        """Bound source dimensions so the encoded result fits the WebP format."""
        maximum_source_dimension = self.encoding.max_output_dimension // scale
        if max(image.size) <= maximum_source_dimension:
            return image
        fitted = image.copy()
        fitted.thumbnail((maximum_source_dimension, maximum_source_dimension), Image.Resampling.LANCZOS)
        return fitted

    def _enhance_sync(self, image: Image.Image, level: float) -> Image.Image:
        level = min(max(level, 0.0), 1.0)
        if level == 0:
            return image
        result = image
        sharpness = 1 + (self.enhancement.sharpness - 1) * level
        contrast = 1 + (self.enhancement.contrast - 1) * level
        color = 1 + (self.enhancement.color - 1) * level
        if abs(sharpness - 1) >= 0.01:
            result = ImageEnhance.Sharpness(result).enhance(sharpness)
        if abs(contrast - 1) >= 0.01:
            result = ImageEnhance.Contrast(result).enhance(contrast)
        if abs(color - 1) >= 0.01:
            result = ImageEnhance.Color(result).enhance(color)
        denoise_mix = self.enhancement.denoise * level
        if denoise_mix >= 0.04:
            result = Image.blend(result, result.filter(ImageFilter.MedianFilter(size=3)), denoise_mix)
        return result

    async def infer_tiled(
        self,
        image: Image.Image,
        model: LoadedModel,
        tile_size: int,
        overlap: int,
        batch_size: int,
        cancellation_check: Callable[[], bool] | None = None,
    ) -> InferenceImage:
        """Run tiled model inference and merge the output tiles."""
        result, gpu_time_ms = await asyncio.to_thread(
            self._infer_tiled_sync,
            image,
            model,
            tile_size,
            overlap,
            batch_size,
            cancellation_check,
        )
        return InferenceImage(image=result, gpu_time_ms=gpu_time_ms)

    def _decode_sync(self, image_bytes: bytes) -> Image.Image:
        """Decode image bytes using Pillow and normalize to RGB."""
        try:
            with Image.open(io.BytesIO(image_bytes)) as image:
                image.load()
                return image.convert("RGB")
        except (UnidentifiedImageError, OSError) as exc:
            raise ValueError("Browser-supplied data is not a supported image.") from exc

    def _encode_webp_sync(self, image: Image.Image) -> bytes:
        """Encode an image using configured WebP settings."""
        output = io.BytesIO()
        image.save(
            output,
            format=self.encoding.format,
            quality=self.encoding.quality,
            lossless=self.encoding.lossless,
            method=self.encoding.method,
        )
        return output.getvalue()

    def _infer_tiled_sync(
        self,
        image: Image.Image,
        model: LoadedModel,
        tile_size: int,
        overlap: int,
        batch_size: int,
        cancellation_check: Callable[[], bool] | None = None,
    ) -> tuple[Image.Image, float]:
        """Run synchronous tile inference and merge tile outputs."""
        source = np.asarray(image, dtype=np.float32) / 255.0
        height, width, _ = source.shape
        scale = model.scale
        output = np.zeros((height * scale, width * scale, 3), dtype=np.float32)
        weights = np.zeros((height * scale, width * scale, 1), dtype=np.float32)

        tiles = list(self._tiles(width, height, tile_size, overlap))
        gpu_time_ms = 0.0

        for start in range(0, len(tiles), batch_size):
            if cancellation_check and cancellation_check():
                raise InterruptedError("Tiled inference was cancelled.")
            batch_specs = tiles[start : start + batch_size]
            batch = np.stack(
                [self._extract_tile(source, spec, tile_size) for spec in batch_specs],
                axis=0,
            )
            batch = np.transpose(batch, (0, 3, 1, 2)).astype(np.float32)

            gpu_started = time.perf_counter()
            with model.run_lock:
                prediction = model.session.run([model.output_name], {model.input_name: batch})[0]
            gpu_time_ms += (time.perf_counter() - gpu_started) * 1000

            prediction = np.transpose(prediction, (0, 2, 3, 1))
            for tile_output, spec in zip(prediction, batch_specs, strict=True):
                self._merge_tile(output, weights, tile_output, spec, scale)

        output /= np.maximum(weights, 1.0)
        output = np.clip(output * 255.0, 0, 255).astype(np.uint8)
        return Image.fromarray(output), round(gpu_time_ms, 3)

    def _tiles(self, width: int, height: int, tile_size: int, overlap: int) -> list[tuple[int, int, int, int]]:
        """Create overlapping tile rectangles as x0, y0, x1, y1."""
        stride = max(tile_size - (overlap * 2), 1)
        tiles: list[tuple[int, int, int, int]] = []
        y = 0
        while y < height:
            x = 0
            y1 = min(y + tile_size, height)
            y0 = max(0, y1 - tile_size)
            while x < width:
                x1 = min(x + tile_size, width)
                x0 = max(0, x1 - tile_size)
                tiles.append((x0, y0, x1, y1))
                if x + stride >= width:
                    break
                x += stride
            if y + stride >= height:
                break
            y += stride
        return tiles

    def _extract_tile(
        self,
        source: np.ndarray,
        spec: tuple[int, int, int, int],
        tile_size: int,
    ) -> np.ndarray:
        """Extract and edge-pad a tile to the configured model tile size."""
        x0, y0, x1, y1 = spec
        tile = source[y0:y1, x0:x1, :]
        pad_y = tile_size - tile.shape[0]
        pad_x = tile_size - tile.shape[1]
        if pad_x or pad_y:
            tile = np.pad(tile, ((0, pad_y), (0, pad_x), (0, 0)), mode="edge")
        return tile

    def _merge_tile(
        self,
        output: np.ndarray,
        weights: np.ndarray,
        tile_output: np.ndarray,
        spec: tuple[int, int, int, int],
        scale: int,
    ) -> None:
        """Merge a tile by averaging every valid overlapping prediction."""
        x0, y0, x1, y1 = spec
        out_x0, out_y0 = x0 * scale, y0 * scale
        out_x1, out_y1 = x1 * scale, y1 * scale
        valid_width, valid_height = out_x1 - out_x0, out_y1 - out_y0
        output[out_y0:out_y1, out_x0:out_x1, :] += tile_output[:valid_height, :valid_width, :]
        weights[out_y0:out_y1, out_x0:out_x1, :] += 1.0
