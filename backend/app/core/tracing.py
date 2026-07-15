"""Small append-only JSONL tracing helpers."""

from __future__ import annotations

import json
import logging
import threading
import time
import traceback
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.config import TraceConfig

LOGGER = logging.getLogger(__name__)

SCHEMA_VERSION = 1
SENSITIVE_KEYS = {
    "authorization",
    "base64",
    "binary",
    "blob",
    "cookie",
    "credential",
    "header",
    "image_data",
    "imageData",
    "password",
    "raw",
    "request",
    "response",
    "secret",
    "session",
    "token",
}
MAX_METADATA_DEPTH = 6
MAX_STRING_LENGTH = 256
REDACTED = "[REDACTED]"


def new_trace_id() -> str:
    """Return an opaque trace correlation identifier."""
    return uuid.uuid4().hex


def utc_timestamp() -> str:
    """Return an ISO-8601 UTC timestamp for trace events."""
    return datetime.now(tz=UTC).isoformat()


def duration_ms(started: float) -> float:
    """Return a non-negative duration in milliseconds from a monotonic start."""
    return max(0.0, round((time.perf_counter() - started) * 1000, 3))


def safe_prefix(value: str | None, length: int = 16) -> str | None:
    """Return a short safe prefix for long identifiers."""
    if not value:
        return None
    return str(value)[:length]


def sanitize_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    """Keep trace metadata small, JSON-safe, and free of obvious sensitive payloads."""
    if not metadata:
        return {}
    return _sanitize_mapping(metadata, depth=0, seen=set())


def exception_metadata(exc: BaseException, include_stack: bool = False) -> dict[str, Any]:
    """Return safe exception fields for terminal trace events."""
    metadata: dict[str, Any] = {
        "exception_type": type(exc).__name__,
        "message": _sanitize_string(str(exc)),
    }
    if include_stack:
        metadata["stack_trace"] = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    return metadata


def emit_trace_event(
    *,
    event: str,
    trace_id: str | None,
    component: str,
    stage: str,
    status: str,
    attempt: int | None = None,
    duration_ms: float | None = None,
    operation_id: str | None = None,
    queue_key: str | None = None,
    backend_job_id: str | None = None,
    source_fingerprint: str | None = None,
    cache_key: str | None = None,
    error_code: str | None = None,
    exception_type: str | None = None,
    message: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Emit a trace event through the configured global writer."""
    writer = _WRITER
    if writer is None or not writer.enabled:
        return
    writer.emit(
        event=event,
        trace_id=trace_id or new_trace_id(),
        component=component,
        stage=stage,
        status=status,
        attempt=attempt,
        duration_ms=duration_ms,
        operation_id=operation_id,
        queue_key=queue_key,
        backend_job_id=backend_job_id,
        source_fingerprint=source_fingerprint,
        cache_key=cache_key,
        error_code=error_code,
        exception_type=exception_type,
        message=message,
        metadata=metadata,
    )


class TraceWriter:
    """Thread-safe append-only JSONL trace writer."""

    def __init__(self, path: Path, enabled: bool = True) -> None:
        self.path = path
        self.enabled = enabled
        self._lock = threading.Lock()
        self._warned = False

    def emit(
        self,
        *,
        event: str,
        trace_id: str,
        component: str,
        stage: str,
        status: str,
        attempt: int | None = None,
        duration_ms: float | None = None,
        operation_id: str | None = None,
        queue_key: str | None = None,
        backend_job_id: str | None = None,
        source_fingerprint: str | None = None,
        cache_key: str | None = None,
        error_code: str | None = None,
        exception_type: str | None = None,
        message: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        if not self.enabled:
            return
        payload: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "timestamp": utc_timestamp(),
            "event": event,
            "trace_id": trace_id,
            "component": component,
            "stage": stage,
            "status": status,
        }
        optional = {
            "attempt": attempt,
            "duration_ms": duration_ms,
            "operation_id": operation_id,
            "queue_key": queue_key,
            "backend_job_id": backend_job_id,
            "source_fingerprint": safe_prefix(source_fingerprint),
            "cache_key": safe_prefix(cache_key),
            "error_code": error_code,
            "exception_type": exception_type,
            "message": _sanitize_string(message) if message is not None else None,
            "metadata": sanitize_metadata(metadata),
        }
        payload.update({key: value for key, value in optional.items() if value not in (None, {})})
        try:
            line = json.dumps(payload, ensure_ascii=False, default=str)
            with self._lock:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with self.path.open("a", encoding="utf-8") as trace_file:
                    trace_file.write(f"{line}\n")
        except Exception as exc:  # pragma: no cover - warning path covered by unit test side effects
            if not self._warned:
                self._warned = True
                LOGGER.warning("Trace write failed", extra={"_error": str(exc)})


_WRITER: TraceWriter | None = None
_INCLUDE_STACK = True


def configure_tracing(config: TraceConfig, logs_dir: Path) -> None:
    """Configure the process-wide trace writer."""
    global _WRITER, _INCLUDE_STACK
    _INCLUDE_STACK = config.include_stack
    _WRITER = TraceWriter(logs_dir / config.file, enabled=config.enabled)


def trace_include_stack() -> bool:
    """Return whether backend trace events should include stack traces."""
    return _INCLUDE_STACK


def _is_sensitive_key(key: object) -> bool:
    normalized = str(key).replace("_", "").replace("-", "").lower()
    return any(part.replace("_", "").lower() in normalized for part in SENSITIVE_KEYS)


def _sanitize_string(value: str) -> str:
    lowered = value.lower()
    if any(part in lowered for part in ("authorization", "token", "secret", "password", "cookie")):
        return REDACTED
    if len(value) > MAX_STRING_LENGTH:
        return f"{value[:MAX_STRING_LENGTH - 3]}..."
    return value


def _sanitize_mapping(metadata: dict[Any, Any], depth: int, seen: set[int]) -> dict[str, Any]:
    if depth >= MAX_METADATA_DEPTH:
        return {"truncated": True}
    object_id = id(metadata)
    if object_id in seen:
        return {"recursive": True}
    seen.add(object_id)
    sanitized: dict[str, Any] = {}
    for key, value in metadata.items():
        key_text = str(key)
        if _is_sensitive_key(key_text):
            sanitized[key_text] = REDACTED
        else:
            sanitized[key_text] = _sanitize_value(value, depth + 1, seen)
    seen.discard(object_id)
    return sanitized


def _sanitize_value(value: Any, depth: int = 0, seen: set[int] | None = None) -> Any:
    seen = seen or set()
    if depth >= MAX_METADATA_DEPTH:
        return {"truncated": True}
    if isinstance(value, (str, int, float, bool)) or value is None:
        if isinstance(value, str):
            return _sanitize_string(value)
        return value
    if isinstance(value, dict):
        return _sanitize_mapping(value, depth, seen)
    if isinstance(value, (list, tuple)):
        object_id = id(value)
        if object_id in seen:
            return [{"recursive": True}]
        seen.add(object_id)
        result = [_sanitize_value(item, depth + 1, seen) for item in value[:20]]
        seen.discard(object_id)
        return result
    return _sanitize_string(str(value))
