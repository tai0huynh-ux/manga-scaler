"""Application lifecycle and health API tests."""

from fastapi.testclient import TestClient

from app.main import app


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
    assert "valid base64" in response.json()["detail"]


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
    assert "not a supported image" in response.json()["detail"]


def test_cancel_unknown_job_is_idempotent() -> None:
    with TestClient(app) as client:
        response = client.delete("/jobs/not-running")
    assert response.status_code == 200
    assert response.json()["cancelled"] is False
