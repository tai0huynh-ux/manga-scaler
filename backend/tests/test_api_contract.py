"""Protect the JSON contract shared by the extension and FastAPI."""

from app.main import app
from app.models.schemas import TextProcessingOptionsRequest, UpscaleRequest


def test_upscale_openapi_uses_browser_field_names() -> None:
    schema = app.openapi()["components"]["schemas"]["UpscaleRequest"]
    properties = schema["properties"]

    assert {
        "imageUrl",
        "imageData",
        "jobId",
        "tileSize",
        "enhanceLevel",
        "maxOutputWidth",
        "maxOutputHeight",
        "outputQuality",
        "textProcessing",
    } <= properties.keys()
    assert "image_url" not in properties
    assert schema["required"] == ["imageUrl"]


def test_upscale_request_round_trips_aliases() -> None:
    payload = {
        "imageUrl": "https://example.com/page.png",
        "imageData": "aW1hZ2U=",
        "jobId": "tab-1-image-2",
        "tileSize": 256,
        "enhanceLevel": 0.4,
        "maxOutputWidth": 1920,
        "maxOutputHeight": 4096,
        "outputQuality": 90,
        "textProcessing": {"enabled": True, "sourceLanguage": "auto", "targetLanguage": "vi"},
    }

    request = UpscaleRequest.model_validate(payload)
    serialized = request.model_dump(by_alias=True, mode="json", exclude_none=True)

    assert serialized["imageUrl"] == payload["imageUrl"]
    assert serialized["jobId"] == payload["jobId"]
    assert serialized["textProcessing"]["targetLanguage"] == "vi"
    assert isinstance(request.text_processing, TextProcessingOptionsRequest)
