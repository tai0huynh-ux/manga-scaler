"""Tiled image inference tests without a real ONNX model."""

import numpy as np
from PIL import Image

from app.core.config import EncodingConfig
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
    )


def test_overlapping_tiles_merge_without_gaps() -> None:
    pixels = np.random.default_rng(7).integers(0, 256, (333, 601, 3), dtype=np.uint8)
    source = Image.fromarray(pixels)
    pipeline = ImagePipeline(EncodingConfig(format="WEBP", quality=95, lossless=False, method=6))

    result, _ = pipeline._infer_tiled_sync(source, fake_model(), tile_size=256, overlap=32, batch_size=3)

    actual = np.asarray(result)
    assert actual.shape == pixels.shape
    assert np.max(np.abs(actual.astype(np.int16) - pixels.astype(np.int16))) <= 1
