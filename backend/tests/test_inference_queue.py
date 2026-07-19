"""Inference queue concurrency tests."""

import asyncio
import json

import pytest
from app.core.config import TraceConfig
from app.core.tracing import configure_tracing
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


@pytest.mark.asyncio
async def test_stop_clears_queued_jobs_before_restart() -> None:
    active_started = asyncio.Event()

    async def processor(job):
        if job.image_url == "active":
            active_started.set()
            await asyncio.Event().wait()
        return job.image_url

    queue = InferenceQueue(8, 1, 1, 0, processor)
    await queue.start()
    active = asyncio.create_task(queue.submit("active", None, None, client_job_id="active-job"))
    await active_started.wait()
    queued = asyncio.create_task(queue.submit("queued", None, None, client_job_id="queued-job"))
    while queue.snapshot()["waiting"] != 1:
        await asyncio.sleep(0)

    await queue.stop()

    settled = await asyncio.gather(active, queued, return_exceptions=True)
    assert all(isinstance(result, asyncio.CancelledError) for result in settled)
    assert queue.snapshot()["size"] == 0
    assert queue.snapshot()["processing"] == 0
    assert queue.jobs == {}
    assert queue.tracked_jobs == {}
    assert queue.futures == set()
    assert queue.cancel("queued-job") is False

    await queue.start()
    try:
        assert await queue.submit("fresh", None, None, client_job_id="fresh-job") == "fresh"
    finally:
        await queue.stop()


@pytest.mark.asyncio
async def test_stop_cancels_submitter_blocked_by_full_queue() -> None:
    active_started = asyncio.Event()

    async def processor(job):
        if job.image_url == "active":
            active_started.set()
            await asyncio.Event().wait()
        return job.image_url

    queue = InferenceQueue(1, 1, 1, 0, processor)
    await queue.start()
    active = asyncio.create_task(queue.submit("active", None, None, client_job_id="active-job"))
    await active_started.wait()
    queued = asyncio.create_task(queue.submit("queued", None, None, client_job_id="queued-job"))
    while queue.snapshot()["waiting"] != 1:
        await asyncio.sleep(0)
    blocked = asyncio.create_task(queue.submit("blocked", None, None, client_job_id="blocked-job"))
    await asyncio.sleep(0)
    assert blocked.done() is False

    await queue.stop()

    settled = await asyncio.gather(active, queued, blocked, return_exceptions=True)
    assert all(isinstance(result, asyncio.CancelledError) for result in settled)
    assert queue.snapshot()["size"] == 0
    assert queue.jobs == {}
    assert queue.tracked_jobs == {}
    assert queue.futures == set()


@pytest.mark.asyncio
async def test_cancel_submitter_blocked_by_full_queue_never_enqueues_it() -> None:
    active_started = asyncio.Event()
    release_active = asyncio.Event()
    processed: list[str] = []

    async def processor(job):
        processed.append(job.image_url)
        if job.image_url == "active":
            active_started.set()
            await release_active.wait()
        return job.image_url

    queue = InferenceQueue(1, 1, 1, 0, processor)
    await queue.start()
    active = asyncio.create_task(queue.submit("active", None, None, client_job_id="active-job"))
    await active_started.wait()
    queued = asyncio.create_task(queue.submit("queued", None, None, client_job_id="queued-job"))
    while queue.snapshot()["waiting"] != 1:
        await asyncio.sleep(0)
    blocked = asyncio.create_task(queue.submit("blocked", None, None, client_job_id="blocked-job"))
    await asyncio.sleep(0)

    assert queue.cancel("blocked-job") is True
    with pytest.raises(asyncio.CancelledError):
        await blocked
    assert queue.snapshot()["waiting"] == 1

    release_active.set()
    assert await active == "active"
    assert await queued == "queued"
    await queue.stop()
    assert processed == ["active", "queued"]
    assert "blocked-job" not in queue.jobs


@pytest.mark.asyncio
async def test_stale_completion_cannot_remove_newer_same_id_job() -> None:
    first_started = asyncio.Event()
    second_started = asyncio.Event()
    release_first = asyncio.Event()

    async def processor(job):
        if job.image_url == "first":
            first_started.set()
            await release_first.wait()
            return "first-result"
        second_started.set()
        while not job.cancel_event.is_set():
            await asyncio.sleep(0)
        raise InterruptedError("cancelled")

    queue = InferenceQueue(8, 2, 2, 0, processor)
    await queue.start()
    first = asyncio.create_task(queue.submit("first", None, None, client_job_id="shared-job"))
    await first_started.wait()
    second = asyncio.create_task(queue.submit("second", None, None, client_job_id="shared-job"))
    await second_started.wait()

    release_first.set()
    assert await first == "first-result"
    assert queue.cancel("shared-job") is True
    with pytest.raises(asyncio.CancelledError):
        await second
    await asyncio.sleep(0)
    assert queue.snapshot()["cancelled"] == 1
    await queue.stop()


@pytest.mark.asyncio
async def test_queue_propagates_trace_id_to_job_and_events(tmp_path) -> None:
    configure_tracing(TraceConfig(enabled=True, file="trace.jsonl", includeStack=True), tmp_path)

    async def processor(job):
        assert job.trace_id == "trace-queue"
        assert job.operation_id == "operation-queue"
        assert job.queue_key == "queue-key"
        assert job.attempt == 2
        return "ok"

    queue = InferenceQueue(8, 1, 1, 0, processor)
    await queue.start()
    try:
        result = await queue.submit(
            "image",
            None,
            None,
            trace_id="trace-queue",
            operation_id="operation-queue",
            queue_key="queue-key",
            attempt=2,
            source_fingerprint="sha256-source",
        )
    finally:
        await queue.stop()

    events = [json.loads(line) for line in (tmp_path / "trace.jsonl").read_text(encoding="utf-8").splitlines()]
    assert result == "ok"
    assert [event["event"] for event in events] == [
        "backend.queue.job.queued",
        "backend.queue.job.started",
        "backend.queue.job.completed",
    ]
    assert {event["trace_id"] for event in events} == {"trace-queue"}


@pytest.mark.asyncio
async def test_late_future_cancellation_does_not_complete_job(tmp_path) -> None:
    configure_tracing(TraceConfig(enabled=True, file="trace.jsonl", includeStack=True), tmp_path)

    async def processor(job):
        job.future.cancel()
        return "late-result"

    queue = InferenceQueue(8, 1, 1, 0, processor)
    await queue.start()
    try:
        with pytest.raises(asyncio.CancelledError):
            await queue.submit("image", None, None, client_job_id="late")
    finally:
        await queue.stop()

    events = [json.loads(line) for line in (tmp_path / "trace.jsonl").read_text(encoding="utf-8").splitlines()]
    assert queue.snapshot()["completed"] == 0
    assert queue.snapshot()["cancelled"] == 1
    assert [event["event"] for event in events].count("backend.queue.job.cancelled") == 1
    assert "backend.queue.job.completed" not in [event["event"] for event in events]


@pytest.mark.asyncio
async def test_queue_creates_one_fallback_trace_id_for_direct_submit(tmp_path) -> None:
    configure_tracing(TraceConfig(enabled=True, file="trace.jsonl", includeStack=True), tmp_path)

    async def processor(_job):
        return "ok"

    queue = InferenceQueue(8, 1, 1, 0, processor)
    await queue.start()
    try:
        assert await queue.submit("image", None, None) == "ok"
    finally:
        await queue.stop()

    events = [json.loads(line) for line in (tmp_path / "trace.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [event["event"] for event in events] == [
        "backend.queue.job.queued",
        "backend.queue.job.started",
        "backend.queue.job.completed",
    ]
    assert len({event["trace_id"] for event in events}) == 1
    assert events[1]["duration_ms"] >= 0
