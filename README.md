# Universal AI Image Enhancer

Universal AI Image Enhancer is a local-first image enhancement service for manga, anime/artwork, and photos. It runs ONNX Runtime with automatic DirectML, CUDA, or CPU provider selection. Images are downloaded, classified when Auto Mode is active, processed with a mode-specific Real-ESRGAN model and profile, encoded as WebP, cached, and returned to the browser extension.

## Universal modes

- **Manga:** Real-ESRGAN anime 6B with grayscale preservation and stronger line/text enhancement.
- **Anime / Artwork:** Real-ESRGAN anime 6B with color-preserving artwork enhancement.
- **Photo:** General Real-ESRGAN x4 for photographic textures.
- **Auto:** Uses grayscale ratio, saturation, edge density, and palette complexity to select one of the modes per image.

Both production models download automatically on first use and are pinned by SHA-256. Auto classification is deterministic and local; no image is sent to a third-party classification service.

The extension reads the browser's currently selected `currentSrc` bytes using the page/browser HTTP cache, cookies, and extension host permissions. It sends those bytes to the local backend as `imageData`; the backend therefore does not need to re-download protected image URLs. After inference completes, only the corresponding `<img>` element is replaced with the enhanced WebP blob.

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
Invoke-RestMethod http://127.0.0.1:8766/health
```

Upscale an image:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8766/upscale `
  -ContentType application/json `
  -Body '{"imageUrl":"https://example.com/image.jpg"}'
```

The health response includes the active provider/model, GPU diagnostics, queue and cache state, and uptime. The `/upscale` response retains its Phase 1 fields and adds model, provider, scale, output dimensions, per-stage timings, memory, queue statistics, and optional `traceId` correlation.

Trace Core MVP accepts optional `traceId`, `operationId`, `queueKey`, `attempt`, and `sourceFingerprint` request metadata. Older requests without trace metadata still work, and the backend creates a fallback trace ID. Backend trace events are written as append-only JSONL to `backend/logs/trace.jsonl` by default and never include raw image bytes or base64 payloads.

Compatible models use float32 RGB NCHW input and output. Configured filenames are `anime_x2.onnx`, `anime_x4.onnx`, and `general_x4.onnx`; only the selected model must be installed. The service starts without model files so `/health` remains available, while an unavailable requested model returns HTTP 503.

`anime_x4` and `general_x4` are configured for automatic download on first use. Downloads are written atomically and accepted only when their SHA-256 matches `config.json`. `anime_x2` remains an optional local slot.

Control total enhancement work with `enhanceLevel` from `0.0` to `1.0`. Values from `0.0` through `0.10` use the model-free Lanczos path and fast WebP encoding. Values from `0.15` through `1.0` use neural reconstruction for every output preset; higher values increase neural input detail, blend weight, sharpening, and contrast. `1.0` is intentionally extreme and may introduce halos or visible distortion:

```json
{
  "imageUrl": "https://example.com/page.jpg",
  "model": "anime_x4",
  "tileSize": 256,
  "enhanceLevel": 0.35
}
```

For manga line art, start around `0.2-0.4`. Use `0.05` when scrolling speed matters most. Values near `1.0` deliberately favor a dramatic result over fidelity.

## Configuration

Backend runtime settings live in `backend/config.json`. This includes paths, download limits, model registry, provider preference, tile/batch/worker limits, WebP encoding, rotating JSON logs, and Trace Core settings. Relative paths are resolved from the backend directory.

Trace settings live under `trace`: `enabled`, `file`, and `includeStack`. When tracing is disabled, trace calls become no-ops and the image pipeline behavior is unchanged.

Shared defaults live in `shared/config/defaults.json`. The extension currently reads its browser-safe defaults from `extension/src/config.js`; keep both aligned when changing ports, retry settings, or image thresholds.

## Extension

Load in Chrome or Edge:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer Mode.
3. Choose "Load unpacked".
4. Select the `extension` directory.
5. Start the backend on `127.0.0.1:8766`.

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
- `core/tracing.py` emits small JSONL trace events for request, queue, upscaler, cache, and tile-plan boundaries.

Run backend tests with `cd backend; ..\.venv\Scripts\python.exe -m pytest -q`.

Run the deterministic reader and real unpacked-extension Edge gate with:

```powershell
npm.cmd run fixture:reader
npm.cmd run test:e2e:edge-fixture
```

The E2E command requires the backend to be online at `127.0.0.1:8766` with pipeline version `4` and a compatible model. It launches an isolated temporary Edge/Chrome profile, loads the unpacked extension, upscales synthetic PNG images through the real backend, and verifies replacement plus queue settlement. It does not use copyrighted fixtures or live websites.

## Automatic backend startup

Chrome and Edge require a one-time Native Messaging registration before an extension may start a local process. After loading the unpacked extension, copy its ID from `chrome://extensions` or `edge://extensions`, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\native-host\install.ps1 -ExtensionId "YOUR_EXTENSION_ID"
```

Reload the extension afterward. When its enable switch is turned on, it checks `/health` and starts the backend through the registered native host when needed. The popup displays `Backend start failed` with the native error in its tooltip if registration, the virtual environment, or startup fails.

The installer compiles a small native launcher that runs without a PowerShell or Command Prompt window. Backend output continues to use the configured rotating JSON log file; no terminal window is required while the extension is enabled.

When upgrading from the older batch-file launcher, fully close Chrome/Edge once after rerunning the installer so no browser process retains the previous native-host manifest.

Per-image processing timeout is configurable from 5 to 300 seconds in both popup and Dashboard. Timed-out work is cancelled, moved behind normal images, and retried after other work. Closing a tab or navigating that tab to another page cancels queued, active, and delayed-retry jobs belonging to the old page.

Output sizing supports Manual Pixel limits, automatic sizing from the rendered image/viewport/screen/DPR, and HD, Full HD, 2K, or 4K screen presets with automatic, landscape, or portrait orientation. Input minimum and maximum width/height filters reject unsuitable images before their bytes are sent to the backend. WebP quality is adjustable from 50 to 100. Performance Boost uses larger inference tiles on models that support them; disable it if GPU memory is constrained.

Browser preprocessing and backend upscale-request concurrency are configured separately. Browser image reads time out instead of blocking the pipeline. Failed jobs are marked deferred and remain behind every normal image until ordinary work is exhausted, then retry with exponential delay.

The extension watchdog checks the backend and content-script connection every 30 seconds. Every upscale also performs a just-in-time backend health/start check. After an unpacked-extension reload, stale content scripts in already-open HTTP(S) tabs are detected and replaced automatically, so those tabs can resume discovery without a manual page refresh.

Every eligible page image has a `Block AI` button. Blocking stores the normalized image URL without its temporary query token, cancels current work, and prevents that image from being enhanced on later visits. Dashboard settings list blacklist entries and allow removing them.

## Notes

This project is designed for a trusted local machine. Before exposing the backend to a network, add stricter origin policy, URL allow/deny rules, SSRF protection, and authenticated access.
