"""AI upscaling orchestration service backed by ONNX Runtime."""

import logging
import time

from app.core.config import Settings
from app.models.schemas import UpscaleResponse
from app.services.cache import ImageCache
from app.services.downloader import ImageDownloader
from app.services.image_pipeline import EncodedImage, ImagePipeline
from app.services.inference_queue import InferenceJob, InferenceQueue
from app.services.model_manager import ModelManager
from app.services.statistics import MemorySampler, StageTimings
from app.utils.hashing import sha256_bytes

LOGGER = logging.getLogger(__name__)


class UpscalerService:
    """Coordinates download, cache lookup, queued inference, and API responses."""

    def __init__(
        self,
        settings: Settings,
        cache: ImageCache,
        downloader: ImageDownloader,
        model_manager: ModelManager,
        pipeline: ImagePipeline,
    ) -> None:
        self.settings = settings
        self.cache = cache
        self.downloader = downloader
        self.model_manager = model_manager
        self.pipeline = pipeline
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
    ) -> UpscaleResponse:
        """Submit an image URL for AI upscaling and wait for the result."""
        result = await self.queue.submit(str(image_url), model_name, tile_size)
        if not isinstance(result, UpscaleResponse):
            raise TypeError("Inference queue returned an invalid response.")
        return result

    async def _process_job(self, job: InferenceJob) -> UpscaleResponse:
        """Process a queued image through the full inference pipeline."""
        total_started = time.perf_counter()
        timings = StageTimings()

        download_started = time.perf_counter()
        downloaded = await self.downloader.download(job.image_url)
        timings.set("download", download_started)

        source_key = sha256_bytes(downloaded.content)
        model = self.model_manager.get_model(job.model_name)
        tile_size = self._resolve_tile_size(job.tile_size)
        output_key = f"{source_key}-{model.name}-x{model.scale}-t{tile_size}-webp"

        final_path = self.settings.cache_dir / f"{output_key}.webp"
        if final_path.exists():
            cached = await self.pipeline.decode(final_path.read_bytes())
            timings.total_since(total_started)
            return self._response(
                output=EncodedImage(
                    content=final_path.read_bytes(),
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
            )

        decode_started = time.perf_counter()
        image = await self.pipeline.decode(downloaded.content)
        timings.set("decode", decode_started)

        inference_started = time.perf_counter()
        output = await self.pipeline.infer_tiled(
            image=image,
            model=model,
            tile_size=tile_size,
            overlap=self.settings.inference.tile_overlap,
            batch_size=self.settings.inference.batch_size,
        )
        timings.set("inference", inference_started)
        timings.values["gpu"] = output.gpu_time_ms

        encode_started = time.perf_counter()
        encoded = await self.pipeline.encode_webp(output.image)
        timings.set("encode", encode_started)
        output_artifact = EncodedImage(
            content=encoded,
            content_type="image/webp",
            width=output.image.width,
            height=output.image.height,
            gpu_time_ms=output.gpu_time_ms,
        )
        output_path, cache_hit = await self.cache.save_named(output_key, output_artifact.content, ".webp")
        timings.total_since(total_started)

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
        )

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
    ) -> UpscaleResponse:
        """Build an API response compatible with the existing extension."""
        filename = self.cache.public_filename(output_path)
        image_url = f"{self.settings.app.public_base_url}/cache/images/{filename}"
        return UpscaleResponse(
            imageUrl=image_url,
            cacheKey=cache_key,
            cacheHit=cache_hit,
            contentType=output.content_type,
            bytesWritten=len(output.content),
            model=model_name,
            provider=provider,
            scale=scale,
            outputWidth=output.width,
            outputHeight=output.height,
            timings=timings,
            memory=self.memory_sampler.snapshot(),
            queue=self.queue.snapshot(),
        )

    def _resolve_tile_size(self, requested_tile_size: int | None) -> int:
        """Validate and return the effective tile size."""
        tile_size = requested_tile_size or self.settings.inference.tile_size
        if tile_size not in self.settings.inference.allowed_tile_sizes:
            allowed = ", ".join(str(size) for size in self.settings.inference.allowed_tile_sizes)
            raise ValueError(f"tileSize must be one of: {allowed}.")
        return tile_size
