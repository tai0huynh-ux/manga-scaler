"""Async inference queue with worker pool and concurrency control."""

import asyncio
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from app.core.tracing import duration_ms, emit_trace_event

LOGGER = logging.getLogger(__name__)


@dataclass
class InferenceJob:
    """A queued image inference job."""

    image_url: str
    client_job_id: str | None
    image_bytes: bytes | None
    mode: str
    model_name: str | None
    tile_size: int | None
    enhance_level: float | None
    max_output_width: int | None
    max_output_height: int | None
    output_quality: int | None
    text_processing: object | None
    trace_id: str
    operation_id: str | None
    queue_key: str | None
    attempt: int
    source_fingerprint: str | None
    future: asyncio.Future
    cancel_event: threading.Event = field(default_factory=threading.Event)
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
        self.cancelled = 0
        self.jobs: dict[str, InferenceJob] = {}
        self.futures: set[asyncio.Future] = set()
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
        for future in tuple(self.futures):
            if not future.done():
                future.cancel()
        for worker in self.workers:
            worker.cancel()
        await asyncio.gather(*self.workers, return_exceptions=True)
        self.workers.clear()
        while not self.queue.empty():
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            else:
                self.queue.task_done()

    async def submit(
        self,
        image_url: str,
        model_name: str | None,
        tile_size: int | None,
        enhance_level: float | None = None,
        mode: str = "auto",
        image_bytes: bytes | None = None,
        client_job_id: str | None = None,
        max_output_width: int | None = None,
        max_output_height: int | None = None,
        output_quality: int | None = None,
        text_processing: object | None = None,
        trace_id: str | None = None,
        operation_id: str | None = None,
        queue_key: str | None = None,
        attempt: int = 1,
        source_fingerprint: str | None = None,
    ) -> object:
        """Submit a job and wait for its result."""
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self.futures.add(future)
        future.add_done_callback(self.futures.discard)
        job = InferenceJob(
            image_url=image_url,
            client_job_id=client_job_id,
            image_bytes=image_bytes,
            mode=mode,
            model_name=model_name,
            tile_size=tile_size,
            enhance_level=enhance_level,
            max_output_width=max_output_width,
            max_output_height=max_output_height,
            output_quality=output_quality,
            text_processing=text_processing,
            trace_id=trace_id or "",
            operation_id=operation_id,
            queue_key=queue_key or client_job_id,
            attempt=attempt,
            source_fingerprint=source_fingerprint,
            future=future,
        )
        if client_job_id:
            self.jobs[client_job_id] = job
        emit_trace_event(
            event="backend.queue.job.queued",
            trace_id=job.trace_id,
            component="inference_queue",
            stage="queue",
            status="queued",
            attempt=job.attempt,
            operation_id=job.operation_id,
            queue_key=job.queue_key,
            backend_job_id=job.client_job_id,
            source_fingerprint=job.source_fingerprint,
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
            "cancelled": self.cancelled,
            "workers": len(self.workers),
        }

    def cancel(self, client_job_id: str) -> bool:
        """Signal a queued or active client job to stop."""
        job = self.jobs.get(client_job_id)
        if not job:
            return False
        job.cancel_event.set()
        if not job.future.done():
            job.future.cancel()
        return True

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
        if job.future.cancelled() or job.cancel_event.is_set():
            self.cancelled += 1
            emit_trace_event(
                event="backend.queue.job.cancelled",
                trace_id=job.trace_id,
                component="inference_queue",
                stage="queue",
                status="cancelled",
                attempt=job.attempt,
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
            )
            if job.client_job_id:
                self.jobs.pop(job.client_job_id, None)
            return
        self.processing += 1
        started = time.perf_counter()
        emit_trace_event(
            event="backend.queue.job.started",
            trace_id=job.trace_id,
            component="inference_queue",
            stage="queue",
            status="running",
            attempt=job.attempt,
            duration_ms=duration_ms(job.created_at),
            operation_id=job.operation_id,
            queue_key=job.queue_key,
            backend_job_id=job.client_job_id,
            source_fingerprint=job.source_fingerprint,
            metadata={"worker": worker_id},
        )
        try:
            result = await self.processor(job)
            if not job.future.cancelled():
                job.future.set_result(result)
            self.completed += 1
            emit_trace_event(
                event="backend.queue.job.completed",
                trace_id=job.trace_id,
                component="inference_queue",
                stage="queue",
                status="completed",
                attempt=job.attempt,
                duration_ms=duration_ms(started),
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
            )
        except InterruptedError:
            self.cancelled += 1
            if not job.future.done():
                job.future.cancel()
            emit_trace_event(
                event="backend.queue.job.cancelled",
                trace_id=job.trace_id,
                component="inference_queue",
                stage="queue",
                status="cancelled",
                attempt=job.attempt,
                duration_ms=duration_ms(started),
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                error_code="JOB_CANCELLED",
                exception_type="InterruptedError",
            )
        except Exception as exc:
            LOGGER.exception("Inference job failed", extra={"_worker": worker_id, "_image_url": job.image_url})
            if not job.future.cancelled():
                job.future.set_exception(exc)
            self.failed += 1
            emit_trace_event(
                event="backend.queue.job.failed",
                trace_id=job.trace_id,
                component="inference_queue",
                stage="queue",
                status="failed",
                attempt=job.attempt,
                duration_ms=duration_ms(started),
                operation_id=job.operation_id,
                queue_key=job.queue_key,
                backend_job_id=job.client_job_id,
                source_fingerprint=job.source_fingerprint,
                error_code="MODEL_INFERENCE_FAILED",
                exception_type=type(exc).__name__,
                message=str(exc),
            )
        finally:
            self.processing -= 1
            if job.client_job_id:
                self.jobs.pop(job.client_job_id, None)
