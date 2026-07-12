# Universal AI Image Enhancer

Universal AI Image Enhancer is a local-first image enhancement service for manga, anime/artwork, and photos. It runs ONNX Runtime with automatic DirectML, CUDA, or CPU provider selection. Images are downloaded, classified when Auto Mode is active, processed with a mode-specific Real-ESRGAN model and profile, encoded as WebP, cached, and returned to the browser extension.

## Universal modes

- **Manga:** Real-ESRGAN anime 6B with grayscale preservation and stronger line/text enhancement.
- **Anime / Artwork:** Real-ESRGAN anime 6B with color-preserving artwork enhancement.
- **Photo:** General Real-ESRGAN x4 for photographic textures.
- **Auto:** Uses grayscale ratio, saturation, edge density, and palette complexity to select one of the modes per image.

Both production models download automatically on first use and are pinned by SHA-256. Auto classification is deterministic and local; no image is sent to a third-party classification service.

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

Compatible models use float32 RGB NCHW input and output. Configured filenames are `anime_x2.onnx`, `anime_x4.onnx`, and `general_x4.onnx`; only the selected model must be installed. The service starts without model files so `/health` remains available, while an unavailable requested model returns HTTP 503.

`anime_x4` and `general_x4` are configured for automatic download on first use. Downloads are written atomically and accepted only when their SHA-256 matches `config.json`. `anime_x2` remains an optional local slot.

Control post-processing per request with `enhanceLevel` from `0.0` to `1.0`. `0` preserves the neural output, the default is `0.35`, and `1` applies the full sharpness, contrast, color, and denoise values from the `enhancement` section of `backend/config.json`:

```json
{
  "imageUrl": "https://example.com/page.jpg",
  "model": "anime_x4",
  "tileSize": 256,
  "enhanceLevel": 0.35
}
```

For manga line art, start around `0.2–0.4`. Higher sharpness can make screentones and JPEG artifacts harsher; increase `denoise` cautiously when the source is compressed.

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
