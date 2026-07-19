"""HTTP routes exposed by the local AI Manga Upscaler backend."""

import base64
import binascii
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.tracing import duration_ms, emit_trace_event, new_trace_id, trace_include_stack
from app.models.schemas import (
    HealthResponse,
    ModelStatusResponse,
    SwitchModelRequest,
    TextProcessRequest,
    TextProcessResponse,
    UpscaleRequest,
    UpscaleResponse,
)
from app.services.model_manager import ModelManager
from app.services.text_processor import TextProcessingOptions
from app.services.upscaler import UpscalerService
from app.utils.hashing import sha256_bytes

router = APIRouter()


@router.get("/comparisons/latest")
async def latest_comparison(request: Request) -> dict[str, object]:
    """Return the newest complete original/enhanced cache pair."""
    cache_dir = request.app.state.settings.cache_dir
    originals = sorted(cache_dir.glob("*-original.png"), key=lambda path: path.stat().st_mtime, reverse=True)
    for original in originals:
        source_key = original.name.removesuffix("-original.png")
        outputs = sorted(
            cache_dir.glob(f"{source_key}-*.webp"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        if not outputs:
            continue
        enhanced = outputs[0]
        original_url = f"{request.app.state.settings.app.public_base_url}/cache/images/{original.name}"
        enhanced_url = f"{request.app.state.settings.app.public_base_url}/cache/images/{enhanced.name}"
        source_image = await request.app.state.pipeline.decode(original.read_bytes())
        enhanced_image = await request.app.state.pipeline.decode(enhanced.read_bytes())
        quality = request.app.state.quality_analyzer.analyze(source_image, enhanced_image)
        return {"originalImageUrl": original_url, "enhancedImageUrl": enhanced_url, "quality": quality}
    raise HTTPException(status_code=404, detail="No complete comparison is available yet.")


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
        gpu={**provider_selection.gpu, "loadedProviders": model_status.get("loadedProviders", {})},
        queue=upscaler.queue.snapshot(),
        cache={
            "directory": str(cache_dir),
            "files": request.app.state.cache.file_count,
        },
        text=request.app.state.text_processor.capabilities(),
        uptime=request.app.state.runtime.uptime(),
    )


@router.get("/text/capabilities")
async def text_capabilities(request: Request) -> dict[str, object]:
    """Return local text cleanup, OCR, and translation capability diagnostics."""
    return request.app.state.text_processor.capabilities()


@router.post("/text/process", response_model=TextProcessResponse)
async def process_text(payload: TextProcessRequest, request: Request) -> TextProcessResponse:
    """Run text cleanup/translation preparation without neural upscaling."""
    try:
        image_bytes = base64.b64decode(payload.image_data, validate=True)
        image = await request.app.state.pipeline.decode(image_bytes)
        result = await request.app.state.text_processor.process(
            image,
            TextProcessingOptions.from_payload(payload.options),
        )
        encoded = await request.app.state.pipeline.encode_png(result.image)
        cache_key = f"{sha256_bytes(image_bytes)}-text"
        output_path, _ = await request.app.state.cache.save_named(cache_key, encoded, ".png")
        filename = request.app.state.cache.public_filename(output_path)
        image_url = f"{request.app.state.settings.app.public_base_url}/cache/images/{filename}"
        return TextProcessResponse(
            imageUrl=image_url,
            cacheKey=cache_key,
            contentType="image/png",
            width=result.image.width,
            height=result.image.height,
            textProcessing=result.metadata(),
        )
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/upscale", response_model=UpscaleResponse)
async def upscale(
    payload: UpscaleRequest,
    service: UpscalerService = Depends(get_upscaler_service),
) -> UpscaleResponse:
    """Download, upscale with ONNX Runtime, cache, and return WebP output."""
    started = time.perf_counter()
    trace_id = payload.trace_id or new_trace_id()
    attempt = payload.attempt or 1
    emit_trace_event(
        event="backend.api.request.received",
        trace_id=trace_id,
        component="backend_api",
        stage="request",
        status="running",
        attempt=attempt,
        operation_id=payload.operation_id,
        queue_key=payload.queue_key,
        source_fingerprint=payload.source_fingerprint,
        metadata={
            "mode": payload.mode,
            "model": payload.model,
            "tile_size": payload.tile_size,
            "has_image_data": payload.image_data is not None,
        },
    )
    try:
        image_bytes = None
        if payload.image_data is not None:
            try:
                image_bytes = base64.b64decode(payload.image_data, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ValueError("imageData must be valid base64.") from exc
        emit_trace_event(
            event="backend.api.job.submitted",
            trace_id=trace_id,
            component="backend_api",
            stage="request",
            status="queued",
            attempt=attempt,
            operation_id=payload.operation_id,
            queue_key=payload.queue_key,
            source_fingerprint=payload.source_fingerprint,
        )
        response = await service.upscale(
            image_url=str(payload.image_url or "browser-owned://supplied-image"),
            model_name=payload.model,
            tile_size=payload.tile_size,
            enhance_level=payload.enhance_level,
            mode=payload.mode,
            image_bytes=image_bytes,
            client_job_id=payload.job_id,
            max_output_width=payload.max_output_width,
            max_output_height=payload.max_output_height,
            output_quality=payload.output_quality,
            text_processing=TextProcessingOptions.from_payload(payload.text_processing),
            trace_id=trace_id,
            operation_id=payload.operation_id,
            queue_key=payload.queue_key,
            attempt=attempt,
            source_fingerprint=payload.source_fingerprint,
        )
        emit_trace_event(
            event="backend.api.request.completed",
            trace_id=trace_id,
            component="backend_api",
            stage="request",
            status="completed",
            attempt=attempt,
            duration_ms=duration_ms(started),
            operation_id=payload.operation_id,
            queue_key=payload.queue_key,
            source_fingerprint=payload.source_fingerprint,
            metadata={"http_status": status.HTTP_200_OK},
        )
        return response
    except FileNotFoundError as exc:
        raise _trace_http_error(
            exc,
            trace_id,
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "MODEL_UNAVAILABLE",
            "backend.api.request.failed",
            payload,
            started,
            attempt,
        ) from exc
    except ValueError as exc:
        raise _trace_http_error(
            exc,
            trace_id,
            status.HTTP_400_BAD_REQUEST,
            "REQUEST_VALIDATION_FAILED",
            "backend.api.request.rejected",
            payload,
            started,
            attempt,
        ) from exc
    except TimeoutError as exc:
        raise _trace_http_error(
            exc,
            trace_id,
            status.HTTP_504_GATEWAY_TIMEOUT,
            "JOB_TIMEOUT",
            "backend.api.request.timeout",
            payload,
            started,
            attempt,
            trace_status="timeout",
        ) from exc
    except Exception as exc:
        raise _trace_http_error(
            exc,
            trace_id,
            status.HTTP_502_BAD_GATEWAY,
            "UNEXPECTED_ERROR",
            "backend.api.request.failed",
            payload,
            started,
            attempt,
            safe_message="Unable to process image.",
        ) from exc


def _trace_http_error(
    exc: Exception,
    trace_id: str,
    http_status: int,
    error_code: str,
    event: str,
    payload: UpscaleRequest,
    started: float,
    attempt: int,
    trace_status: str = "failed",
    safe_message: str | None = None,
) -> HTTPException:
    message = safe_message or str(exc)
    metadata: dict[str, object] = {"http_status": http_status}
    if trace_include_stack():
        import traceback

        metadata["stack_trace"] = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    emit_trace_event(
        event=event,
        trace_id=trace_id,
        component="backend_api",
        stage="request",
        status=trace_status,
        attempt=attempt,
        duration_ms=duration_ms(started),
        operation_id=payload.operation_id,
        queue_key=payload.queue_key,
        source_fingerprint=payload.source_fingerprint,
        error_code=error_code,
        exception_type=type(exc).__name__,
        message=message,
        metadata=metadata,
    )
    return HTTPException(
        status_code=http_status,
        detail={
            "traceId": trace_id,
            "errorCode": error_code,
            "message": message,
            "status": http_status,
        },
    )


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str, service: UpscalerService = Depends(get_upscaler_service)) -> dict[str, object]:
    """Cancel work whose browser tab or image is no longer active."""
    return {"jobId": job_id, "cancelled": service.cancel(job_id)}


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
