"""Request and response contracts for the local REST API."""

from typing import Any

from pydantic import BaseModel, Field, HttpUrl, field_serializer


class HealthResponse(BaseModel):
    """Response returned by the health endpoint."""

    status: str = Field(description="Current backend health state.")
    provider: str | None = Field(default=None, description="Selected ONNX Runtime provider.")
    model: str | None = Field(default=None, description="Active model name.")
    gpu: dict[str, Any] = Field(default_factory=dict, description="GPU/provider diagnostics.")
    queue: dict[str, Any] = Field(default_factory=dict, description="Inference queue state.")
    cache: dict[str, Any] = Field(default_factory=dict, description="Cache diagnostics.")
    uptime: float | None = Field(default=None, description="Backend uptime in seconds.")


class UpscaleRequest(BaseModel):
    """Payload sent by the extension when it discovers an image."""

    image_url: HttpUrl = Field(alias="imageUrl", description="Absolute source image URL.")
    model: str | None = Field(default=None, description="Optional model override.")
    tile_size: int | None = Field(default=None, alias="tileSize", description="Optional tile size override.")


class UpscaleResponse(BaseModel):
    """Result returned after the image is cached and ready for display."""

    image_url: HttpUrl = Field(alias="imageUrl", description="Image URL to use in the page.")
    cache_key: str = Field(alias="cacheKey", description="SHA256 digest for cached image bytes.")
    cache_hit: bool = Field(alias="cacheHit", description="Whether the file was already cached.")
    content_type: str = Field(alias="contentType", description="Downloaded image MIME type.")
    bytes_written: int = Field(alias="bytesWritten", description="Image byte size.")
    model: str | None = Field(default=None, description="Model used for inference.")
    provider: str | None = Field(default=None, description="ONNX Runtime provider used for inference.")
    scale: int | None = Field(default=None, description="Model scale factor.")
    output_width: int | None = Field(default=None, alias="outputWidth", description="Output image width.")
    output_height: int | None = Field(default=None, alias="outputHeight", description="Output image height.")
    timings: dict[str, float] = Field(default_factory=dict, description="Stage timings in milliseconds.")
    memory: dict[str, int] = Field(default_factory=dict, description="Memory usage in bytes.")
    queue: dict[str, int] = Field(default_factory=dict, description="Queue state snapshot.")

    @field_serializer("image_url")
    def serialize_image_url(self, value: HttpUrl) -> str:
        """Serialize HttpUrl values as plain strings for browser clients."""
        return str(value)


class SwitchModelRequest(BaseModel):
    """Request body used to switch the active ONNX model."""

    model: str


class ModelStatusResponse(BaseModel):
    """Model manager status for diagnostics and operations."""

    active_model: str = Field(alias="activeModel")
    loaded_models: list[str] = Field(alias="loadedModels")
    available_models: list[str] = Field(alias="availableModels")
    provider: str | None
