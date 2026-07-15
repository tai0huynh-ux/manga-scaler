"""Application lifecycle and health API tests."""

from app.main import app
from app.models.schemas import UpscaleResponse
from fastapi.testclient import TestClient


def test_health_is_available_without_model_artifacts() -> None:
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["provider"] in payload["gpu"]["availableProviders"]
    assert payload["model"] == "anime_x4"
    assert {"queue", "cache", "uptime"} <= payload.keys()


def test_upscale_rejects_invalid_browser_image_data() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/upscale",
            json={"imageUrl": "https://example.com/displayed.jpg", "imageData": "not-base64!"},
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["errorCode"] == "REQUEST_VALIDATION_FAILED"
    assert "valid base64" in detail["message"]
    assert detail["traceId"]


def test_upscale_rejects_base64_encoded_html() -> None:
    import base64

    with TestClient(app) as client:
        response = client.post(
            "/upscale",
            json={
                "imageUrl": "https://example.com/protected.jpg",
                "imageData": base64.b64encode(b"<html>blocked</html>").decode(),
            },
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["errorCode"] == "REQUEST_VALIDATION_FAILED"
    assert "not a supported image" in detail["message"]
    assert detail["traceId"]


def test_cancel_unknown_job_is_idempotent() -> None:
    with TestClient(app) as client:
        response = client.delete("/jobs/not-running")
    assert response.status_code == 200
    assert response.json()["cancelled"] is False


def test_upscale_success_returns_trace_id_from_request() -> None:
    class FakeUpscaler:
        async def upscale(self, **kwargs):
            return UpscaleResponse(
                imageUrl="http://127.0.0.1:8765/cache/images/out.webp",
                cacheKey="cache-key",
                cacheHit=False,
                contentType="image/webp",
                bytesWritten=3,
                traceId=kwargs["trace_id"],
            )

    with TestClient(app) as client:
        original = client.app.state.upscaler_service
        try:
            client.app.state.upscaler_service = FakeUpscaler()
            response = client.post(
                "/upscale",
                json={
                    "imageUrl": "https://example.com/source.png",
                    "traceId": "trace-from-client",
                    "operationId": "op-1",
                    "queueKey": "tab:image:op-1",
                },
            )
        finally:
            client.app.state.upscaler_service = original

    assert response.status_code == 200
    assert response.json()["traceId"] == "trace-from-client"


def test_upscale_unexpected_error_returns_safe_trace_detail() -> None:
    class FailingUpscaler:
        async def upscale(self, **_kwargs):
            raise RuntimeError("internal stack should stay server-side")

    with TestClient(app) as client:
        original = client.app.state.upscaler_service
        try:
            client.app.state.upscaler_service = FailingUpscaler()
            response = client.post(
                "/upscale",
                json={"imageUrl": "https://example.com/source.png", "traceId": "trace-error"},
            )
        finally:
            client.app.state.upscaler_service = original

    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail == {
        "traceId": "trace-error",
        "errorCode": "UNEXPECTED_ERROR",
        "message": "Unable to process image.",
        "status": 502,
    }
