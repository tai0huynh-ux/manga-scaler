"""Tests for local text cleanup and translation capability reporting."""

import base64
import io

from fastapi.testclient import TestClient
from PIL import Image, ImageChops, ImageDraw

from app.main import app
from app.services.text_processor import TextProcessingOptions


def synthetic_text_image() -> Image.Image:
    image = Image.new("RGB", (320, 180), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((28, 22, 292, 130), fill="white", outline=(210, 210, 210), width=2)
    draw.text((72, 58), "HELLO AI", fill="black")
    draw.rectangle((20, 145, 300, 170), fill=(40, 80, 150))
    return image


def encode_png(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, format="PNG")
    return base64.b64encode(output.getvalue()).decode("ascii")


def test_text_processor_detects_and_cleans_synthetic_text() -> None:
    with TestClient(app) as client:
        processor = client.app.state.text_processor
        original = synthetic_text_image()
        result = processor._process_sync(original, TextProcessingOptions(enabled=True, cleanup=True))

    assert result.regions
    assert result.mask_pixels > 0
    assert not result.translation_applied
    diff = ImageChops.difference(original, result.image)
    assert diff.getbbox() is not None


def test_text_capabilities_report_no_fake_translation() -> None:
    with TestClient(app) as client:
        response = client.get("/text/capabilities")

    assert response.status_code == 200
    payload = response.json()
    assert payload["cleanupAvailable"] is True
    assert payload["translationAvailable"] is False


def test_text_process_endpoint_returns_cleaned_image_metadata() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/text/process",
            json={
                "imageData": encode_png(synthetic_text_image()),
                "options": {"enabled": True, "cleanup": True, "translate": True},
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["contentType"] == "image/png"
    assert payload["textProcessing"]["regionCount"] > 0
    assert payload["textProcessing"]["translationApplied"] is False
    assert payload["textProcessing"]["warnings"]
