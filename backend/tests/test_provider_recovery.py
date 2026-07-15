"""Regression tests for execution-provider recovery."""

from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest
from app.core.config import TraceConfig
from app.core.tracing import configure_tracing
from app.services.gpu_provider import GpuProviderSelector
from app.services.model_manager import ModelManager
from app.services.upscaler import UpscalerService


class RecoveringPipeline:
    def __init__(self, first_error: Exception) -> None:
        self.first_error = first_error
        self.calls: list[dict[str, object]] = []

    async def infer_tiled(self, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            raise self.first_error
        return "cpu-output"


class RecoveringModelManager:
    def __init__(self, recovered_model) -> None:
        self.recovered_model = recovered_model
        self.calls: list[tuple[str, str]] = []

    def recover_after_provider_failure(self, provider: str, model_name: str):
        self.calls.append((provider, model_name))
        return self.recovered_model


def make_service(error: Exception):
    directml = SimpleNamespace(name="anime_x4", provider="DmlExecutionProvider", fixed_tile_size=None)
    cpu = SimpleNamespace(name="anime_x4", provider="CPUExecutionProvider", fixed_tile_size=128)
    pipeline = RecoveringPipeline(error)
    manager = RecoveringModelManager(cpu)
    service = UpscalerService.__new__(UpscalerService)
    service.pipeline = pipeline
    service.model_manager = manager
    service.settings = SimpleNamespace(inference=SimpleNamespace(batch_size=3, tile_overlap=32))
    job = SimpleNamespace(
        cancel_event=threading.Event(),
        trace_id="trace-provider",
        attempt=1,
        operation_id="operation-provider",
        queue_key="queue-provider",
        client_job_id="job-provider",
        source_fingerprint="sha256-source",
    )
    return service, directml, cpu, pipeline, manager, job


@pytest.mark.asyncio
async def test_directml_device_loss_retries_once_on_cpu() -> None:
    error = RuntimeError("887A0005 The GPU device instance has been suspended")
    service, directml, cpu, pipeline, manager, job = make_service(error)

    output, selected_model = await service._infer_with_provider_recovery(
        image=object(), model=directml, tile_size=256, overlap=32, job=job
    )

    assert output == "cpu-output"
    assert selected_model is cpu
    assert manager.calls == [("DmlExecutionProvider", "anime_x4")]
    assert len(pipeline.calls) == 2
    assert pipeline.calls[1]["batch_size"] == 1
    assert pipeline.calls[1]["tile_size"] == 128


@pytest.mark.asyncio
async def test_provider_recovery_traces_retry_and_recovered(tmp_path) -> None:
    configure_tracing(TraceConfig(enabled=True, file="trace.jsonl", includeStack=True), tmp_path)
    error = RuntimeError("887A0005 The GPU device instance has been suspended")
    service, directml, _cpu, _pipeline, _manager, job = make_service(error)

    await service._infer_with_provider_recovery(image=object(), model=directml, tile_size=256, overlap=32, job=job)

    events = [line for line in (tmp_path / "trace.jsonl").read_text(encoding="utf-8").splitlines()]
    assert "backend.upscale.provider.retrying" in "".join(events)
    assert "backend.upscale.provider.recovered" in "".join(events)


@pytest.mark.asyncio
async def test_unrelated_inference_failure_is_not_hidden_by_fallback() -> None:
    error = RuntimeError("invalid model output shape")
    service, directml, _cpu, pipeline, manager, job = make_service(error)

    with pytest.raises(RuntimeError, match="invalid model output shape"):
        await service._infer_with_provider_recovery(
            image=object(), model=directml, tile_size=256, overlap=32, job=job
        )

    assert len(pipeline.calls) == 1
    assert manager.calls == []


def test_disabling_directml_selects_cpu(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.gpu_provider.ort.get_available_providers",
        lambda: ["DmlExecutionProvider", "CPUExecutionProvider"],
    )
    selector = GpuProviderSelector(("DmlExecutionProvider", "CPUExecutionProvider"))

    selection = selector.disable_provider("DmlExecutionProvider", "device lost")

    assert selection.provider == "CPUExecutionProvider"
    assert selector.disabled_providers == {"DmlExecutionProvider"}


def test_recovery_drops_all_sessions_owned_by_failed_provider(monkeypatch) -> None:
    failed = SimpleNamespace(provider="DmlExecutionProvider")
    retained = SimpleNamespace(provider="CPUExecutionProvider")
    recovered = SimpleNamespace(provider="CPUExecutionProvider", name="anime_x4")
    selector = SimpleNamespace(disable_provider=lambda *_args: SimpleNamespace(provider="CPUExecutionProvider"))
    manager = ModelManager.__new__(ModelManager)
    manager.lock = threading.RLock()
    manager.provider_selector = selector
    manager.loaded = {"anime_x4": failed, "general_x4": failed, "cpu_model": retained}
    monkeypatch.setattr(manager, "load_model", lambda name: recovered)

    result = manager.recover_after_provider_failure("DmlExecutionProvider", "anime_x4")

    assert result is recovered
    assert manager.loaded == {"cpu_model": retained}
