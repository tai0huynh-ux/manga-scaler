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


@pytest.mark.asyncio
async def test_client_job_can_cancel_active_processing() -> None:
    async def processor(job):
        while not job.cancel_event.is_set():
            await asyncio.sleep(0.005)
        raise InterruptedError("cancelled")

    queue = InferenceQueue(8, 1, 1, 0, processor)
    await queue.start()
    task = asyncio.create_task(queue.submit("image", None, None, client_job_id="tab-image"))
    await asyncio.sleep(0.02)
    assert queue.cancel("tab-image") is True
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(0.02)
    assert queue.snapshot()["cancelled"] == 1
    await queue.stop()


@pytest.mark.asyncio
async def test_stop_settles_active_submitters() -> None:
    started = asyncio.Event()

    async def processor(_job):
        started.set()
        await asyncio.Event().wait()

    queue = InferenceQueue(8, 1, 1, 0, processor)
    await queue.start()
    submitter = asyncio.create_task(queue.submit("image", None, None))
    await started.wait()

    await queue.stop()

    assert submitter.done()
    assert submitter.cancelled()
    assert queue.snapshot()["processing"] == 0
