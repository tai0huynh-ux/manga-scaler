"""FastAPI application factory for AI Manga Upscaler."""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.services.cache import ImageCache
from app.services.downloader import ImageDownloader
from app.services.gpu_provider import GpuProviderSelector
from app.services.image_pipeline import ImagePipeline
from app.services.image_classifier import ImageTypeClassifier
from app.services.quality import QualityAnalyzer
from app.services.model_manager import ModelManager
from app.services.statistics import AppRuntime
from app.services.upscaler import UpscalerService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Create and dispose application-level services."""
    settings = get_settings()
    configure_logging(settings.logging, settings.logs_dir)

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
        quality_analyzer=QualityAnalyzer(),
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

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )
    app.mount("/cache/images", StaticFiles(directory=settings.cache_dir), name="image-cache")
    app.include_router(router)
    return app


app = create_app()
