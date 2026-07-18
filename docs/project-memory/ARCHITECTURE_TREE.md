# Architecture tree

## System boundary

```text
Browser page
└─ MV3 content script
   ├─ discovers and filters <img> elements
   ├─ owns preprocessing priority and long-image transactions
   └─ renders completed bytes through Blob URLs
      ↓ Chrome runtime messages
MV3 background service worker
├─ owns backend-job scheduling, retry, cancellation, and browser caches
├─ reads protected image bytes with browser credentials/cache
├─ starts the local backend through Native Messaging
└─ maintains page registry and extension statistics
      ↓ HTTP on 127.0.0.1:8765
FastAPI backend
├─ validates browser-compatible request aliases
├─ queues inference work and propagates trace identity
├─ decodes, classifies, optionally cleans/translates text
├─ loads ONNX models and selects DirectML/CUDA/CPU
├─ runs tiled inference, enhancement, quality analysis, and WebP encoding
└─ publishes deterministic cache artifacts
```

## Repository ownership tree

```text
ai-manga-upscaler/
├─ extension/
│  ├─ manifest.json                 MV3 permissions and entry points
│  ├─ src/config.js                 Browser-safe runtime defaults
│  ├─ src/content.js                Discovery, preprocessing, slicing, rendering
│  ├─ src/background.js             Queue, cache, backend bridge, registry, stats
│  ├─ src/popup.js                  Compact health/settings/statistics controller
│  ├─ src/dashboard.js              Current-tab image registry and comparison UI
│  ├─ popup.html, dashboard.html    Extension pages
│  ├─ styles/                       Popup and dashboard presentation
│  └─ tests/                        VM-based browser logic regression suite
├─ backend/
│  ├─ run.py                        Development Uvicorn entry point
│  ├─ config.json                   Backend runtime/model/text/trace settings
│  ├─ app/main.py                   FastAPI factory and service lifecycle
│  ├─ app/api/routes.py             Health, upscale, text, model, cancel endpoints
│  ├─ app/models/schemas.py         Browser/FastAPI JSON contract
│  ├─ app/core/config.py            Typed configuration and validation
│  ├─ app/core/logging.py           Rotating JSON operational logs
│  ├─ app/core/tracing.py           Append-only safe correlation events
│  ├─ app/services/
│  │  ├─ upscaler.py                End-to-end backend orchestration
│  │  ├─ inference_queue.py         Bounded async queue and job settlement
│  │  ├─ model_manager.py           ONNX singleton, download, warmup, reload
│  │  ├─ gpu_provider.py            Provider selection and disable/fallback state
│  │  ├─ image_pipeline.py          Decode, tile, infer, merge, enhance, encode
│  │  ├─ image_classifier.py        Deterministic auto-mode classifier
│  │  ├─ text_processor.py          Cleanup, OCR probe, translation, render, memory
│  │  ├─ downloader.py              Remote fallback download validation
│  │  ├─ cache.py                   Atomic deterministic artifact publishing
│  │  ├─ quality.py                 Bicubic comparison metrics
│  │  ├─ statistics.py              Timings, process memory, uptime
│  │  └─ providers.py               Protocol abstractions
│  ├─ models/README.md              Model artifact contract
│  └─ tests/                        Backend unit/API/queue/pipeline tests
├─ native-host/
│  ├─ install.ps1                   Compile/register Chrome and Edge host
│  ├─ NativeHost.cs                 Hidden native message relay executable
│  └─ launcher.py                   Health check and detached backend startup
├─ shared/config/defaults.json      Cross-component reference defaults
├─ scripts/verify.ps1               Fast and full quality gates
├─ scripts/auto-git-update.ps1      Secret-aware commit and push workflow
├─ docs/                            Product state, decisions, roadmap, memory
├─ pyproject.toml                   Pytest, coverage, Ruff configuration
└─ package.json                     JavaScript syntax and extension tests
```

## High-value class ownership

### Content script

- `ImageProvider`: candidate metadata, responsive sources, dimension and UI/ad filtering.
- `Renderer`: Blob ownership, render transaction rollback, responsive metadata preservation, raw-slice DOM transaction.
- `ViewportImageProvider`: discovery, operation identity, preprocessing scheduler, slicing orchestration, completion authority.

### Background service worker

- `StatisticsTracker`: durable lifetime counters plus in-memory per-tab counters.
- `PageImageRegistry`: operation-aware current-page records and dashboard data.
- `MemoryCacheProvider` and `IndexedDBCacheProvider`: hot and persistent browser caches.
- `CompositeCacheProvider`: cache lookup/promotion facade.
- `BackendUpscaleProvider`: browser byte read, backend request, timeout, output fetch, backend cancel.
- `QueueScheduler`: operation-keyed queue, concurrency, retry, preemption, cancellation, completion delivery.

### Backend

- `UpscalerService`: source acquisition through final response and provider recovery.
- `InferenceQueue`: async job lifecycle and counters.
- `ModelManager`: process model sessions and provider-bound reloads.
- `ImagePipeline`: CPU preparation and ONNX tiled execution.
- `TextProcessor`: conservative cleanup and optional OCR/translation pipeline.
