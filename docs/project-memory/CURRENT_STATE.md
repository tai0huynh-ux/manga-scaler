# Current verified state

## Baseline

- Verified date: 2026-07-18, Asia/Bangkok.
- Branch: `main`.
- Recovered baseline commit: `7b8da56`.
- Upstream after recovery: `origin/main` matched `7b8da56` with zero divergence.
- Repository was clean before the mandatory-state documentation checkpoint.
- Runtime stack: Python 3.12, FastAPI, ONNX Runtime DirectML, Pillow/NumPy, Chrome/Edge MV3.

## Verified quality gate

Full `scripts/verify.ps1` result on the baseline:

- Backend: 47 tests passed.
- Extension: 98 tests passed.
- JavaScript syntax checks passed.
- Ruff passed.
- Total backend coverage: 71%, above the 45% gate.

Git integrity recovery also passed `git fsck --full` after injected `desktop.ini` files were moved to a recoverable external backup. Git reported one dangling blob but no corruption.

## Implemented capabilities

- Viewport-aware `<img>` discovery and preprocessing.
- Operation-aware stale-result protection across content, background, and backend.
- Transactional long-image slicing with full-image fallback.
- Browser byte reads using cache, credentials, host permissions, and temporary Referer rules.
- Background memory plus IndexedDB caching and deterministic cache variants.
- Bounded retries, deferred work, cancellation, tab-generation cleanup, and statistics.
- FastAPI health, upscale, cancel, model status/switch/reload, comparison, and text endpoints.
- Auto manga/artwork/photo classification.
- ONNX model download/checksum/load/warmup/hot reload and provider fallback.
- Tiled inference, post-enhancement, WebP output, original cache, and quality metrics.
- Conservative text cleanup, optional Tesseract OCR, online translation, rendering, and local translation memory.
- Trace Core correlation with durable backend JSONL events and transient extension events.
- Native Messaging backend startup for Chrome and Edge.

## Known limitations

- Browser-level representative-site validation is still manual.
- Canvas, CSS backgrounds, and WebGL image sources are outside discovery.
- Persistent extension trace storage and Trace Dashboard are not implemented.
- Artifact capture and reproduction packages are not implemented.
- GPU/VRAM trace sampling is not implemented.
- OCR depends on local Tesseract installation.
- Translation uses an unofficial best-effort Google endpoint and requires network access.
- Backend network exposure is not hardened; keep it loopback-only.
- Native-host generated manifest/executable are machine-specific artifacts even if present in this checkout.

## Next likely work

1. Build the deterministic offline reader fixture and boundary/extreme-aspect tests.
2. Run real Chrome/Edge validation on representative manga and webtoon hosts.
3. Record anti-hotlink/browser-read failures with structured logs and network evidence.
4. Add site-specific handling only for repeatable, evidenced incompatibilities.
5. Improve focused coverage around model manager, downloader, cache, and full upscaler orchestration.

Update this file whenever a completed change alters the verified baseline, capabilities, limitations, or next priorities.
