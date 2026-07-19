# Current verified state

## Baseline

- Verified date: 2026-07-19, Asia/Bangkok.
- Branch under verification: `codex/live-reader-acceptance-c518` in the isolated `c518` worktree, synchronized by a normal merge from current `origin/main`; main integration has not occurred.
- Starting committed baseline for the protected-read lifecycle checkpoint: `83c0c2e`.
- Upstream before the protected-read lifecycle checkpoint: `origin/main` matched `83c0c2e` with zero divergence.
- Repository was clean before the mandatory-state documentation checkpoint.
- Runtime stack: Python 3.12, FastAPI, ONNX Runtime DirectML, Pillow/NumPy, Chrome/Edge MV3.

## Verified quality gate

Full `scripts/verify.ps1` result after the HTTP 422/browser-owned request checkpoint:

- Backend: 52 tests passed.
- Extension: 148 tests passed.
- JavaScript syntax checks passed.
- Ruff passed.
- Total backend coverage: 72%, above the 45% gate.

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
- Startup cleanup uses the exact temporary-rule signature, preserves unrelated rules, reserves active rule IDs, and is an idempotent barrier for every protected read.
- Browser-read URL matching preserves query order/encoding, strips network-invisible fragments, skips Blob/Data DNR rules, and follows observed HTTP/HTTPS redirect targets with exact rules only.
- Real Edge acceptance stops and reactivates the actual MV3 worker during a stalled protected read, proves orphan cleanup and unrelated-rule preservation, and settles queue/registry/lock state.
- Full same-tab navigation invalidates Chapter A while Chapter B discovers and renders normally with no stale registry entry or residual rule.
- Unpacked-extension reload automatically resumes discovery without a page reload. Reinjectable block-scoped content code and a DOM instance lease prevent stale contexts and duplicate replacements.
- Live Edge acceptance passed on public `truyenqqko.com` for one Manga chapter (64/64 image replacements, including two sliced images) and one Manhua chapter (3/3 replacements, including one sliced image); both runs had zero false positives, duplicate jobs, browser exceptions, and residual Referer rules.
- Reader comment avatars using lazy `noavatar.png` are rejected as UI assets, and live-reader E2E diagnostics redact source URL values while detecting backend uptime/counter resets.
- Processing Monitor schema version 1 is wired through content/background lifecycle events and a bounded sanitized session/local snapshot. `COMPLETED` is emitted only after content confirms the Blob DOM commit; backend receipt remains `RECEIVING_RESULT`.
- Deterministic Edge monitor acceptance now reads the live service-worker snapshot after two Blob replacements, proves renderer-confirmed `COMPLETED` rows, and verifies that image bytes are absent from the snapshot.
- FastAPI validation failures preserve sanitized field/type/message and trace ID; the extension carries them to Dashboard and does not retry HTTP 422.
- Upscale requests are normalized once before dispatch. The reproduced `maxOutputWidth=128` drift clamps to the backend minimum `256`, while non-finite/unsafe fields fail locally without retry.
- Persisted processing settings use an idempotent schema-version-1 migration with bounded known fields and no unknown-key carryover.
- Browser-owned image bytes allow Blob/Data metadata or an omitted source URL; the backend skips URL download whenever decoded `imageData` is present.

## Known limitations

- Representative live-site validation is still partial: Manga and Manhua are verified on `truyenqqko.com`; no Manhwa chapter has completed the gate yet.
- Heavy Manhwa chapters can create hundreds of long-image segment jobs. One run restarted the backend under load; another remained at 71 queued segment jobs after 240 seconds. The gate now reports these conditions instead of claiming completion.
- `www.hentaivnx.live` reader HTML and Edge discovery were verified, but chapter replacement remains unproven: its CDN returns a redirect without Referer and a JPEG with Referer, while the final worker diagnostic did not yield a stable completion record.
- The verified public reader is `truyenqqko.com`; guessed or SEO-shell domains are not acceptance evidence.
- Current public TruyenQQ URLs are verified for One Piece 1188 (Manga), Hive 293 (Manhwa), and Người Trên Vạn Người 320 (Manhua), but live acceptance is not green.
- Hive 293 reached 66/75 stable original-image Blob replacements (88%) with nine detected-but-unreplaced images. Manhua 320 reached 26/26 replacements but earlier runs exposed reader-chrome tracking/avatar false positives.
- The local backend became unresponsive after repeated live runs; hentaivnx and a clean Manga rerun remain unverified.
- Canvas, CSS backgrounds, and WebGL image sources are outside discovery.
- Persistent extension trace storage and Trace Dashboard are not implemented.
- Artifact capture and reproduction packages are not implemented.
- GPU/VRAM trace sampling is not implemented.
- Dashboard now has monitor summary cards, keyed job rows, filters, timeline/detail diagnostics, copy-trace, safe JSON export, and cancel/retry controls. Safe original/enhanced preview policy remains in the existing comparison section; monitor diagnostics never persist image bytes or full source URLs.
- OCR depends on local Tesseract installation.
- Translation uses an unofficial best-effort Google endpoint and requires network access.
- Backend network exposure is not hardened; keep it loopback-only.
- Native-host generated manifest/executable are machine-specific artifacts even if present in this checkout.
- Live reader acceptance for the HTTP 422 checkpoint was not rerun without an `AI_MANGA_LIVE_URL`; current runtime proof is the deterministic Edge fixture with the real loopback backend/model.

## Next likely work

Live-reader checkpoint (2026-07-19): clean Manga 1188 reached 64/64 stable Blob replacements with 68/68 backend completions, zero duplicates/stale replacements, zero false positives, and settled queue/DNR state. Hive 293 remained 66/75 (88%) with nine bottom reader images left in `seen` after controlled viewport passes; Manhua and hentaivnx remain unverified. Extreme-image work is intentionally blocked until this live gate is green.

1. Add real Dashboard E2E assertions for persistence, filters, details, cancel/retry, clear, export, and reload.
2. Add a 500-job browser-render load gate and verify filter/detail latency and bounded retention.
3. Repair the nine detected-but-unreplaced Hive images and rerun Manhwa throughput with a clean backend.
4. Re-run `www.hentaivnx.live` acceptance or record the exact external blocker.

Update this file whenever a completed change alters the verified baseline, capabilities, limitations, or next priorities.
