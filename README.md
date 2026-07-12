# AI Manga Upscaler

AI Manga Upscaler is a local-first image upscaling service for manga pages. Phase 2 runs production-oriented ONNX Runtime inference with automatic DirectML, CUDA, or CPU provider selection. Images are downloaded, decoded with Pillow, processed in overlapping tiles, merged, encoded as WebP, cached, and returned to the existing browser extension.

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
- ONNX Runtime DirectML
- Pillow and NumPy

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

Upscale an image:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8765/upscale `
  -ContentType application/json `
  -Body '{"imageUrl":"https://example.com/image.jpg"}'
```

The health response includes the active provider/model, GPU diagnostics, queue and cache state, and uptime. The `/upscale` response retains its Phase 1 fields and adds model, provider, scale, output dimensions, per-stage timings, memory, and queue statistics.

Place compatible NCHW RGB float32 ONNX models in `backend/models/` before sending inference requests. Required configured filenames are `anime_x2.onnx`, `anime_x4.onnx`, and `general_x4.onnx`. The service starts without model files so `/health` remains available, while inference returns HTTP 503 until the requested model is installed.

## Configuration

Backend runtime settings live in `backend/config.json`. This includes paths, download limits, model registry, provider preference, tile/batch/worker limits, WebP encoding, and rotating JSON logs. Relative paths are resolved from the backend directory.

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

## Phase 2 inference architecture

- `gpu_provider.py` selects DirectML, CUDA, then CPU according to configuration and runtime availability.
- `model_manager.py` owns the process singleton, lazy loading, warmup, switching, and file-mtime hot reload.
- `image_pipeline.py` implements RGB decode, padded overlapping tiles, ONNX batch inference, overlap averaging, and WebP encoding.
- `inference_queue.py` provides a bounded async queue, dynamic collection window, worker pool, and global inference semaphore.
- `statistics.py` reports download, decode, inference, GPU, encode, total latency, and process memory.

Run backend tests with `cd backend; ..\.venv\Scripts\python.exe -m pytest -q`.

## Notes

This project is designed for a trusted local machine. Before exposing the backend to a network, add stricter origin policy, URL allow/deny rules, SSRF protection, and authenticated access.
