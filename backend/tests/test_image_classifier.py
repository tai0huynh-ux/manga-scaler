"""Universal Auto Mode classification tests."""

import numpy as np
from PIL import Image

from app.core.config import AutoDetectionConfig
from app.services.image_classifier import ImageTypeClassifier


def classifier() -> ImageTypeClassifier:
    return ImageTypeClassifier(
        AutoDetectionConfig(
            sampleSize=256,
            grayscaleThreshold=0.055,
            mangaGrayscaleRatio=0.9,
            artworkPaletteRatio=0.12,
            artworkTallAspectRatio=1.4,
            artworkSaturation=0.2,
        )
    )


def test_grayscale_line_art_is_manga() -> None:
    pixels = np.full((64, 64, 3), 255, dtype=np.uint8)
    pixels[::8, :, :] = 0
    result = classifier().classify(Image.fromarray(pixels))
    assert result.mode == "manga"
    assert result.metrics["grayscaleRatio"] == 1.0


def test_flat_saturated_color_is_artwork() -> None:
    pixels = np.zeros((64, 64, 3), dtype=np.uint8)
    pixels[:, :32] = (255, 20, 40)
    pixels[:, 32:] = (20, 80, 255)
    result = classifier().classify(Image.fromarray(pixels))
    assert result.mode == "artwork"


def test_complex_natural_color_distribution_is_photo() -> None:
    rng = np.random.default_rng(42)
    pixels = rng.integers(40, 216, (128, 128, 3), dtype=np.uint8)
    result = classifier().classify(Image.fromarray(pixels))
    assert result.mode == "photo"
    assert result.metrics["paletteRatio"] > 0.12


def test_tall_colored_webtoon_is_artwork() -> None:
    rng = np.random.default_rng(7)
    pixels = rng.integers(20, 236, (256, 96, 3), dtype=np.uint8)
    result = classifier().classify(Image.fromarray(pixels))
    assert result.mode == "artwork"
    assert result.metrics["aspectRatio"] >= 1.4
