"""Objective comparison metrics for enhanced image verification."""

import numpy as np
from PIL import Image, ImageFilter


class QualityAnalyzer:
    """Compare neural output with a conventional bicubic upscale baseline."""

    def analyze(self, source: Image.Image, enhanced: Image.Image) -> dict[str, float]:
        baseline = source.resize(enhanced.size, Image.Resampling.BICUBIC)
        max_size = (768, 768)
        baseline.thumbnail(max_size, Image.Resampling.LANCZOS)
        sample = enhanced.copy()
        sample.thumbnail(max_size, Image.Resampling.LANCZOS)
        if sample.size != baseline.size:
            sample = sample.resize(baseline.size, Image.Resampling.LANCZOS)

        baseline_array = np.asarray(baseline.convert("RGB"), dtype=np.float32)
        enhanced_array = np.asarray(sample.convert("RGB"), dtype=np.float32)
        difference = np.abs(enhanced_array - baseline_array)
        baseline_sharpness = self._sharpness(baseline)
        enhanced_sharpness = self._sharpness(sample)
        return {
            "pixelDifferencePercent": round(float(np.mean(difference) / 255 * 100), 3),
            "changedPixelPercent": round(float(np.mean(np.max(difference, axis=2) >= 3) * 100), 3),
            "bicubicSharpness": round(baseline_sharpness, 3),
            "enhancedSharpness": round(enhanced_sharpness, 3),
            "sharpnessGain": round(enhanced_sharpness / max(baseline_sharpness, 0.001), 3),
            "originalContrast": round(float(np.std(np.asarray(source.convert("L"), dtype=np.float32))), 3),
            "enhancedContrast": round(float(np.std(np.asarray(sample.convert("L"), dtype=np.float32))), 3),
        }

    def _sharpness(self, image: Image.Image) -> float:
        edges = np.asarray(image.convert("L").filter(ImageFilter.FIND_EDGES), dtype=np.float32)
        return float(np.mean(edges[2:-2, 2:-2] ** 2)) if min(edges.shape) > 4 else float(np.mean(edges**2))
