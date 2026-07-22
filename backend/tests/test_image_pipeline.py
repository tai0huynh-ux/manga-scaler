"""Tiled image inference tests without a real ONNX model."""

import asyncio
import json
import threading

import numpy as np
from app.core.config import EncodingConfig, EnhancementConfig, TraceConfig
from app.core.tracing import configure_tracing
from app.services import upscaler as upscaler_module
from app.services.image_pipeline import MAX_NEURAL_INPUT_PIXELS, ImagePipeline
from app.services.model_manager import LoadedModel
from PIL import Image


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
        fixed_tile_size=None,
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


def test_fast_webp_encoding_uses_minimum_effort_without_changing_quality() -> None:
    calls = []

    class SaveRecorder:
        def save(self, _output, **kwargs):
            calls.append(kwargs)

    pipeline = ImagePipeline(
        EncodingConfig(format="WEBP", quality=95, lossless=False, method=6),
        EnhancementConfig(defaultLevel=0.35, sharpness=1.35, contrast=1.08, color=1.0, denoise=0.12),
    )

    pipeline._encode_webp_sync(SaveRecorder(), quality=90, fast=True)  # type: ignore[arg-type]

    assert calls == [{"format": "WEBP", "quality": 90, "lossless": False, "method": 0}]


def test_neural_composition_keeps_target_geometry_and_makes_full_strength_aggressive() -> None:
    pipeline = ImagePipeline(
        EncodingConfig(format="WEBP", quality=95, lossless=False, method=6),
        EnhancementConfig(defaultLevel=0.35, sharpness=1.35, contrast=1.08, color=1.0, denoise=0.12),
    )
    grid = np.indices((64, 64)).sum(axis=0) % 2
    baseline_pixels = np.repeat((grid * 96 + 72)[:, :, None], 3, axis=2).astype(np.uint8)
    neural_pixels = np.repeat((255 - grid * 180)[:, :, None], 3, axis=2).astype(np.uint8)
    baseline = Image.fromarray(baseline_pixels)
    neural = Image.fromarray(neural_pixels).resize((128, 128), Image.Resampling.NEAREST)

    low = pipeline._enhance_sync(baseline, 0.05)
    medium = pipeline._blend_neural_result_sync(baseline, neural, 0.5)
    full = pipeline._blend_neural_result_sync(baseline, neural, 1.0)
    low_difference = np.abs(np.asarray(low, dtype=np.int16) - baseline_pixels).mean()
    medium_difference = np.abs(np.asarray(medium, dtype=np.int16) - baseline_pixels).mean()
    full_difference = np.abs(np.asarray(full, dtype=np.int16) - baseline_pixels).mean()

    assert medium.size == baseline.size
    assert full.size == baseline.size
    assert low_difference < 2
    assert medium_difference > low_difference * 5
    assert full_difference > medium_difference * 1.25


def test_five_percent_uses_fast_resize_path_even_for_4k_target() -> None:
    source = Image.new("RGB", (800, 1741))
    pipeline = ImagePipeline(
        EncodingConfig(format="WEBP", quality=90, lossless=False, method=4),
        EnhancementConfig(defaultLevel=0.35, sharpness=1.35, contrast=1.08, color=1.0, denoise=0.12),
    )

    assert pipeline.output_scale_for_bounds(source, 2160, 3840) > 1.5
    assert upscaler_module.is_resize_only_output(0.05) is True


def test_strength_above_fast_threshold_uses_neural_path_for_non_4k_output() -> None:
    source = Image.new("RGB", (800, 1741))
    pipeline = ImagePipeline(
        EncodingConfig(format="WEBP", quality=90, lossless=False, method=4),
        EnhancementConfig(defaultLevel=0.35, sharpness=1.35, contrast=1.08, color=1.0, denoise=0.12),
    )

    assert pipeline.output_scale_for_bounds(source, 884, 1920) <= 1.5
    assert upscaler_module.is_resize_only_output(0.1) is True
    assert upscaler_module.is_resize_only_output(0.15) is False
    assert upscaler_module.is_resize_only_output(1.0) is False


def test_neural_input_compute_increases_monotonically_with_strength() -> None:
    source = Image.new("RGB", (800, 1741))
    baseline = Image.new("RGB", (884, 1920))
    pipeline = ImagePipeline(
        EncodingConfig(format="WEBP", quality=90, lossless=False, method=4),
        EnhancementConfig(defaultLevel=0.35, sharpness=1.35, contrast=1.08, color=1.0, denoise=0.12),
    )

    low = pipeline._prepare_neural_input_sync(source, baseline, 4, 0.15)
    medium = pipeline._prepare_neural_input_sync(source, baseline, 4, 0.5)
    full = pipeline._prepare_neural_input_sync(source, baseline, 4, 1.0)

    assert low.width * low.height < medium.width * medium.height < full.width * full.height
    assert full.width * full.height <= MAX_NEURAL_INPUT_PIXELS
    assert full.width > 2 * low.width
    assert full.height > 2 * low.height


def test_neural_input_pixel_cap_holds_when_requested_target_is_extreme() -> None:
    source = Image.new("RGB", (2048, 8192))
    baseline = Image.new("RGB", source.size)
    pipeline = ImagePipeline(
        EncodingConfig(format="WEBP", quality=90, lossless=False, method=4),
        EnhancementConfig(defaultLevel=0.35, sharpness=1.35, contrast=1.08, color=1.0, denoise=0.12),
    )

    prepared = pipeline._prepare_neural_input_sync(source, baseline, 4, 1.0)

    assert prepared.width * prepared.height <= MAX_NEURAL_INPUT_PIXELS


def test_fit_for_model_scale_respects_independent_output_bounds() -> None:
    source = Image.new("RGB", (1600, 2400))
    pipeline = ImagePipeline(
        EncodingConfig(format="WEBP", quality=90, lossless=False, method=4),
        EnhancementConfig(defaultLevel=0.35, sharpness=1.35, contrast=1.08, color=1.0, denoise=0.12),
    )
    fitted = asyncio.run(pipeline.fit_for_model_scale(source, 4, 1920, 1080))
    assert fitted.width * 4 <= 1920
    assert fitted.height * 4 <= 1080
    assert fitted.width / fitted.height == source.width / source.height


def test_resize_for_output_preserves_portrait_geometry_without_neural_downsampling() -> None:
    source = Image.new("RGB", (800, 1583))
    pipeline = ImagePipeline(
        EncodingConfig(format="WEBP", quality=90, lossless=False, method=4),
        EnhancementConfig(defaultLevel=0.35, sharpness=1.35, contrast=1.08, color=1.0, denoise=0.12),
    )

    assert round(pipeline.output_scale_for_bounds(source, 1920, 1080), 3) == 0.682
    resized = asyncio.run(pipeline.resize_for_output(source, 1920, 1080))

    assert resized.size == (546, 1080)
    assert abs((resized.width / resized.height) - (source.width / source.height)) < 0.001


def test_tile_plan_trace_summary_is_emitted_once(tmp_path) -> None:
    configure_tracing(TraceConfig(enabled=True, file="trace.jsonl", includeStack=True), tmp_path)
    source = Image.new("RGB", (300, 300), color=(1, 2, 3))
    pipeline = ImagePipeline(
        EncodingConfig(format="WEBP", quality=95, lossless=False, method=6),
        EnhancementConfig(defaultLevel=0.35, sharpness=1.35, contrast=1.08, color=1.0, denoise=0.12),
    )

    result, _ = pipeline._infer_tiled_sync(
        source,
        fake_model(),
        tile_size=256,
        overlap=32,
        batch_size=2,
        trace_context={"trace_id": "trace-pipeline", "attempt": 1},
    )

    events = [json.loads(line) for line in (tmp_path / "trace.jsonl").read_text(encoding="utf-8").splitlines()]
    tile_events = [event for event in events if event["event"] == "backend.pipeline.tile_plan.created"]
    assert result.size == source.size
    assert len(tile_events) == 1
    assert tile_events[0]["metadata"]["input_width"] == 300
    assert tile_events[0]["metadata"]["input_height"] == 300
    assert tile_events[0]["metadata"]["tile_count"] == 4
    assert any(event["event"] == "backend.pipeline.inference.completed" and event["duration_ms"] >= 0 for event in events)


def test_pipeline_cancellation_is_not_failed_trace(tmp_path) -> None:
    configure_tracing(TraceConfig(enabled=True, file="trace.jsonl", includeStack=True), tmp_path)
    source = Image.new("RGB", (300, 300), color=(1, 2, 3))
    pipeline = ImagePipeline(
        EncodingConfig(format="WEBP", quality=95, lossless=False, method=6),
        EnhancementConfig(defaultLevel=0.35, sharpness=1.35, contrast=1.08, color=1.0, denoise=0.12),
    )

    try:
        pipeline._infer_tiled_sync(
            source,
            fake_model(),
            tile_size=256,
            overlap=32,
            batch_size=2,
            cancellation_check=lambda: True,
            trace_context={"trace_id": "trace-cancel", "attempt": 1},
        )
    except InterruptedError:
        pass

    events = [json.loads(line) for line in (tmp_path / "trace.jsonl").read_text(encoding="utf-8").splitlines()]
    assert "backend.pipeline.cancelled" in [event["event"] for event in events]
    assert "backend.pipeline.failed" not in [event["event"] for event in events]
