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
