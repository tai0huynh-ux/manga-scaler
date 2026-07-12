"""Pillow and NumPy image processing pipeline for tiled ONNX inference."""

import asyncio
import io
import time
from dataclasses import dataclass

import numpy as np
from PIL import Image

from app.core.config import EncodingConfig
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

    def __init__(self, encoding: EncodingConfig) -> None:
        self.encoding = encoding

    async def decode(self, image_bytes: bytes) -> Image.Image:
        """Decode image bytes and convert to RGB."""
        return await asyncio.to_thread(self._decode_sync, image_bytes)

    async def encode_webp(self, image: Image.Image) -> bytes:
        """Encode an RGB image to WebP bytes."""
        return await asyncio.to_thread(self._encode_webp_sync, image)

    async def infer_tiled(
        self,
        image: Image.Image,
        model: LoadedModel,
        tile_size: int,
        overlap: int,
        batch_size: int,
    ) -> InferenceImage:
        """Run tiled model inference and merge the output tiles."""
        result, gpu_time_ms = await asyncio.to_thread(
            self._infer_tiled_sync,
            image,
            model,
            tile_size,
            overlap,
            batch_size,
        )
        return InferenceImage(image=result, gpu_time_ms=gpu_time_ms)

    def _decode_sync(self, image_bytes: bytes) -> Image.Image:
        """Decode image bytes using Pillow and normalize to RGB."""
        with Image.open(io.BytesIO(image_bytes)) as image:
            image.load()
            return image.convert("RGB")

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
    ) -> tuple[Image.Image, float]:
        """Run synchronous tile inference and merge tile outputs."""
        source = np.asarray(image, dtype=np.float32) / 255.0
        height, width, _ = source.shape
        scale = model.scale
        output = np.zeros((height * scale, width * scale, 3), dtype=np.float32)

        tiles = list(self._tiles(width, height, tile_size, overlap))
        gpu_time_ms = 0.0

        for start in range(0, len(tiles), batch_size):
            batch_specs = tiles[start : start + batch_size]
            batch = np.stack(
                [self._extract_tile(source, spec, tile_size) for spec in batch_specs],
                axis=0,
            )
            batch = np.transpose(batch, (0, 3, 1, 2)).astype(np.float32)

            gpu_started = time.perf_counter()
            prediction = model.session.run([model.output_name], {model.input_name: batch})[0]
            gpu_time_ms += (time.perf_counter() - gpu_started) * 1000

            prediction = np.transpose(prediction, (0, 2, 3, 1))
            for tile_output, spec in zip(prediction, batch_specs, strict=True):
                self._merge_tile(output, tile_output, spec, scale)

        output = np.clip(output * 255.0, 0, 255).astype(np.uint8)
        return Image.fromarray(output, mode="RGB"), round(gpu_time_ms, 3)

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
        tile_output: np.ndarray,
        spec: tuple[int, int, int, int],
        scale: int,
    ) -> None:
        """Copy the valid region of a tile output into the final image."""
        x0, y0, x1, y1 = spec
        out_x0 = x0 * scale
        out_y0 = y0 * scale
        out_x1 = x1 * scale
        out_y1 = y1 * scale
        valid_width = out_x1 - out_x0
        valid_height = out_y1 - out_y0
        output[out_y0:out_y1, out_x0:out_x1, :] = tile_output[:valid_height, :valid_width, :]
