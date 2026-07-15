"""Trace writer and propagation tests."""

import json
from datetime import datetime

from app.core.config import TraceConfig
from app.core.tracing import (
    TraceWriter,
    configure_tracing,
    duration_ms,
    emit_trace_event,
    new_trace_id,
    sanitize_metadata,
)


def test_new_trace_id_is_unique_opaque_string() -> None:
    values = {new_trace_id() for _ in range(64)}
    assert len(values) == 64
    assert all(isinstance(value, str) and len(value) >= 16 for value in values)


def test_trace_writer_appends_one_json_line(tmp_path) -> None:
    path = tmp_path / "trace.jsonl"
    writer = TraceWriter(path)

    writer.emit(
        event="backend.job.started",
        trace_id="trace-1",
        component="backend_api",
        stage="api",
        status="running",
        metadata={"mode": "manga"},
    )

    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    payload = json.loads(lines[0])
    assert payload["schema_version"] == 1
    assert payload["trace_id"] == "trace-1"
    assert payload["metadata"] == {"mode": "manga"}
    datetime.fromisoformat(payload["timestamp"])


def test_unserializable_metadata_does_not_crash(tmp_path) -> None:
    path = tmp_path / "trace.jsonl"
    writer = TraceWriter(path)
    writer.emit(
        event="backend.job.started",
        trace_id="trace-1",
        component="backend_api",
        stage="api",
        status="running",
        metadata={"object": object()},
    )
    assert json.loads(path.read_text(encoding="utf-8"))["metadata"]["object"].startswith("<object")


def test_trace_disabled_does_not_create_file(tmp_path) -> None:
    path = tmp_path / "trace.jsonl"
    writer = TraceWriter(path, enabled=False)
    writer.emit(event="event", trace_id="trace", component="backend_api", stage="api", status="running")
    assert not path.exists()


def test_trace_write_failure_does_not_escape(tmp_path) -> None:
    writer = TraceWriter(tmp_path)
    writer.emit(event="event", trace_id="trace", component="backend_api", stage="api", status="running")


def test_duration_is_non_negative() -> None:
    assert duration_ms(0) >= 0


def test_sensitive_metadata_is_removed() -> None:
    assert sanitize_metadata({"imageData": "abc", "mode": "manga"}) == {"imageData": "[REDACTED]", "mode": "manga"}


def test_sensitive_metadata_redacts_nested_case_insensitive_without_mutating() -> None:
    recursive = {"safe": "ok"}
    recursive["self"] = recursive
    metadata = {
        "accessToken": "abc",
        "refresh_token": "def",
        "Password": "secret",
        "Cookie": "cookie",
        "authorizationHeaders": {"Authorization": "bearer abc"},
        "nested": [{"secret": "value"}],
        "recursive": recursive,
    }

    sanitized = sanitize_metadata(metadata)

    assert sanitized["accessToken"] == "[REDACTED]"
    assert sanitized["refresh_token"] == "[REDACTED]"
    assert sanitized["Password"] == "[REDACTED]"
    assert sanitized["Cookie"] == "[REDACTED]"
    assert sanitized["authorizationHeaders"] == "[REDACTED]"
    assert sanitized["nested"][0]["secret"] == "[REDACTED]"
    assert sanitized["recursive"]["self"] == {"recursive": True}
    assert metadata["nested"][0]["secret"] == "value"


def test_long_top_level_message_is_sanitized(tmp_path) -> None:
    path = tmp_path / "trace.jsonl"
    writer = TraceWriter(path)

    writer.emit(
        event="backend.job.failed",
        trace_id="trace-1",
        component="backend_api",
        stage="request",
        status="failed",
        message="x" * 400,
    )

    payload = json.loads(path.read_text(encoding="utf-8"))
    assert len(payload["message"]) == 256
    assert payload["message"].endswith("...")


def test_emit_trace_event_uses_configured_writer(tmp_path) -> None:
    configure_tracing(TraceConfig(enabled=True, file="trace.jsonl", includeStack=True), tmp_path)
    emit_trace_event(
        event="backend.api.request.received",
        trace_id="trace-configured",
        component="backend_api",
        stage="request",
        status="running",
    )
    payload = json.loads((tmp_path / "trace.jsonl").read_text(encoding="utf-8"))
    assert payload["trace_id"] == "trace-configured"
