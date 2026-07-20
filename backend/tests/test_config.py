"""Configuration validation tests."""

import json
from pathlib import Path

import pytest
from app.core.config import Settings
from pydantic import ValidationError


def load_payload() -> dict:
    config_path = Path(__file__).resolve().parents[1] / "config.json"
    return json.loads(config_path.read_text(encoding="utf-8"))


def test_project_config_is_valid() -> None:
    settings = Settings(**load_payload(), root_dir=Path.cwd())
    assert settings.inference.tile_size in settings.inference.allowed_tile_sizes
    assert settings.inference.default_model in settings.inference.models
    assert settings.inference.max_concurrent_inferences == 1
    assert settings.inference.worker_count == 1
    assert settings.app.port == 8766


def test_default_model_must_be_configured() -> None:
    payload = load_payload()
    payload["inference"]["defaultModel"] = "missing"
    with pytest.raises(ValidationError, match="defaultModel"):
        Settings(**payload, root_dir=Path.cwd())
