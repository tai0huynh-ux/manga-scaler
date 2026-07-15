"""JSON-backed runtime configuration for the local backend."""

import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field, model_validator


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
    url: str | None = None
    sha256: str | None = None
    auto_download: bool = Field(default=False, alias="autoDownload")


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

    @model_validator(mode="after")
    def validate_inference_settings(self) -> "InferenceConfig":
        """Validate related inference limits from the JSON configuration."""
        if self.default_model not in self.models:
            raise ValueError("defaultModel must reference a configured model.")
        if self.tile_size not in self.allowed_tile_sizes:
            raise ValueError("tileSize must be included in allowedTileSizes.")
        if not self.allowed_tile_sizes or any(size <= 0 for size in self.allowed_tile_sizes):
            raise ValueError("allowedTileSizes must contain positive values.")
        if self.tile_overlap < 0 or self.tile_overlap * 2 >= min(self.allowed_tile_sizes):
            raise ValueError("tileOverlap must be non-negative and smaller than half a tile.")
        for field_name in ("batch_size", "worker_count", "max_concurrent_inferences", "queue_max_size"):
            if getattr(self, field_name) <= 0:
                raise ValueError(f"{field_name} must be positive.")
        if self.dynamic_batch_window_ms < 0:
            raise ValueError("dynamicBatchWindowMs cannot be negative.")
        return self


class EncodingConfig(BaseModel):
    """Output image encoding settings."""

    format: str
    max_output_dimension: int = Field(default=16383, alias="maxOutputDimension", ge=256, le=16383)
    quality: int
    lossless: bool
    method: int


class EnhancementConfig(BaseModel):
    """Adjustable post-processing applied after neural inference."""

    default_level: float = Field(alias="defaultLevel", ge=0.0, le=1.0)
    sharpness: float = Field(ge=0.0, le=3.0)
    contrast: float = Field(ge=0.0, le=3.0)
    color: float = Field(ge=0.0, le=3.0)
    denoise: float = Field(ge=0.0, le=1.0)


class ModeConfig(BaseModel):
    """Model and post-processing defaults for one content mode."""

    model: str
    enhance_level: float = Field(alias="enhanceLevel", ge=0.0, le=1.0)
    preserve_grayscale: bool = Field(alias="preserveGrayscale")


class AutoDetectionConfig(BaseModel):
    """Thresholds for deterministic image-type classification."""

    sample_size: int = Field(alias="sampleSize", ge=32, le=1024)
    grayscale_threshold: float = Field(alias="grayscaleThreshold", ge=0.0, le=1.0)
    manga_grayscale_ratio: float = Field(alias="mangaGrayscaleRatio", ge=0.0, le=1.0)
    artwork_palette_ratio: float = Field(alias="artworkPaletteRatio", ge=0.0, le=1.0)
    artwork_tall_aspect_ratio: float = Field(alias="artworkTallAspectRatio", ge=1.0, le=10.0)
    artwork_saturation: float = Field(alias="artworkSaturation", ge=0.0, le=1.0)


class TextProcessingConfig(BaseModel):
    """Local text cleanup/OCR/translation settings."""

    enabled: bool = False
    dark_threshold: int = Field(default=86, alias="darkThreshold", ge=0, le=255)
    light_threshold: int = Field(default=205, alias="lightThreshold", ge=0, le=255)
    background_radius: int = Field(default=19, alias="backgroundRadius", ge=3, le=99)
    mask_padding: int = Field(default=2, alias="maskPadding", ge=0, le=32)
    min_region_area: int = Field(default=18, alias="minRegionArea", ge=1, le=100000)
    max_region_area_ratio: float = Field(default=0.08, alias="maxRegionAreaRatio", ge=0.001, le=0.5)
    max_regions: int = Field(default=250, alias="maxRegions", ge=1, le=2000)
    ocr_languages: str = Field(default="eng+vie", alias="ocrLanguages")
    target_language: str = Field(default="vi", alias="targetLanguage")
    render_translated_text: bool = Field(default=True, alias="renderTranslatedText")


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
    enhancement: EnhancementConfig
    modes: dict[str, ModeConfig]
    auto_detection: AutoDetectionConfig = Field(alias="autoDetection")
    text_processing: TextProcessingConfig = Field(default_factory=TextProcessingConfig, alias="textProcessing")
    encoding: EncodingConfig
    logging: LoggingConfig
    root_dir: Path = Field(exclude=True)

    @model_validator(mode="after")
    def validate_modes(self) -> "Settings":
        required = {"manga", "artwork", "photo"}
        if not required.issubset(self.modes):
            raise ValueError("modes must configure manga, artwork, and photo.")
        unknown = {profile.model for profile in self.modes.values()} - set(self.inference.models)
        if unknown:
            raise ValueError(f"Mode profiles reference unknown models: {sorted(unknown)}")
        return self

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
