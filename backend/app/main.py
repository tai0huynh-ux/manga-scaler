"""FastAPI application factory for AI Manga Upscaler."""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.tracing import configure_tracing, new_trace_id
from app.services.cache import ImageCache
from app.services.downloader import ImageDownloader
from app.services.gpu_provider import GpuProviderSelector
from app.services.image_classifier import ImageTypeClassifier
from app.services.image_pipeline import ImagePipeline
from app.services.model_manager import ModelManager
from app.services.quality import QualityAnalyzer
from app.services.statistics import AppRuntime
from app.services.text_processor import TextProcessor
from app.services.upscaler import UpscalerService


def _validation_trace_id(exc: RequestValidationError) -> str:
    """Preserve only a bounded client trace ID from a JSON object body."""
    body = exc.body
    if isinstance(body, dict):
        trace_id = body.get("traceId")
        if isinstance(trace_id, str) and 0 < len(trace_id) <= 200:
            return trace_id
    return new_trace_id()


def _safe_validation_detail(exc: RequestValidationError) -> list[dict[str, str]]:
    """Expose validation locations/types/messages without rejected values."""
    details = []
    for error in exc.errors():
        location = error.get("loc") or ("body",)
        field = ".".join(str(part) for part in location)[:200]
        error_type = str(error.get("type") or "validation_error")[:100]
        message = " ".join(str(error.get("msg") or "Request validation failed").split())[:300]
        details.append({"field": field, "type": error_type, "message": message})
    return details or [{
        "field": "body",
        "type": "validation_error",
        "message": "Request validation failed",
    }]


async def request_validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Return a stable, redacted 422 contract for malformed API requests."""
    return JSONResponse(
        status_code=422,
        content={
            "errorCode": "REQUEST_VALIDATION_FAILED",
            "traceId": _validation_trace_id(exc),
            "status": 422,
            "detail": _safe_validation_detail(exc),
        },
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Create and dispose application-level services."""
    settings = get_settings()
    configure_logging(settings.logging, settings.logs_dir)
    configure_tracing(settings.trace, settings.logs_dir)

    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    settings.models_dir.mkdir(parents=True, exist_ok=True)

    cache = ImageCache(settings.cache_dir)
    downloader = ImageDownloader(
        timeout_seconds=settings.download.timeout_seconds,
        max_download_bytes=settings.download.max_bytes,
        allowed_content_types=settings.download.allowed_image_content_types,
    )
    provider_selector = GpuProviderSelector(settings.inference.provider_preference)
    model_manager = ModelManager.create_singleton(
        models_dir=settings.models_dir,
        config=settings.inference,
        provider_selector=provider_selector,
    )
    pipeline = ImagePipeline(settings.encoding, settings.enhancement)
    classifier = ImageTypeClassifier(settings.auto_detection)
    quality_analyzer = QualityAnalyzer()
    text_processor = TextProcessor(settings.text_processing, history_path=settings.logs_dir / "translation-history.jsonl")
    app.state.pipeline = pipeline
    app.state.quality_analyzer = quality_analyzer
    app.state.text_processor = text_processor

    app.state.runtime = AppRuntime()
    app.state.settings = settings
    app.state.cache = cache
    app.state.provider_selector = provider_selector
    app.state.model_manager = model_manager
    app.state.upscaler_service = UpscalerService(
        settings=settings,
        cache=cache,
        downloader=downloader,
        model_manager=model_manager,
        pipeline=pipeline,
        classifier=classifier,
        quality_analyzer=quality_analyzer,
        text_processor=text_processor,
    )
    await app.state.upscaler_service.start()
    yield
    await app.state.upscaler_service.stop()
    await downloader.close()


def create_app() -> FastAPI:
    """Build the FastAPI app with local-extension friendly middleware."""
    settings = get_settings()
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title=settings.app.name, version="0.2.0", lifespan=lifespan)
    app.add_exception_handler(RequestValidationError, request_validation_exception_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )
    app.mount("/cache/images", StaticFiles(directory=settings.cache_dir), name="image-cache")
    app.include_router(router)
    return app


app = create_app()
