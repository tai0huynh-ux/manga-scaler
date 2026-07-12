"""HTTP routes exposed by the local AI Manga Upscaler backend."""

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.models.schemas import HealthResponse, ModelStatusResponse, SwitchModelRequest, UpscaleRequest, UpscaleResponse
from app.services.model_manager import ModelManager
from app.services.upscaler import UpscalerService

router = APIRouter()


def get_upscaler_service(request: Request) -> UpscalerService:
    """Resolve the singleton upscaler service stored on the FastAPI app."""
    return request.app.state.upscaler_service


def get_model_manager(request: Request) -> ModelManager:
    """Resolve the singleton model manager stored on the FastAPI app."""
    return request.app.state.model_manager


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    """Return provider, model, queue, cache, and uptime diagnostics."""
    model_manager: ModelManager = request.app.state.model_manager
    provider_selection = request.app.state.provider_selector.current()
    upscaler: UpscalerService = request.app.state.upscaler_service
    cache_dir = request.app.state.settings.cache_dir
    model_status = model_manager.status()

    return HealthResponse(
        status="ok",
        provider=provider_selection.provider,
        model=str(model_status["activeModel"]),
        gpu=provider_selection.gpu,
        queue=upscaler.queue.snapshot(),
        cache={
            "directory": str(cache_dir),
            "files": len([path for path in cache_dir.iterdir() if path.is_file()]),
        },
        uptime=request.app.state.runtime.uptime(),
    )


@router.post("/upscale", response_model=UpscaleResponse)
async def upscale(
    payload: UpscaleRequest,
    service: UpscalerService = Depends(get_upscaler_service),
) -> UpscaleResponse:
    """Download, upscale with ONNX Runtime, cache, and return WebP output."""
    try:
        return await service.upscale(
            image_url=str(payload.image_url),
            model_name=payload.model,
            tile_size=payload.tile_size,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to process image.",
        ) from exc


@router.get("/models", response_model=ModelStatusResponse)
async def models(manager: ModelManager = Depends(get_model_manager)) -> ModelStatusResponse:
    """Return model manager state."""
    return ModelStatusResponse(**manager.status())


@router.post("/models/switch", response_model=ModelStatusResponse)
async def switch_model(
    payload: SwitchModelRequest,
    manager: ModelManager = Depends(get_model_manager),
) -> ModelStatusResponse:
    """Switch the active model, loading and warming it if necessary."""
    try:
        manager.switch_model(payload.model)
        return ModelStatusResponse(**manager.status())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/models/reload", response_model=ModelStatusResponse)
async def reload_active_model(manager: ModelManager = Depends(get_model_manager)) -> ModelStatusResponse:
    """Force hot reload of the active model."""
    try:
        manager.reload_active_model()
        return ModelStatusResponse(**manager.status())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
