# AI Manga Upscaler

AI Manga Upscaler is a local-first image upscaling architecture for manga pages. This milestone intentionally does not run AI inference. The backend downloads discovered images, stores them in a SHA256-addressed cache, and returns the original URL. The extension already has viewport-aware scheduling, layered browser caching, abortable processing, Blob URL rendering, and status reporting needed for a future Real-ESRGAN ONNX Runtime implementation.

## Project Layout

```text
ai-manga-upscaler/
  backend/
    app/
      api/              FastAPI route definitions
      core/             Settings and logging
      models/           Pydantic request and response schemas
      services/         Downloader, cache, and upscaler orchestration
        providers.py    Provider protocols for future ONNX integration
      utils/            Small shared backend helpers
    requirements.txt
    run.py
  extension/
    manifest.json       Chrome/Edge Manifest V3 entry point
    popup.html
    src/
      background.js     Priority queue, cache providers, retries, and stats
      config.js         Extension-side runtime defaults
      content.js        Viewport observer, cancellation, and Blob renderer
      popup.js          Popup status controller
    styles/
      popup.css
  shared/
    config/defaults.json
  .env.example
  requirements.txt
```

## Backend

Requirements:

- Python 3.12
- FastAPI
- Uvicorn
- HTTPX

Install and run:

```powershell
cd outputs\ai-manga-upscaler
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd backend
python run.py
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

Upscale placeholder:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8765/upscale `
  -ContentType application/json `
  -Body '{"imageUrl":"https://example.com/image.jpg"}'
```

Expected health response:

```json
{
  "status": "ok"
}
```

The `/upscale` endpoint returns:

```json
{
  "imageUrl": "https://example.com/image.jpg",
  "cacheKey": "sha256-hex-digest",
  "cacheHit": false,
  "contentType": "image/jpeg",
  "bytesWritten": 123456
}
```

## Configuration

Backend environment variables use the `AI_MANGA_UPSCALER_` prefix. Start from `.env.example`:

```powershell
Copy-Item .env.example .env
```

Important settings:

- `AI_MANGA_UPSCALER_CACHE_DIR`: cache directory for downloaded image bytes.
- `AI_MANGA_UPSCALER_REQUEST_TIMEOUT_SECONDS`: backend download timeout.
- `AI_MANGA_UPSCALER_MAX_DOWNLOAD_BYTES`: maximum accepted image size.
- `AI_MANGA_UPSCALER_LOG_LEVEL`: logging verbosity.

Shared defaults live in `shared/config/defaults.json`. The extension currently reads its browser-safe defaults from `extension/src/config.js`; keep both aligned when changing ports, retry settings, or image thresholds.

## Extension

Load in Chrome or Edge:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer Mode.
3. Choose "Load unpacked".
4. Select the `extension` directory.
5. Start the backend on `127.0.0.1:8765`.

The extension:

- Observes DOM mutations.
- Uses `IntersectionObserver` so images are scheduled only when they approach the viewport.
- Prioritizes queued images by distance from the viewport.
- Prefetches upcoming images while the user scrolls.
- Ignores images smaller than 300 px in both dimensions.
- Avoids processing the same image URL twice.
- Sends work to the background queue.
- Limits backend requests to two concurrent jobs.
- Retries failed jobs with exponential backoff.
- Cancels pending or active jobs for images that become far outside the viewport.
- Uses an in-memory LRU cache for hot image payloads.
- Uses IndexedDB for persistent browser-side image payload caching.
- Replaces images with Blob URLs, not direct remote `src` assignment.
- Preserves original `src`, `srcset`, `sizes`, and `picture source` metadata before replacement.
- Preserves displayed width and height during replacement.
- Applies a short fade transition when the Blob URL is rendered.
- Provides an enable/disable toggle in the popup.

Popup statistics include:

- Queue size
- Processing count
- Waiting count
- Processed count
- Error count
- Cache hits
- Average latency
- Cache hit ratio

## Architecture Abstractions

The extension is split around production-facing abstractions:

- `ImageProvider`: extracts image URLs, dimensions, and responsive image metadata.
- `UpscaleProvider`: calls the local backend and returns image bytes for rendering.
- `CacheProvider`: composes in-memory LRU and IndexedDB caches.
- `Renderer`: turns response bytes into Blob URLs and performs safe replacement.
- `QueueScheduler`: prioritizes, retries, aborts, and dispatches image jobs.

The backend also defines provider protocols in `backend/app/services/providers.py`:

- `ImageProvider`
- `CacheProvider`
- `UpscaleProvider`

## Future ONNX Runtime Path

The intended integration point is `backend/app/services/upscaler.py`. Replace the milestone-one passthrough with a Real-ESRGAN inference adapter that accepts cached image bytes or paths and returns a generated cache artifact. The browser extension should not need structural changes because it already consumes the stable `/upscale` response contract and renders whatever bytes the active `UpscaleProvider` returns.

Recommended next files for the AI milestone:

- `backend/app/services/inference.py`
- `backend/app/services/model_registry.py`
- `backend/app/models/inference.py`
- `backend/models/`

## Notes

This project is designed for a trusted local machine. Before exposing the backend to a network, add stricter origin policy, URL allow/deny rules, SSRF protection, and authenticated access.
