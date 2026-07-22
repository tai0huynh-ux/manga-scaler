"""AI upscaling orchestration service backed by ONNX Runtime."""

import json
import logging
import time
from types import SimpleNamespace

from app.core.config import Settings
from app.core.tracing import duration_ms, emit_trace_event, safe_prefix
from app.core.version import PIPELINE_VERSION
from app.models.schemas import UpscaleResponse
from app.services.cache import ImageCache
from app.services.downloader import ImageDownloader
from app.services.image_classifier import ClassificationResult, ImageTypeClassifier
from app.services.image_pipeline import (
    FAST_ENHANCE_LEVEL,
    EncodedImage,
    ImagePipeline,
    InferenceImage,
)
from app.services.inference_queue import InferenceJob, InferenceQueue
from app.services.model_manager import ModelManager
from app.services.quality import QualityAnalyzer
from app.services.statistics import MemorySampler, StageTimings
from app.services.text_processor import TextProcessingOptions, TextProcessor
from app.utils.hashing import sha256_bytes

LOGGER = logging.getLogger(__name__)
def is_resize_only_output(enhance_level: float) -> bool:
    """Keep 0-10% model-free; higher strengths deliberately use neural detail."""
    return min(max(float(enhance_level), 0.0), 1.0) <= FAST_ENHANCE_LEVEL


class UpscalerService:
    """Coordinates download, cache lookup, queued inference, and API responses."""

    def __init__(
        self,
        settings: Settings,
        cache: ImageCache,
        downloader: ImageDownloader,
        model_manager: ModelManager,
        pipeline: ImagePipeline,
        classifier: ImageTypeClassifier,
        quality_analyzer: QualityAnalyzer,
        text_processor: TextProcessor,
    ) -> None:
        self.settings = settings
        self.cache = cache
        self.downloader = downloader
        self.model_manager = model_manager
        self.pipeline = pipeline
        self.classifier = classifier
        self.quality_analyzer = quality_analyzer
        self.text_processor = text_processor
        self.memory_sampler = MemorySampler()
        self.queue = InferenceQueue(
            max_size=settings.inference.queue_max_size,
            worker_count=settings.inference.worker_count,
            max_concurrent_inferences=settings.inference.max_concurrent_inferences,
            dynamic_batch_window_ms=settings.inference.dynamic_batch_window_ms,
            processor=self._process_job,
        )

    async def start(self) -> None:
        """Start the inference worker pool."""
        await self.queue.start()

    async def stop(self) -> None:
        """Stop the inference worker pool."""
        await self.queue.stop()

    async def upscale(
        self,
        image_url: str,
        model_name: str | None = None,
        tile_size: int | None = None,
        enhance_level: float | None = None,
        mode: str = "auto",
        image_bytes: bytes | None = None,
        client_job_id: str | None = None,
        max_output_width: int | None = None,
        max_output_height: int | None = None,
        output_quality: int | None = None,
        text_processing: TextProcessingOptions | None = None,
        trace_id: str | None = None,
        operation_id: str | None = None,
        queue_key: str | None = None,
        attempt: int = 1,
        source_fingerprint: str | None = None,
    ) -> UpscaleResponse:
        """Submit an image URL for AI upscaling and wait for the result."""
        result = await self.queue.submit(
            str(image_url), model_name, tile_size, enhance_level, mode, image_bytes, client_job_id,
            max_output_width, max_output_height, output_quality, text_processing, trace_id, operation_id, queue_key,
            attempt, source_fingerprint
        )
        if not isinstance(result, UpscaleResponse):
            raise TypeError("Inference queue returned an invalid response.")
        return result

    def cancel(self, client_job_id: str) -> bool:
        return self.queue.cancel(client_job_id)

    async def _process_job(self, job: InferenceJob) -> UpscaleResponse:
        """Process a queued image through the full inference pipeline."""
        total_started = time.perf_counter()
        timings = StageTimings()
        emit_trace_event(
            event="backend.upscale.started",
            trace_id=job.trace_id,
            component="upscaler",
            stage="upscale",
            status="running",
            attempt=job.attempt,
            operation_id=job.operation_id,
            queue_key=job.queue_key,
            backend_job_id=job.client_job_id,
            source_fingerprint=job.source_fingerprint,
            metadata={"mode": job.mode, "model": job.model_name},
        )
        try:
            self._ensure_active(job)

            download_started = time.perf_counter()
            if job.image_bytes is not None:
                image_content = job.image_bytes
                if not image_content:
                    raise ValueError("Browser-supplied image is empty.")
                if len(image_content) > self.settings.download.max_bytes:
                    raise ValueError("Browser-supplied image exceeds the configured size limit.")
            else:
                downloaded = await self.downloader.download(job.image_url)
                image_content = downloaded.content
            timings.set("download", download_started)
            self._ensure_active(job)

            source_key = sha256_bytes(image_content)
            if not job.source_fingerprint:
                job.source_fingerprint = source_key
            decode_started = time.perf_counter()
            image = await self.pipeline.decode(image_content)
            self._ensure_active(job)
            timings.set("decode", decode_started)
            emit_trace_event(
                event="backend.upscale.input.decoded",
                trace_id=job.trace_id,
                component="upscaler",
                stage="decode",
                status="completed",
                attempt=job.attempt,
                duration_ms=timings.values.get("decode"),
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                metadata={"input_width": image.width, "input_height": image.height},
            )
            original_path = self.settings.cache_dir / f"{source_key}-original.png"
            if not original_path.exists():
                input_cache_started = time.perf_counter()
                original_png = await self._original_cache_bytes(image_content, image)
                original_path, _ = await self.cache.save_named(f"{source_key}-original", original_png, ".png")
                timings.set("input_cache", input_cache_started)
                emit_trace_event(
                    event="backend.upscale.input.saved",
                    trace_id=job.trace_id,
                    component="cache",
                    stage="input_cache",
                    status="completed",
                    attempt=job.attempt,
                    operation_id=job.operation_id,
                    queue_key=job.queue_key,
                    backend_job_id=job.client_job_id,
                    source_fingerprint=job.source_fingerprint,
                    cache_key=f"{source_key}-original",
                    duration_ms=timings.values.get("input_cache"),
                )

            text_options = TextProcessingOptions.from_payload(getattr(job, "text_processing", None))
            text_metadata: dict[str, object] = {}
            if text_options.enabled:
                text_started = time.perf_counter()
                text_result = await self.text_processor.process(image, text_options)
                self._ensure_active(job)
                image = text_result.image
                text_metadata = text_result.metadata()
                timings.set("text", text_started)

            classification = self._resolve_mode(job.mode, image)
            profile = self.settings.modes[classification.mode]
            enhance_level = profile.enhance_level if job.enhance_level is None else job.enhance_level
            output_scale = self.pipeline.output_scale_for_bounds(
                image, job.max_output_width, job.max_output_height
            )
            resize_only = is_resize_only_output(enhance_level)
            model_started = time.perf_counter()
            model = (
                SimpleNamespace(name="lanczos", provider="Pillow", scale=1, fixed_tile_size=None)
                if resize_only
                else self.model_manager.get_model(job.model_name or profile.model)
            )
            emit_trace_event(
                event="backend.upscale.model.resolved",
                trace_id=job.trace_id,
                component="upscaler",
                stage="model",
                status="completed",
                attempt=job.attempt,
                duration_ms=duration_ms(model_started),
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                metadata={
                    "mode": classification.mode,
                    "model": model.name,
                    "provider": model.provider,
                    "resize_only": resize_only,
                    "requested_output_scale": round(output_scale, 3),
                },
            )
            output_baseline = await self.pipeline.resize_for_output(
                image, job.max_output_width, job.max_output_height
            )
            inference_image = output_baseline if resize_only else await self.pipeline.prepare_neural_input(
                image, output_baseline, model.scale, enhance_level
            )
            neural_baseline = None if resize_only else output_baseline
            requested_tile_size = None if resize_only else self._resolve_tile_size(job.tile_size)
            tile_size = None if resize_only else (model.fixed_tile_size or requested_tile_size)
            overlap = 0 if resize_only else min(self.settings.inference.tile_overlap, max(tile_size // 8, 1))
            enhancement_key = round(enhance_level, 3)
            output_quality = job.output_quality or self.settings.encoding.quality
            output_width = job.max_output_width or self.settings.encoding.max_output_dimension
            output_height = job.max_output_height or self.settings.encoding.max_output_dimension
            tile_key = tile_size if tile_size is not None else "resize"
            output_key = (
                f"{source_key}-p{PIPELINE_VERSION}-{classification.mode}-{model.name}-x{model.scale}-t{tile_key}-e{enhancement_key}"
                f"-w{output_width}-h{output_height}-q{output_quality}-text{self._text_key(text_options)}-webp"
            )

            final_path = self.settings.cache_dir / f"{output_key}.webp"
            quality_path = self.settings.cache_dir / f"{output_key}-quality.json"
            if final_path.exists():
                emit_trace_event(
                    event="backend.upscale.cache.hit",
                    trace_id=job.trace_id,
                    component="cache",
                    stage="output_cache",
                    status="cache_hit",
                    attempt=job.attempt,
                    operation_id=job.operation_id,
                    queue_key=job.queue_key,
                    backend_job_id=job.client_job_id,
                    source_fingerprint=job.source_fingerprint,
                    cache_key=output_key,
                    metadata={"cache_key_prefix": safe_prefix(output_key), "mode": classification.mode},
                )
                cached_bytes = final_path.read_bytes()
                cached = await self.pipeline.decode(cached_bytes)
                quality_loaded = False
                if quality_path.exists():
                    try:
                        quality = json.loads(quality_path.read_text(encoding="utf-8"))
                        quality_loaded = True
                    except (OSError, json.JSONDecodeError):
                        quality = self.quality_analyzer.analyze(image, cached)
                else:
                    quality = self.quality_analyzer.analyze(image, cached)
                if not quality_loaded:
                    await self.cache.save_named(
                        f"{output_key}-quality",
                        json.dumps(quality, separators=(",", ":")).encode("utf-8"),
                        ".json",
                    )
                timings.total_since(total_started)
                emit_trace_event(
                    event="backend.upscale.completed",
                    trace_id=job.trace_id,
                    component="upscaler",
                    stage="upscale",
                    status="completed",
                    attempt=job.attempt,
                    duration_ms=timings.values.get("total"),
                    operation_id=job.operation_id,
                    queue_key=job.queue_key,
                    backend_job_id=job.client_job_id,
                    source_fingerprint=job.source_fingerprint,
                    cache_key=output_key,
                    metadata={"cache_hit": True, "output_width": cached.width, "output_height": cached.height},
                )
                LOGGER.info(
                    "Upscaled image",
                    extra={
                        "_image_url": job.image_url,
                        "_model": model.name,
                        "_provider": model.provider,
                        "_cache_key": output_key,
                        "_cache_hit": True,
                        "_timings": timings.values,
                    },
                )
                return self._response(
                    output=EncodedImage(
                        content=cached_bytes,
                        content_type="image/webp",
                        width=cached.width,
                        height=cached.height,
                        gpu_time_ms=0.0,
                    ),
                    output_path=final_path,
                    cache_key=output_key,
                    cache_hit=True,
                    model_name=model.name,
                    provider=model.provider,
                    scale=model.scale,
                    timings=timings.values,
                    requested_mode=job.mode,
                    classification=classification,
                    tile_size=tile_size,
                    enhance_level=enhance_level,
                    original_path=original_path,
                    quality=quality,
                    text_processing=text_metadata,
                    trace_id=job.trace_id,
                )

            emit_trace_event(
                event="backend.upscale.cache.miss",
                trace_id=job.trace_id,
                component="cache",
                stage="output_cache",
                status="cache_miss",
                attempt=job.attempt,
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                cache_key=output_key,
                metadata={"cache_key_prefix": safe_prefix(output_key), "mode": classification.mode},
            )
            inference_started = time.perf_counter()
            emit_trace_event(
                event="backend.upscale.resize.started" if resize_only else "backend.upscale.inference.started",
                trace_id=job.trace_id,
                component="upscaler",
                stage="inference",
                status="running",
                attempt=job.attempt,
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                metadata={
                    "model": model.name,
                    "provider": model.provider,
                    "tile_size": tile_size,
                    "overlap": overlap,
                    "requested_output_scale": round(output_scale, 3),
                    "neural_input_width": None if resize_only else inference_image.width,
                    "neural_input_height": None if resize_only else inference_image.height,
                },
            )
            if resize_only:
                output = InferenceImage(image=inference_image, gpu_time_ms=0.0)
            else:
                output, model = await self._infer_with_provider_recovery(
                    image=inference_image,
                    model=model,
                    tile_size=tile_size,
                    overlap=overlap,
                    job=job,
                )
            self._ensure_active(job)
            timings.set("inference", inference_started)
            timings.values["gpu"] = output.gpu_time_ms
            emit_trace_event(
                event="backend.upscale.resize.completed" if resize_only else "backend.upscale.inference.completed",
                trace_id=job.trace_id,
                component="upscaler",
                stage="inference",
                status="completed",
                attempt=job.attempt,
                duration_ms=timings.values.get("inference"),
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                metadata={"model": model.name, "provider": model.provider, "gpu_ms": output.gpu_time_ms},
            )

            enhance_started = time.perf_counter()
            enhanced_image = (
                await self.pipeline.enhance(output.image, enhance_level)
                if resize_only
                else await self.pipeline.blend_neural_result(neural_baseline, output.image, enhance_level)
            )
            self._ensure_active(job)
            if profile.preserve_grayscale:
                enhanced_image = enhanced_image.convert("L").convert("RGB")
            timings.set("enhance", enhance_started)

            encode_started = time.perf_counter()
            encoded = await self.pipeline.encode_webp(
                enhanced_image, output_quality, fast=resize_only
            )
            self._ensure_active(job)
            timings.set("encode", encode_started)
            emit_trace_event(
                event="backend.upscale.output.encoded",
                trace_id=job.trace_id,
                component="upscaler",
                stage="encode",
                status="completed",
                attempt=job.attempt,
                duration_ms=timings.values.get("encode"),
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                metadata={"output_width": enhanced_image.width, "output_height": enhanced_image.height},
            )
            output_artifact = EncodedImage(
                content=encoded,
                content_type="image/webp",
                width=enhanced_image.width,
                height=enhanced_image.height,
                gpu_time_ms=output.gpu_time_ms,
            )
            output_path, cache_hit = await self.cache.save_named(output_key, output_artifact.content, ".webp")
            emit_trace_event(
                event="backend.upscale.output.saved",
                trace_id=job.trace_id,
                component="cache",
                stage="output_cache",
                status="completed",
                attempt=job.attempt,
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                cache_key=output_key,
                metadata={"cache_hit": cache_hit},
            )
            quality = self.quality_analyzer.analyze(image, enhanced_image)
            await self.cache.save_named(
                f"{output_key}-quality",
                json.dumps(quality, separators=(",", ":")).encode("utf-8"),
                ".json",
            )
            timings.total_since(total_started)
            emit_trace_event(
                event="backend.upscale.completed",
                trace_id=job.trace_id,
                component="upscaler",
                stage="upscale",
                status="completed",
                attempt=job.attempt,
                duration_ms=timings.values.get("total"),
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                cache_key=output_key,
                metadata={"cache_hit": cache_hit, "output_width": enhanced_image.width, "output_height": enhanced_image.height},
            )

            LOGGER.info(
                "Upscaled image",
                extra={
                    "_image_url": job.image_url,
                    "_model": model.name,
                    "_provider": model.provider,
                    "_cache_key": output_key,
                    "_cache_hit": cache_hit,
                    "_timings": timings.values,
                },
            )
            return self._response(
                output=output_artifact,
                output_path=output_path,
                cache_key=output_key,
                cache_hit=cache_hit,
                model_name=model.name,
                provider=model.provider,
                scale=model.scale,
                timings=timings.values,
                requested_mode=job.mode,
                classification=classification,
                tile_size=tile_size,
                enhance_level=enhance_level,
                original_path=original_path,
                quality=quality,
                text_processing=text_metadata,
                trace_id=job.trace_id,
            )
        except InterruptedError as exc:
            self._emit_upscale_terminal(job, "backend.upscale.cancelled", "cancelled", total_started, "JOB_CANCELLED", exc)
            raise
        except Exception as exc:
            self._emit_upscale_terminal(job, "backend.upscale.failed", "failed", total_started, self._error_code(exc), exc)
            raise

    async def _original_cache_bytes(self, image_content: bytes, image) -> bytes:
        """Keep submitted PNG bytes intact and avoid an expensive lossless re-encode."""
        if image_content.startswith(b"\x89PNG\r\n\x1a\n"):
            return image_content
        return await self.pipeline.encode_png(image)

    def _response(
        self,
        output: EncodedImage,
        output_path,
        cache_key: str,
        cache_hit: bool,
        model_name: str,
        provider: str,
        scale: int,
        timings: dict[str, float],
        requested_mode: str,
        classification: ClassificationResult,
        tile_size: int | None,
        enhance_level: float,
        original_path,
        quality: dict[str, float],
        text_processing: dict[str, object] | None = None,
        trace_id: str | None = None,
    ) -> UpscaleResponse:
        """Build an API response compatible with the existing extension."""
        filename = self.cache.public_filename(output_path)
        image_url = f"{self.settings.app.public_base_url}/cache/images/{filename}"
        original_filename = self.cache.public_filename(original_path)
        original_image_url = f"{self.settings.app.public_base_url}/cache/images/{original_filename}"
        return UpscaleResponse(
            imageUrl=image_url,
            originalImageUrl=original_image_url,
            cacheKey=cache_key,
            cacheHit=cache_hit,
            contentType=output.content_type,
            bytesWritten=len(output.content),
            model=model_name,
            requestedMode=requested_mode,
            detectedMode=classification.mode,
            detectionConfidence=classification.confidence,
            detectionMetrics=classification.metrics,
            provider=provider,
            scale=scale,
            tileSize=tile_size,
            enhanceLevel=enhance_level,
            outputWidth=output.width,
            outputHeight=output.height,
            timings=timings,
            memory=self.memory_sampler.snapshot(),
            queue=self.queue.snapshot(),
            quality=quality,
            textProcessing=text_processing or {},
            traceId=trace_id,
        )

    def _resolve_mode(self, requested_mode: str, image) -> ClassificationResult:
        if requested_mode == "auto":
            return self.classifier.classify(image)
        if requested_mode not in self.settings.modes:
            raise ValueError(f"Unknown enhancement mode: {requested_mode}")
        return ClassificationResult(requested_mode, 1.0, {})

    def _ensure_active(self, job: InferenceJob) -> None:
        if job.cancel_event.is_set() or job.future.cancelled():
            raise InterruptedError("Inference job was cancelled by the browser.")

    def _resolve_tile_size(self, requested_tile_size: int | None) -> int:
        """Validate and return the effective tile size."""
        tile_size = requested_tile_size or self.settings.inference.tile_size
        if tile_size not in self.settings.inference.allowed_tile_sizes:
            allowed = ", ".join(str(size) for size in self.settings.inference.allowed_tile_sizes)
            raise ValueError(f"tileSize must be one of: {allowed}.")
        return tile_size

    async def _infer_with_provider_recovery(self, image, model, tile_size: int, overlap: int, job: InferenceJob):
        """Run tiled inference and recover from DirectML device loss once."""
        try:
            output = await self.pipeline.infer_tiled(
                image=image,
                model=model,
                tile_size=tile_size,
                overlap=overlap,
                batch_size=self.settings.inference.batch_size,
                cancellation_check=job.cancel_event.is_set,
                trace_context=self._trace_context(job),
            )
            return output, model
        except Exception as exc:
            if not self._is_provider_device_lost(exc):
                raise
            emit_trace_event(
                event="backend.upscale.provider.retrying",
                trace_id=job.trace_id,
                component="upscaler",
                stage="provider_recovery",
                status="retrying",
                attempt=job.attempt,
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                error_code="PROVIDER_DEVICE_LOST",
                exception_type=type(exc).__name__,
                message=str(exc),
                metadata={"provider": model.provider, "model": model.name},
            )
            LOGGER.warning(
                "Inference provider failed; reloading model on fallback provider",
                extra={"_provider": model.provider, "_model": model.name, "_error": str(exc)},
            )
            recovered_model = self.model_manager.recover_after_provider_failure(model.provider, model.name)
            recovered_tile_size = recovered_model.fixed_tile_size or tile_size
            recovered_overlap = min(self.settings.inference.tile_overlap, max(recovered_tile_size // 8, 1))
            try:
                output = await self.pipeline.infer_tiled(
                    image=image,
                    model=recovered_model,
                    tile_size=recovered_tile_size,
                    overlap=recovered_overlap,
                    batch_size=1,
                    cancellation_check=job.cancel_event.is_set,
                    trace_context=self._trace_context(job),
                )
            except Exception as recovered_exc:
                emit_trace_event(
                    event="backend.upscale.provider.failed",
                    trace_id=job.trace_id,
                    component="upscaler",
                    stage="provider_recovery",
                    status="failed",
                    attempt=job.attempt,
                    operation_id=job.operation_id,
                    queue_key=job.queue_key,
                    backend_job_id=job.client_job_id,
                    source_fingerprint=job.source_fingerprint,
                    error_code=self._error_code(recovered_exc),
                    exception_type=type(recovered_exc).__name__,
                    message=str(recovered_exc),
                    metadata={"provider": recovered_model.provider, "model": recovered_model.name},
                )
                raise
            emit_trace_event(
                event="backend.upscale.provider.recovered",
                trace_id=job.trace_id,
                component="upscaler",
                stage="provider_recovery",
                status="completed",
                attempt=job.attempt,
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                metadata={
                    "failed_provider": model.provider,
                    "recovered_provider": recovered_model.provider,
                    "model": recovered_model.name,
                },
            )
            return output, recovered_model

    def _emit_upscale_terminal(
        self,
        job: InferenceJob,
        event: str,
        status: str,
        started: float,
        error_code: str,
        exc: BaseException,
    ) -> None:
        try:
            emit_trace_event(
                event=event,
                trace_id=job.trace_id,
                component="upscaler",
                stage="upscale",
                status=status,
                attempt=job.attempt,
                duration_ms=duration_ms(started),
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                error_code=error_code,
                exception_type=type(exc).__name__,
                message=str(exc),
            )
        except Exception:
            LOGGER.warning("Trace terminal event failed", exc_info=True)

    def _error_code(self, exc: BaseException) -> str:
        if isinstance(exc, InterruptedError):
            return "JOB_CANCELLED"
        if isinstance(exc, FileNotFoundError):
            return "MODEL_UNAVAILABLE"
        if isinstance(exc, ValueError):
            return "REQUEST_VALIDATION_FAILED"
        return getattr(exc, "error_code", "JOB_PROCESSING_FAILED")

    def _trace_context(self, job: InferenceJob) -> dict[str, object]:
        return {
            "trace_id": getattr(job, "trace_id", ""),
            "operation_id": getattr(job, "operation_id", None),
            "queue_key": getattr(job, "queue_key", None),
            "backend_job_id": getattr(job, "client_job_id", None),
            "source_fingerprint": getattr(job, "source_fingerprint", None),
            "attempt": getattr(job, "attempt", 1),
        }

    def _is_provider_device_lost(self, exc: Exception) -> bool:
        message = str(exc).lower()
        return (
            "887a0005" in message
            or "device instance has been suspended" in message
            or "device removed" in message
            or "getdeviceremovedreason" in message
        )

    def _text_key(self, options: TextProcessingOptions) -> str:
        if not options.enabled:
            return "off"
        cleanup = "c1" if options.cleanup else "c0"
        translate = "t1" if options.translate else "t0"
        render = "r1" if options.render_text else "r0"
        return f"on-{cleanup}-{translate}-{render}-{options.source_language}-{options.target_language}"
