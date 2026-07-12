"""Runtime statistics and timing helpers."""

import time
from dataclasses import dataclass, field
from typing import Any

import psutil


@dataclass
class StageTimings:
    """Collects per-stage latency measurements in milliseconds."""

    values: dict[str, float] = field(default_factory=dict)

    def set(self, name: str, started_at: float) -> None:
        """Record elapsed time since a monotonic start point."""
        self.values[name] = round((time.perf_counter() - started_at) * 1000, 3)

    def total_since(self, started_at: float) -> None:
        """Record total request latency."""
        self.values["totalLatency"] = round((time.perf_counter() - started_at) * 1000, 3)


class MemorySampler:
    """Samples process memory usage for API diagnostics."""

    def __init__(self) -> None:
        self.process = psutil.Process()

    def snapshot(self) -> dict[str, int]:
        """Return RSS and VMS memory usage in bytes."""
        info = self.process.memory_info()
        return {
            "rss": int(info.rss),
            "vms": int(info.vms),
        }


class AppRuntime:
    """Tracks process uptime and shared diagnostics."""

    def __init__(self) -> None:
        self.started_at = time.time()

    def uptime(self) -> float:
        """Return backend uptime in seconds."""
        return round(time.time() - self.started_at, 3)


def merge_health_payload(**sections: Any) -> dict[str, Any]:
    """Create a compact health payload from backend components."""
    return {key: value for key, value in sections.items() if value is not None}
