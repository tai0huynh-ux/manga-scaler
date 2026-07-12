"""Async inference queue with worker pool and concurrency control."""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Awaitable, Callable

LOGGER = logging.getLogger(__name__)


@dataclass
class InferenceJob:
    """A queued image inference job."""

    image_url: str
    mode: str
    model_name: str | None
    tile_size: int | None
    enhance_level: float | None
    future: asyncio.Future
    created_at: float = field(default_factory=lambda: asyncio.get_running_loop().time())


class InferenceQueue:
    """Coordinates queued inference work across a bounded worker pool."""

    def __init__(
        self,
        max_size: int,
        worker_count: int,
        max_concurrent_inferences: int,
        dynamic_batch_window_ms: int,
        processor: Callable[[InferenceJob], Awaitable[object]],
    ) -> None:
        self.queue: asyncio.Queue[InferenceJob] = asyncio.Queue(maxsize=max_size)
        self.worker_count = worker_count
        self.dynamic_batch_window_ms = dynamic_batch_window_ms
        self.processor = processor
        self.semaphore = asyncio.Semaphore(max_concurrent_inferences)
        self.workers: list[asyncio.Task] = []
        self.processing = 0
        self.accepted = 0
        self.completed = 0
        self.failed = 0
        self.running = False

    async def start(self) -> None:
        """Start queue workers."""
        if self.running:
            return
        self.running = True
        self.workers = [asyncio.create_task(self._worker(index)) for index in range(self.worker_count)]

    async def stop(self) -> None:
        """Cancel queue workers."""
        self.running = False
        for worker in self.workers:
            worker.cancel()
        await asyncio.gather(*self.workers, return_exceptions=True)

    async def submit(
        self,
        image_url: str,
        model_name: str | None,
        tile_size: int | None,
        enhance_level: float | None = None,
        mode: str = "auto",
    ) -> object:
        """Submit a job and wait for its result."""
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        job = InferenceJob(
            image_url=image_url,
            mode=mode,
            model_name=model_name,
            tile_size=tile_size,
            enhance_level=enhance_level,
            future=future,
        )
        await self.queue.put(job)
        self.accepted += 1
        return await future

    def snapshot(self) -> dict[str, int]:
        """Return queue diagnostics."""
        return {
            "size": self.queue.qsize() + self.processing,
            "waiting": self.queue.qsize(),
            "processing": self.processing,
            "accepted": self.accepted,
            "completed": self.completed,
            "failed": self.failed,
            "workers": len(self.workers),
        }

    async def _worker(self, worker_id: int) -> None:
        """Run one queue worker loop."""
        while True:
            job = await self.queue.get()
            batch = [job]
            await asyncio.sleep(self.dynamic_batch_window_ms / 1000)
            while not self.queue.empty():
                try:
                    batch.append(self.queue.get_nowait())
                except asyncio.QueueEmpty:
                    break

            await asyncio.gather(*(self._process_with_limit(item, worker_id) for item in batch))

            for _ in batch:
                self.queue.task_done()

    async def _process_with_limit(self, job: InferenceJob, worker_id: int) -> None:
        """Process one dynamically collected job under the global limit."""
        async with self.semaphore:
            await self._process_job(job, worker_id)

    async def _process_job(self, job: InferenceJob, worker_id: int) -> None:
        """Process one job and settle its future."""
        if job.future.cancelled():
            return
        self.processing += 1
        try:
            result = await self.processor(job)
            if not job.future.cancelled():
                job.future.set_result(result)
            self.completed += 1
        except Exception as exc:
            LOGGER.exception("Inference job failed", extra={"_worker": worker_id, "_image_url": job.image_url})
            if not job.future.cancelled():
                job.future.set_exception(exc)
            self.failed += 1
        finally:
            self.processing -= 1
