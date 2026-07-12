"""Quality verification metric tests."""

import numpy as np
from PIL import Image, ImageEnhance

from app.services.quality import QualityAnalyzer


def test_quality_analyzer_detects_a_changed_image() -> None:
    pixels = np.random.default_rng(9).integers(0, 256, (32, 32, 3), dtype=np.uint8)
    source = Image.fromarray(pixels)
    baseline_size = (128, 128)
    changed = ImageEnhance.Contrast(source.resize(baseline_size)).enhance(1.4)
    quality = QualityAnalyzer().analyze(source, changed)
    assert quality["changedPixelPercent"] > 0
    assert quality["pixelDifferencePercent"] > 0
