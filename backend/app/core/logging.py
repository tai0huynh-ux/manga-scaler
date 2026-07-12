"""Structured JSON logging setup with rotation."""

import json
import logging
import sys
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from app.core.config import LoggingConfig


class JsonFormatter(logging.Formatter):
    """Formats log records as compact JSON lines."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        for key, value in record.__dict__.items():
            if key.startswith("_") and key not in payload:
                payload[key[1:]] = value
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(config: LoggingConfig, logs_dir: Path) -> None:
    """Configure console and rotating JSON file logging."""
    logs_dir.mkdir(parents=True, exist_ok=True)
    level = getattr(logging, config.level.upper(), logging.INFO)
    formatter = JsonFormatter()

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)

    file_handler = RotatingFileHandler(
        logs_dir / config.file,
        maxBytes=config.max_bytes,
        backupCount=config.backup_count,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    logging.basicConfig(
        level=level,
        handlers=[console_handler, file_handler],
        force=True,
    )
