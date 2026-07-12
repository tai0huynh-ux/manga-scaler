"""Inference queue concurrency tests."""

import asyncio

import pytest

from app.services.inference_queue import InferenceQueue


@pytest.mark.asyncio
async def test_global_semaphore_limits_dynamic_batch() -> None:
    active = 0
    maximum = 0

    async def processor(job):
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        await asyncio.sleep(0.01)
        active -= 1
        return job.image_url

    queue = InferenceQueue(
        max_size=8,
        worker_count=2,
        max_concurrent_inferences=1,
        dynamic_batch_window_ms=1,
        processor=processor,
    )
    await queue.start()
    try:
        results = await asyncio.gather(*(queue.submit(str(index), None, None) for index in range(4)))
    finally:
        await queue.stop()

    assert results == ["0", "1", "2", "3"]
    assert maximum == 1
