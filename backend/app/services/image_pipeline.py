"""Pillow and NumPy image processing pipeline for tiled ONNX inference."""

import asyncio
import io
import time
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, UnidentifiedImageError

from app.core.config import EncodingConfig, EnhancementConfig
from app.core.tracing import duration_ms, emit_trace_event
from app.services.model_manager import LoadedModel

FAST_ENHANCE_LEVEL = 0.10
MAX_NEURAL_INPUT_PIXELS = 500_000


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

    async def encode_webp(
        self, image: Image.Image, quality: int | None = None, *, fast: bool = False
    ) -> bytes:
        """Encode an RGB image to WebP bytes."""
        return await asyncio.to_thread(self._encode_webp_sync, image, quality, fast)

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

    async def blend_neural_result(
        self, baseline: Image.Image, neural: Image.Image, strength: float
    ) -> Image.Image:
        """Compose neural detail at the exact requested size, then finish by strength."""
        return await asyncio.to_thread(self._blend_neural_result_sync, baseline, neural, strength)

    def _blend_neural_result_sync(
        self, baseline: Image.Image, neural: Image.Image, strength: float
    ) -> Image.Image:
        level = min(max(float(strength), 0.0), 1.0)
        if baseline.size != neural.size:
            neural = neural.resize(baseline.size, Image.Resampling.LANCZOS)
        if level <= 0:
            return baseline
        neural_weight = self._neural_blend_weight(level)
        composed = neural if neural_weight >= 1 else Image.blend(baseline, neural, neural_weight)
        return self._enhance_sync(composed, level)

    @staticmethod
    def _neural_blend_weight(level: float) -> float:
        """Give the useful part of the slider more visible response than a linear blend."""
        if level <= FAST_ENHANCE_LEVEL:
            return 0.0
        progress = (level - FAST_ENHANCE_LEVEL) / (1.0 - FAST_ENHANCE_LEVEL)
        return min(max(progress, 0.0), 1.0) ** 0.65

    async def prepare_neural_input(
        self,
        image: Image.Image,
        baseline: Image.Image,
        model_scale: int,
        strength: float,
    ) -> Image.Image:
        """Increase neural source detail with strength while bounding peak memory."""
        return await asyncio.to_thread(
            self._prepare_neural_input_sync, image, baseline, model_scale, strength
        )

    def _prepare_neural_input_sync(
        self,
        image: Image.Image,
        baseline: Image.Image,
        model_scale: int,
        strength: float,
    ) -> Image.Image:
        scale = max(int(model_scale), 1)
        level = min(max(float(strength), FAST_ENHANCE_LEVEL), 1.0)
        minimum_ratio = min(
            1.0,
            max(1, baseline.width // scale) / image.width,
            max(1, baseline.height // scale) / image.height,
        )
        safe_model_dimension = max(1, self.encoding.max_output_dimension // scale)
        pixel_ratio = (MAX_NEURAL_INPUT_PIXELS / max(image.width * image.height, 1)) ** 0.5
        maximum_ratio = min(
            1.0,
            safe_model_dimension / image.width,
            safe_model_dimension / image.height,
            pixel_ratio,
        )
        minimum_ratio = min(minimum_ratio, maximum_ratio)
        progress = (level - FAST_ENHANCE_LEVEL) / (1.0 - FAST_ENHANCE_LEVEL)
        compute_progress = min(max(progress, 0.0), 1.0) ** 1.8
        target_ratio = minimum_ratio + ((maximum_ratio - minimum_ratio) * compute_progress)
        target_size = (
            max(1, min(image.width, int(image.width * target_ratio))),
            max(1, min(image.height, int(image.height * target_ratio))),
        )
        if target_size == image.size:
            return image
        return image.resize(target_size, Image.Resampling.LANCZOS)

    async def fit_for_model_scale(
        self, image: Image.Image, scale: int, max_output_width: int | None = None, max_output_height: int | None = None
    ) -> Image.Image:
        """Bound source dimensions so the encoded result fits the WebP format."""
        maximum_source_width = min(max_output_width or self.encoding.max_output_dimension, self.encoding.max_output_dimension) // scale
        maximum_source_height = min(max_output_height or self.encoding.max_output_dimension, self.encoding.max_output_dimension) // scale
        if image.width <= maximum_source_width and image.height <= maximum_source_height:
            return image
        fitted = image.copy()
        fitted.thumbnail((maximum_source_width, maximum_source_height), Image.Resampling.LANCZOS)
        return fitted

    def output_scale_for_bounds(
        self, image: Image.Image, max_output_width: int | None = None, max_output_height: int | None = None
    ) -> float:
        """Return the scale needed to fit an image inside the requested output bounds."""
        maximum_width = min(max_output_width or self.encoding.max_output_dimension, self.encoding.max_output_dimension)
        maximum_height = min(max_output_height or self.encoding.max_output_dimension, self.encoding.max_output_dimension)
        if image.width <= 0 or image.height <= 0:
            return 1.0
        return min(maximum_width / image.width, maximum_height / image.height)

    async def resize_for_output(
        self, image: Image.Image, max_output_width: int | None = None, max_output_height: int | None = None
    ) -> Image.Image:
        """Resize directly to the requested bounds without neural inference."""
        return await asyncio.to_thread(
            self._resize_for_output_sync, image, max_output_width, max_output_height
        )

    def _resize_for_output_sync(
        self, image: Image.Image, max_output_width: int | None, max_output_height: int | None
    ) -> Image.Image:
        maximum_width = min(max_output_width or self.encoding.max_output_dimension, self.encoding.max_output_dimension)
        maximum_height = min(max_output_height or self.encoding.max_output_dimension, self.encoding.max_output_dimension)
        scale = self.output_scale_for_bounds(image, maximum_width, maximum_height)
        target_size = (
            max(1, round(image.width * scale)),
            max(1, round(image.height * scale)),
        )
        if target_size == image.size:
            return image
        return image.resize(target_size, Image.Resampling.LANCZOS)

    def _enhance_sync(self, image: Image.Image, level: float) -> Image.Image:
        level = min(max(float(level), 0.0), 1.0)
        if level == 0:
            return image
        result = image
        high_strength = min(max((level - 0.55) / 0.45, 0.0), 1.0)
        denoise_mix = self.enhancement.denoise * (level ** 2)
        if denoise_mix >= 0.06:
            result = Image.blend(result, result.filter(ImageFilter.MedianFilter(size=3)), denoise_mix)
        sharpness = 1 + (self.enhancement.sharpness - 1) * level + (1.8 * high_strength ** 2)
        contrast = 1 + (self.enhancement.contrast - 1) * level + (0.22 * high_strength ** 2)
        color = 1 + (self.enhancement.color - 1) * level
        if abs(contrast - 1) >= 0.01:
            result = ImageEnhance.Contrast(result).enhance(contrast)
        if abs(color - 1) >= 0.01:
            result = ImageEnhance.Color(result).enhance(color)
        if abs(sharpness - 1) >= 0.01:
            result = ImageEnhance.Sharpness(result).enhance(sharpness)
        if level > FAST_ENHANCE_LEVEL:
            result = result.filter(ImageFilter.UnsharpMask(
                radius=0.6 + (1.4 * level),
                percent=round(20 + (180 * level ** 2) + (220 * high_strength ** 2)),
                threshold=max(0, round(4 * (1 - level))),
            ))
        return result

    async def infer_tiled(
        self,
        image: Image.Image,
        model: LoadedModel,
        tile_size: int,
        overlap: int,
        batch_size: int,
        cancellation_check: Callable[[], bool] | None = None,
        trace_context: dict[str, object] | None = None,
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
            trace_context,
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

    def _encode_webp_sync(
        self, image: Image.Image, quality: int | None = None, fast: bool = False
    ) -> bytes:
        """Encode an image using configured WebP settings."""
        output = io.BytesIO()
        image.save(
            output,
            format=self.encoding.format,
            quality=quality if quality is not None else self.encoding.quality,
            lossless=self.encoding.lossless,
            method=0 if fast else self.encoding.method,
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
        trace_context: dict[str, object] | None = None,
    ) -> tuple[Image.Image, float]:
        """Run synchronous tile inference and merge tile outputs."""
        started = time.perf_counter()
        try:
            source = np.asarray(image, dtype=np.float32) / 255.0
            height, width, _ = source.shape
            scale = model.scale
            output = np.zeros((height * scale, width * scale, 3), dtype=np.float32)
            weights = np.zeros((height * scale, width * scale, 1), dtype=np.float32)

            tiles = list(self._tiles(width, height, tile_size, overlap))
            stride = max(tile_size - (overlap * 2), 1)
            self._emit_pipeline_trace(
                trace_context,
                "backend.pipeline.tile_plan.created",
                "tile_plan",
                "created",
                metadata={
                    "input_width": width,
                    "input_height": height,
                    "tile_size": tile_size,
                    "overlap": overlap,
                    "stride": stride,
                    "tile_count": len(tiles),
                    "provider": model.provider,
                    "scale": scale,
                },
            )
            self._emit_pipeline_trace(
                trace_context,
                "backend.pipeline.inference.started",
                "inference",
                "running",
                metadata={"model": model.name, "provider": model.provider, "tile_count": len(tiles)},
            )
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

            self._emit_pipeline_trace(
                trace_context,
                "backend.pipeline.inference.completed",
                "inference",
                "completed",
                duration_ms=duration_ms(started),
                metadata={"model": model.name, "provider": model.provider, "gpu_ms": round(gpu_time_ms, 3)},
            )
            output /= np.maximum(weights, 1.0)
            output = np.clip(output * 255.0, 0, 255).astype(np.uint8)
            self._emit_pipeline_trace(
                trace_context,
                "backend.pipeline.merge.completed",
                "merge",
                "completed",
                duration_ms=duration_ms(started),
                metadata={"output_width": width * scale, "output_height": height * scale},
            )
            return Image.fromarray(output), round(gpu_time_ms, 3)
        except InterruptedError as exc:
            self._emit_pipeline_trace(
                trace_context,
                "backend.pipeline.cancelled",
                "inference",
                "cancelled",
                duration_ms=duration_ms(started),
                error_code="JOB_CANCELLED",
                exception_type=type(exc).__name__,
                message=str(exc),
            )
            raise
        except Exception as exc:
            self._emit_pipeline_trace(
                trace_context,
                "backend.pipeline.failed",
                "inference",
                "failed",
                duration_ms=duration_ms(started),
                error_code="MODEL_INFERENCE_FAILED",
                exception_type=type(exc).__name__,
                message=str(exc),
            )
            raise

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

    def _emit_pipeline_trace(
        self,
        trace_context: dict[str, object] | None,
        event: str,
        stage: str,
        status: str,
        duration_ms: float | None = None,
        error_code: str | None = None,
        exception_type: str | None = None,
        message: str | None = None,
        metadata: dict[str, object] | None = None,
    ) -> None:
        if not trace_context:
            return
        emit_trace_event(
            event=event,
            trace_id=str(trace_context.get("trace_id") or ""),
            component="image_pipeline",
            stage=stage,
            status=status,
            attempt=int(trace_context.get("attempt") or 1),
            duration_ms=duration_ms,
            operation_id=trace_context.get("operation_id"),  # type: ignore[arg-type]
            queue_key=trace_context.get("queue_key"),  # type: ignore[arg-type]
            backend_job_id=trace_context.get("backend_job_id"),  # type: ignore[arg-type]
            source_fingerprint=trace_context.get("source_fingerprint"),  # type: ignore[arg-type]
            error_code=error_code,
            exception_type=exception_type,
            message=message,
            metadata=metadata,
        )
