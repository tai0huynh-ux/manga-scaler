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
        "traceId",
        "operationId",
        "queueKey",
        "attempt",
        "sourceFingerprint",
    } <= properties.keys()
    assert "image_url" not in properties
    assert "imageUrl" not in schema.get("required", [])
    assert "schemaVersion" in properties


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
        "traceId": "trace-1",
        "operationId": "operation-1",
        "queueKey": "tab:image:operation",
        "attempt": 2,
        "sourceFingerprint": "sha256-source",
    }

    request = UpscaleRequest.model_validate(payload)
    serialized = request.model_dump(by_alias=True, mode="json", exclude_none=True)

    assert serialized["imageUrl"] == payload["imageUrl"]
    assert serialized["jobId"] == payload["jobId"]
    assert serialized["traceId"] == payload["traceId"]
    assert serialized["operationId"] == payload["operationId"]
    assert serialized["queueKey"] == payload["queueKey"]
    assert serialized["sourceFingerprint"] == payload["sourceFingerprint"]
    assert serialized["textProcessing"]["targetLanguage"] == "vi"
    assert isinstance(request.text_processing, TextProcessingOptionsRequest)


def test_browser_owned_bytes_allow_blob_data_or_missing_metadata_url() -> None:
    for image_url in [
        None,
        "blob:https://reader.example.test/11111111-1111-1111-1111-111111111111",
        "data:image/png;base64,iVBORw0KGgo=",
    ]:
        payload = {"imageData": "aW1hZ2U="}
        if image_url is not None:
            payload["imageUrl"] = image_url
        request = UpscaleRequest.model_validate(payload)
        assert request.image_data == "aW1hZ2U="


def test_image_url_requires_http_scheme_without_browser_owned_bytes() -> None:
    for payload in [
        {"imageUrl": "file:///private/image.png"},
        {"imageUrl": "blob:https://reader.example.test/id"},
    ]:
        try:
            UpscaleRequest.model_validate(payload)
        except ValueError:
            continue
        raise AssertionError(f"unsafe source accepted: {payload}")
