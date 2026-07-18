# Current verified state

## Baseline

- Verified date: 2026-07-18, Asia/Bangkok.
- Branch: `main`.
- Current committed baseline before the active worker-recovery checkpoint: `86ef39f`.
- Upstream before the active worker-recovery checkpoint: `origin/main` matched `86ef39f` with zero divergence.
- Repository was clean before the mandatory-state documentation checkpoint.
- Runtime stack: Python 3.12, FastAPI, ONNX Runtime DirectML, Pillow/NumPy, Chrome/Edge MV3.

## Verified quality gate

Full `scripts/verify.ps1` result on the baseline:

- Backend: 47 tests passed.
- Extension: 114 tests passed in the full gate for the active worker-recovery checkpoint.
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
- Dependency-free deterministic reader fixture covering standard, responsive, lazy, dynamic, protected, cross-origin, and explicitly unsupported source categories.
- Extension minimum input dimensions aligned to the documented/shared 300 px contract with boundary regressions.
- Extreme-tall slicing row coverage and safe extreme-wide rejection regressions.
- Automated Edge unpacked-extension E2E against the deterministic fixture with the real DirectML backend/model: two accepted/completed jobs, zero failures, Blob replacement, dynamic discovery, false-positive rejection, and settled queue.
- Reader chrome outside explicit `.page-chapter` containers is rejected on `reading-detail box_doc` readers, preventing a reproduced live-site banner replacement.
- Browser image reads race both the fetch and response body against abort, so a non-cooperative CDN response cannot hold preprocessing slots indefinitely.
- The deterministic reader fixture models exact per-chapter Referer requirements, different bytes at one protected URL, slow and hanging bodies, mid-body disconnects, HTTP 200 non-image payloads, invalid image magic bytes, and abortable large streaming responses.
- Discovery no longer installs broad persistent Referer rules. Browser reads use exact-URL temporary rules, serialize only reads for the same image URL, remove rules on success/failure/abort, and release their per-URL lock after settlement.
- A newly initialized background provider removes interrupted temporary and legacy Referer session rules in the extension-owned ID range before installing a new read rule.

## Known limitations

- Representative live-site validation is still manual.
- `www.hentaivnx.live` reader HTML and Edge discovery were verified, but chapter replacement remains unproven: its CDN returns a redirect without Referer and a JPEG with Referer, while the final worker diagnostic did not yield a stable completion record.
- A current public TruyenQQ reader/chapter URL is not verified; guessed or SEO-shell domains are not acceptance evidence.
- Canvas, CSS backgrounds, and WebGL image sources are outside discovery.
- Persistent extension trace storage and Trace Dashboard are not implemented.
- Artifact capture and reproduction packages are not implemented.
- GPU/VRAM trace sampling is not implemented.
- OCR depends on local Tesseract installation.
- Translation uses an unofficial best-effort Google endpoint and requires network access.
- Backend network exposure is not hardened; keep it loopback-only.
- Native-host generated manifest/executable are machine-specific artifacts even if present in this checkout.

## Next likely work

1. Continue Phase A1 with real Edge navigation and extension-reload acceptance while an exact-URL read rule is active; startup cleanup is unit-proven but worker termination/restart still needs browser evidence.
2. Obtain one current public TruyenQQ reader/chapter URL without a session token.
3. Re-run sanitized Edge acceptance on `www.hentaivnx.live` and the verified TruyenQQ reader with worker-restart-safe evidence capture.
4. Expand the deterministic E2E matrix for backend restart, cancellation, and long-image rendering.
5. Improve focused coverage around model manager, downloader, cache, and full upscaler orchestration.

Update this file whenever a completed change alters the verified baseline, capabilities, limitations, or next priorities.
