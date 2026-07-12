"""Tiled image inference tests without a real ONNX model."""

import numpy as np
import threading
from PIL import Image

from app.core.config import EncodingConfig, EnhancementConfig
from app.services.image_pipeline import ImagePipeline
from app.services.model_manager import LoadedModel


class IdentitySession:
    """Minimal ONNX Runtime session compatible test double."""

    def run(self, output_names, inputs):
        return [next(iter(inputs.values()))]


def fake_model() -> LoadedModel:
    return LoadedModel(
        name="identity",
        path=None,  # type: ignore[arg-type]
        scale=1,
        session=IdentitySession(),  # type: ignore[arg-type]
        input_name="input",
        output_name="output",
        mtime=0,
        provider="CPUExecutionProvider",
        run_lock=threading.Lock(),
    )


def test_overlapping_tiles_merge_without_gaps() -> None:
    pixels = np.random.default_rng(7).integers(0, 256, (333, 601, 3), dtype=np.uint8)
    source = Image.fromarray(pixels)
    pipeline = ImagePipeline(
        EncodingConfig(format="WEBP", quality=95, lossless=False, method=6),
        EnhancementConfig(defaultLevel=0.35, sharpness=1.35, contrast=1.08, color=1.0, denoise=0.12),
    )

    result, _ = pipeline._infer_tiled_sync(source, fake_model(), tile_size=256, overlap=32, batch_size=3)

    actual = np.asarray(result)
    assert actual.shape == pixels.shape
    assert np.max(np.abs(actual.astype(np.int16) - pixels.astype(np.int16))) <= 1


def test_enhancement_level_zero_is_identity() -> None:
    pixels = np.full((8, 8, 3), 127, dtype=np.uint8)
    source = Image.fromarray(pixels)
    pipeline = ImagePipeline(
        EncodingConfig(format="WEBP", quality=95, lossless=False, method=6),
        EnhancementConfig(defaultLevel=0.35, sharpness=1.35, contrast=1.08, color=1.0, denoise=0.12),
    )
    assert pipeline._enhance_sync(source, 0) is source
