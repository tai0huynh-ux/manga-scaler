"""JSON-backed runtime configuration for the local backend."""

import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field, field_validator


class AppConfig(BaseModel):
    """HTTP application identity and binding settings."""

    name: str
    host: str
    port: int
    public_base_url: str = Field(alias="publicBaseUrl")


class PathsConfig(BaseModel):
    """Filesystem locations used by models, cache, and logs."""

    cache_dir: Path = Field(alias="cacheDir")
    models_dir: Path = Field(alias="modelsDir")
    logs_dir: Path = Field(alias="logsDir")


class DownloadConfig(BaseModel):
    """Remote image download limits and validation rules."""

    timeout_seconds: float = Field(alias="timeoutSeconds")
    max_bytes: int = Field(alias="maxBytes")
    allowed_image_content_types: tuple[str, ...] = Field(alias="allowedImageContentTypes")


class ModelConfig(BaseModel):
    """Single ONNX model descriptor."""

    file: str
    scale: int


class InferenceConfig(BaseModel):
    """ONNX Runtime and tile inference behavior."""

    enabled: bool
    default_model: str = Field(alias="defaultModel")
    models: dict[str, ModelConfig]
    provider_preference: tuple[str, ...] = Field(alias="providerPreference")
    tile_size: int = Field(alias="tileSize")
    allowed_tile_sizes: tuple[int, ...] = Field(alias="allowedTileSizes")
    tile_overlap: int = Field(alias="tileOverlap")
    batch_size: int = Field(alias="batchSize")
    warmup: bool
    worker_count: int = Field(alias="workerCount")
    max_concurrent_inferences: int = Field(alias="maxConcurrentInferences")
    queue_max_size: int = Field(alias="queueMaxSize")
    dynamic_batch_window_ms: int = Field(alias="dynamicBatchWindowMs")

    @field_validator("tile_size")
    @classmethod
    def validate_tile_size(cls, value: int) -> int:
        """Accept only production-tested tile sizes."""
        if value not in {256, 512, 1024}:
            raise ValueError("tileSize must be one of 256, 512, or 1024.")
        return value


class EncodingConfig(BaseModel):
    """Output image encoding settings."""

    format: str
    quality: int
    lossless: bool
    method: int


class LoggingConfig(BaseModel):
    """Structured rotating log settings."""

    level: str
    file: str
    max_bytes: int = Field(alias="maxBytes")
    backup_count: int = Field(alias="backupCount")


class Settings(BaseModel):
    """Complete backend configuration loaded from backend/config.json."""

    app: AppConfig
    paths: PathsConfig
    download: DownloadConfig
    inference: InferenceConfig
    encoding: EncodingConfig
    logging: LoggingConfig
    root_dir: Path = Field(exclude=True)

    def resolve_path(self, path: Path) -> Path:
        """Resolve relative config paths against the backend directory."""
        if path.is_absolute():
            return path.expanduser().resolve()
        return (self.root_dir / path).expanduser().resolve()

    @property
    def cache_dir(self) -> Path:
        """Return the absolute image cache directory."""
        return self.resolve_path(self.paths.cache_dir)

    @property
    def models_dir(self) -> Path:
        """Return the absolute model directory."""
        return self.resolve_path(self.paths.models_dir)

    @property
    def logs_dir(self) -> Path:
        """Return the absolute log directory."""
        return self.resolve_path(self.paths.logs_dir)


@lru_cache
def get_settings() -> Settings:
    """Load and cache settings from config.json."""
    backend_dir = Path(__file__).resolve().parents[2]
    config_path = backend_dir / "config.json"
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    return Settings(**payload, root_dir=backend_dir)
