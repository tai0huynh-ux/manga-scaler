"""Request and response contracts for the local REST API."""

from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, HttpUrl, TypeAdapter, field_serializer, model_validator


class HealthResponse(BaseModel):
    """Response returned by the health endpoint."""

    status: str = Field(description="Current backend health state.")
    provider: str | None = Field(default=None, description="Selected ONNX Runtime provider.")
    model: str | None = Field(default=None, description="Active model name.")
    gpu: dict[str, Any] = Field(default_factory=dict, description="GPU/provider diagnostics.")
    queue: dict[str, Any] = Field(default_factory=dict, description="Inference queue state.")
    cache: dict[str, Any] = Field(default_factory=dict, description="Cache diagnostics.")
    text: dict[str, Any] = Field(default_factory=dict, description="Text cleanup/OCR/translation diagnostics.")
    uptime: float | None = Field(default=None, description="Backend uptime in seconds.")


class UpscaleRequest(BaseModel):
    """Payload sent by the extension when it discovers an image."""

    schema_version: int = Field(default=1, alias="schemaVersion", ge=1, le=1)
    image_url: str | None = Field(
        default=None,
        alias="imageUrl",
        max_length=16384,
        description="HTTP(S) source URL or browser-owned metadata URL when imageData is supplied.",
    )
    image_data: str | None = Field(
        default=None,
        alias="imageData",
        max_length=90 * 1024 * 1024,
        description="Base64-encoded bytes supplied by the browser that already loaded the image.",
    )
    job_id: str | None = Field(default=None, alias="jobId", max_length=200)
    mode: Literal["auto", "manga", "artwork", "photo"] = Field(
        default="auto", description="Universal enhancement mode."
    )
    model: str | None = Field(default=None, description="Optional model override.")
    tile_size: int | None = Field(default=None, alias="tileSize", description="Optional tile size override.")
    enhance_level: float | None = Field(
        default=None,
        alias="enhanceLevel",
        ge=0.0,
        le=1.0,
        description="Post-processing strength from 0 (off) to 1 (configured maximum).",
    )
    max_output_width: int | None = Field(default=None, alias="maxOutputWidth", ge=256, le=16383)
    max_output_height: int | None = Field(default=None, alias="maxOutputHeight", ge=256, le=16383)
    output_quality: int | None = Field(default=None, alias="outputQuality", ge=50, le=100)
    text_processing: "TextProcessingOptionsRequest | None" = Field(default=None, alias="textProcessing")
    trace_id: str | None = Field(default=None, alias="traceId", max_length=200)
    operation_id: str | None = Field(default=None, alias="operationId", max_length=200)
    queue_key: str | None = Field(default=None, alias="queueKey", max_length=300)
    attempt: int | None = Field(default=None, ge=1, le=100)
    source_fingerprint: str | None = Field(default=None, alias="sourceFingerprint", max_length=200)

    @model_validator(mode="after")
    def validate_image_source(self) -> "UpscaleRequest":
        """Require a safe URL unless the browser supplied the actual bytes."""
        has_image_data = isinstance(self.image_data, str) and bool(self.image_data)
        if not self.image_url:
            if not has_image_data:
                raise ValueError("imageUrl is required unless imageData is provided.")
            return self

        parsed = urlparse(self.image_url)
        if parsed.scheme in {"http", "https"}:
            TypeAdapter(HttpUrl).validate_python(self.image_url)
            return self
        if parsed.scheme in {"blob", "data"} and has_image_data:
            return self
        raise ValueError("imageUrl must use http or https unless browser-owned imageData is provided.")


class UpscaleResponse(BaseModel):
    """Result returned after the image is cached and ready for display."""

    image_url: HttpUrl = Field(alias="imageUrl", description="Image URL to use in the page.")
    original_image_url: HttpUrl | None = Field(default=None, alias="originalImageUrl")
    cache_key: str = Field(alias="cacheKey", description="SHA256 digest for cached image bytes.")
    cache_hit: bool = Field(alias="cacheHit", description="Whether the file was already cached.")
    content_type: str = Field(alias="contentType", description="Downloaded image MIME type.")
    bytes_written: int = Field(alias="bytesWritten", description="Image byte size.")
    model: str | None = Field(default=None, description="Model used for inference.")
    requested_mode: str | None = Field(default=None, alias="requestedMode")
    detected_mode: str | None = Field(default=None, alias="detectedMode")
    detection_confidence: float | None = Field(default=None, alias="detectionConfidence")
    detection_metrics: dict[str, float] = Field(default_factory=dict, alias="detectionMetrics")
    provider: str | None = Field(default=None, description="ONNX Runtime provider used for inference.")
    scale: int | None = Field(default=None, description="Model scale factor.")
    tile_size: int | None = Field(default=None, alias="tileSize", description="Effective model tile size.")
    enhance_level: float | None = Field(default=None, alias="enhanceLevel")
    output_width: int | None = Field(default=None, alias="outputWidth", description="Output image width.")
    output_height: int | None = Field(default=None, alias="outputHeight", description="Output image height.")
    timings: dict[str, float] = Field(default_factory=dict, description="Stage timings in milliseconds.")
    memory: dict[str, int] = Field(default_factory=dict, description="Memory usage in bytes.")
    queue: dict[str, int] = Field(default_factory=dict, description="Queue state snapshot.")
    quality: dict[str, float] = Field(default_factory=dict, description="Objective comparison with bicubic upscale.")
    text_processing: dict[str, Any] = Field(default_factory=dict, alias="textProcessing")
    trace_id: str | None = Field(default=None, alias="traceId")

    @field_serializer("image_url")
    def serialize_image_url(self, value: HttpUrl) -> str:
        """Serialize HttpUrl values as plain strings for browser clients."""
        return str(value)


class SwitchModelRequest(BaseModel):
    """Request body used to switch the active ONNX model."""

    model: str


class TextProcessingOptionsRequest(BaseModel):
    """Optional text cleanup and translation options."""

    enabled: bool = False
    cleanup: bool = True
    translate: bool = False
    source_language: str = Field(default="auto", alias="sourceLanguage")
    target_language: str = Field(default="vi", alias="targetLanguage")
    render_text: bool = Field(default=True, alias="renderText")


class TextProcessRequest(BaseModel):
    """Standalone text processing request for diagnostics and dashboard tooling."""

    image_data: str = Field(alias="imageData", description="Base64-encoded image bytes.")
    options: TextProcessingOptionsRequest = Field(default_factory=TextProcessingOptionsRequest)


class TextProcessResponse(BaseModel):
    """Standalone text processing result."""

    image_url: HttpUrl = Field(alias="imageUrl")
    cache_key: str = Field(alias="cacheKey")
    content_type: str = Field(default="image/png", alias="contentType")
    width: int
    height: int
    text_processing: dict[str, Any] = Field(alias="textProcessing")


class ModelStatusResponse(BaseModel):
    """Model manager status for diagnostics and operations."""

    active_model: str = Field(alias="activeModel")
    loaded_models: list[str] = Field(alias="loadedModels")
    available_models: list[str] = Field(alias="availableModels")
    installed_models: list[str] = Field(alias="installedModels")
    provider: str | None
