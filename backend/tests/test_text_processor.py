"""Tests for local text cleanup and translation capability reporting."""

import base64
import io

from app.main import app
from app.services.text_processor import TextProcessingOptions, TextProcessor, TextRegion
from fastapi.testclient import TestClient
from PIL import Image, ImageChops, ImageDraw


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
    assert payload["translationAvailable"] is True
    assert payload["translationProvider"]


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


def test_text_processor_renders_translated_ocr_text(monkeypatch) -> None:
    with TestClient(app) as client:
        processor = client.app.state.text_processor
        original = synthetic_text_image()

        monkeypatch.setattr(
            processor,
            "capabilities",
            lambda: {
                "cleanupAvailable": True,
                "ocrAvailable": True,
                "ocrEngine": "tesseract",
                "tesseractPath": "tesseract",
                "pytesseractAvailable": True,
                "translationAvailable": True,
                "translationProvider": "test",
                "message": "test",
            },
        )
        monkeypatch.setattr(
            processor,
            "_recognize_text_regions",
            lambda *_args: [TextRegion(x=66, y=52, width=150, height=36, area=5400, confidence=0.9, text="HELLO AI")],
        )
        monkeypatch.setattr(processor, "_translate_text", lambda *_args: "Xin chao AI")

        result = processor._process_sync(original, TextProcessingOptions(enabled=True, cleanup=True, translate=True))

    assert result.translation_applied is True
    assert result.regions[0].text == "HELLO AI"
    assert result.regions[0].translated_text == "Xin chao AI"
    diff = ImageChops.difference(original, result.image)
    assert diff.getbbox() is not None


def test_translation_history_reuses_and_reloads_saved_translations(tmp_path, monkeypatch) -> None:
    with TestClient(app) as client:
        config = client.app.state.text_processor.config

    history_path = tmp_path / "translation-history.jsonl"
    processor = TextProcessor(config, history_path=history_path)
    calls = []

    def fake_translate(text, source_language, target_language, context=None):
        calls.append({"text": text, "context": context or []})
        return f"vi:{text}"

    monkeypatch.setattr(processor, "_translate_text", fake_translate)

    assert processor._translate_text_with_memory("HELLO AI", "auto", "vi") == "vi:HELLO AI"
    assert processor._translate_text_with_memory("HELLO AI", "auto", "vi") == "vi:HELLO AI"
    assert len(calls) == 1
    assert history_path.exists()

    reloaded = TextProcessor(config, history_path=history_path)
    monkeypatch.setattr(reloaded, "_translate_text", lambda *_args, **_kwargs: "should-not-run")

    assert reloaded._translate_text_with_memory("HELLO AI", "auto", "vi") == "vi:HELLO AI"


def test_translation_history_supplies_recent_context(tmp_path, monkeypatch) -> None:
    with TestClient(app) as client:
        config = client.app.state.text_processor.config

    processor = TextProcessor(config, history_path=tmp_path / "translation-history.jsonl")
    contexts = []

    def fake_translate(text, source_language, target_language, context=None):
        contexts.append(context or [])
        return f"vi:{text}"

    monkeypatch.setattr(processor, "_translate_text", fake_translate)

    processor._translate_text_with_memory("First line", "auto", "vi")
    processor._translate_text_with_memory("Second line", "auto", "vi")

    assert contexts[0] == []
    assert contexts[1] == ["First line => vi:First line"]
