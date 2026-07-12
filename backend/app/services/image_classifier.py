"""Fast deterministic classifier used by Universal Auto Mode."""

from dataclasses import dataclass

import numpy as np
from PIL import Image

from app.core.config import AutoDetectionConfig


@dataclass(frozen=True)
class ClassificationResult:
    mode: str
    confidence: float
    metrics: dict[str, float]


class ImageTypeClassifier:
    """Classify manga, artwork, or photo without another heavyweight model."""

    def __init__(self, config: AutoDetectionConfig) -> None:
        self.config = config

    def classify(self, image: Image.Image) -> ClassificationResult:
        aspect_ratio = max(image.height / max(image.width, 1), image.width / max(image.height, 1))
        sample = image.copy()
        sample.thumbnail((self.config.sample_size, self.config.sample_size), Image.Resampling.BILINEAR)
        pixels = np.asarray(sample.convert("RGB"), dtype=np.float32) / 255.0
        channel_spread = pixels.max(axis=2) - pixels.min(axis=2)
        grayscale_ratio = float(np.mean(channel_spread <= self.config.grayscale_threshold))
        saturation = float(np.mean(channel_spread))

        luminance = np.mean(pixels, axis=2)
        horizontal = np.abs(np.diff(luminance, axis=1))
        vertical = np.abs(np.diff(luminance, axis=0))
        edge_density = float((np.mean(horizontal > 0.12) + np.mean(vertical > 0.12)) / 2)

        quantized = (pixels * 15).astype(np.uint8).reshape(-1, 3)
        palette_capacity = min(len(quantized), 16**3)
        palette_ratio = min(float(len(np.unique(quantized, axis=0)) / max(palette_capacity, 1)), 1.0)
        metrics = {
            "grayscaleRatio": round(grayscale_ratio, 4),
            "saturation": round(saturation, 4),
            "edgeDensity": round(edge_density, 4),
            "paletteRatio": round(palette_ratio, 4),
            "aspectRatio": round(aspect_ratio, 4),
        }

        if grayscale_ratio >= self.config.manga_grayscale_ratio:
            confidence = 0.5 + 0.5 * grayscale_ratio
            return ClassificationResult("manga", round(confidence, 4), metrics)
        if palette_ratio <= self.config.artwork_palette_ratio or aspect_ratio >= self.config.artwork_tall_aspect_ratio:
            palette_score = max(0.0, 1 - palette_ratio / max(self.config.artwork_palette_ratio, 0.001))
            saturation_score = min(saturation / max(self.config.artwork_saturation, 0.001), 1.0)
            return ClassificationResult("artwork", round(0.5 + 0.25 * max(palette_score, saturation_score), 4), metrics)
        return ClassificationResult("photo", round(0.55 + 0.2 * min(palette_ratio, 1.0), 4), metrics)
