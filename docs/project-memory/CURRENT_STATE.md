# Current verified state

## Baseline

- Verified date: 2026-07-22, Asia/Bangkok.
- Current green feature checkpoint: pipeline v4 makes `0-10%` a model-free fast path and scales neural compute, contribution, and finishing from `15-100%`, while preserving exact output geometry, whole-page ahead draining, canonical duplicate suppression, responsive slicing, stale-runtime rejection, and the collapsible Processing Monitor. The starting committed baseline is `6d4c1b50cc6ba0cd2b6c6c702f042932547b33f0`; this verified change set awaits the mandatory repository auto-sync.
- Branch: `main`; backend restart/cancellation integration commit: `edd461eecafd2807335f70f08f6b607a856c9ce4`.
- Green live-reader/geometry baseline before Monitor integration: `9ada89648003c3d5aa1bbeacc6948290aa49fac0`.
- Starting committed baseline for the protected-read lifecycle checkpoint: `83c0c2e`.
- Upstream before the protected-read lifecycle checkpoint: `origin/main` matched `83c0c2e` with zero divergence.
- Repository was clean before the mandatory-state documentation checkpoint.
- Runtime stack: Python 3.12, FastAPI, ONNX Runtime DirectML, Pillow/NumPy, Chrome/Edge MV3.

## Verified quality gate

Full `scripts/verify.ps1` result on the pipeline-v4 strength-compute change set:

- Backend: 69 tests passed, including model-free 5% routing, monotonic and hard-capped neural input compute, exact-size neural composition, aggressive 100% finishing, fast WebP encoding, O(1) health cache accounting, and queue/lifecycle races.
- Extension: 216 tests passed, including exact slider payload persistence, pipeline-v4 rejection, cache isolation, Processing Monitor interactions, whole-page ahead behavior, canonical duplicate ownership, responsive slicing, protected reads, and operation identity.
- JavaScript syntax checks passed.
- Ruff passed.
- Total backend coverage: 77%, above the 45% gate; `inference_queue.py` is at 92%.
- Real Edge unpacked-extension E2E passed with the DirectML backend: `768x32768` rendered through 55/55 ready slices, `2048x1200` rendered through two responsive 50% tiles inside a 735 px wrapper, browser exceptions were zero, and queue/rules/lifecycle state settled.

Git integrity recovery also passed `git fsck --full` after injected `desktop.ini` files were moved to a recoverable external backup. Git reported one dangling blob but no corruption.

## Implemented capabilities

- Viewport-aware `<img>` discovery and preprocessing.
- User-configurable page-load ahead processing: after `window.load`, each page snapshots eligible images once, sorts by viewport distance/page order, keeps one owner per canonical source URL, and drains every unique source through the bounded active-owner limit; later dynamic images wait for normal viewport/prefetch promotion.
- Disabled content scripts stay dormant. Enable notifications are idempotent, detach/re-observe existing images without duplicate load listeners, run the initial ahead pass only if it has not already run for that page, and continue skipping completed image keys.
- `IntersectionObserver` owns viewport promotion. Scroll/resize refreshes only the bounded preprocessing waiters instead of traversing every discovered image and forcing layout reads.
- Background settings are loaded once, updated through `storage.onChanged`, and protected against an older in-flight read overwriting a newer enable change. `IMAGE_SEEN` and `ENQUEUE_IMAGE` no longer read extension settings once per image.
- Processing Monitor active history is capped at 500. Hot session snapshots are coalesced at 100 ms, local checkpoints at 5 seconds, and terminal events request a 250 ms durable checkpoint; explicit retry/clear/recovery operations flush immediately.
- `IMAGE_SEEN` statistics increments are batched into one storage update per 100 ms burst.
- Backend `/health` uses an in-memory artifact-name set initialized once by `ImageCache`; request-time file counting is O(1) and new cache writes update the set.
- Operation-aware stale-result protection across content, background, and backend.
- Transactional long-image slicing with full-image fallback.
- A source-header geometry check promotes constrained or stale-DOM PNG/JPEG/WebP/GIF images into slicing before a full-image request can collapse an extreme page to the backend output-height cap.
- User-configurable two-dimensional slicing with exact source X/Y/width/height identity and positioned DOM tile reconstruction; the default `8192` width preserves normal vertical manga slicing.
- Full-image Blob rendering uses the actual rendered rectangle, responsive width, automatic height, and preserved aspect ratio instead of stale HTML width/height attributes.
- Slice crop/encode work yields between segments to keep browser input and scrolling responsive. Wrappers use percentage geometry and CSS containment; the original page stays visible while raw slices and segment jobs register, then one activation swaps in the wrapper before enhanced results arrive. Exact raw nodes are replaced progressively, and any segment failure still rolls back the entire group.
- Browser byte reads using cache, credentials, host permissions, and temporary Referer rules.
- Background memory plus IndexedDB caching and deterministic cache variants.
- Bounded retries, deferred work, cancellation, tab-generation cleanup, and statistics.
- FastAPI health, upscale, cancel, model status/switch/reload, comparison, and text endpoints.
- Auto manga/artwork/photo classification.
- Model-free Lanczos/Pillow output at `0-10%`, including minimum-effort WebP encoding, exact aspect-safe geometry, truthful zero-GPU reporting, and no model resolution for any preset.
- Strength-scaled neural input detail from `15-100%`, bounded to `500,000` pixels, composed back to the exact Lanczos target with nonlinear blending and progressively aggressive finishing. Extension cache namespace `pipeline:v4-strength-compute` excludes weak v3 results.
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
- Clean Edge live acceptance passed TruyenQQ Manga, Manhwa, Manhua, and hentaivnx with 100% eligible-image replacement and zero duplicate/stale work, false positives, failures, residual Referer rules, or unsettled queues.
- The deterministic geometry matrix covers eight minimum/boundary inputs, row-complete vertical slicing for `512x16384` and `768x32768`, and safe non-slicing rejection for `16384x512` and `32768x768`; fixture PNG dimensions are verified without tracked binary assets.
- Settings schema version 4 persists `aheadProcessingEnabled`, `aheadProcessingImageLimit` (default 3), and `prefetchMarginPx` with bounded migration and Popup/Dashboard controls; pre-v4 false values restore the one-shot page-load default once.
- Real Edge one-shot lookahead acceptance committed an offscreen image at `rectTop=3200` and `viewportDistance=2715` with `scrollY=0`; queue/rules settled and browser exceptions remained zero.
- Upscale requests are normalized once before dispatch. The reproduced `maxOutputWidth=128` drift clamps to the backend minimum `256`, while non-finite/unsafe fields fail locally without retry.
- Persisted processing settings use an idempotent schema-version-1 migration with bounded known fields and no unknown-key carryover.
- Browser-owned image bytes allow Blob/Data metadata or an omitted source URL; the backend skips URL download whenever decoded `imageData` is present.
- Dashboard browser acceptance now proves summary counts, status/stage/site/tab/search filters, sanitized 422 details/export, linked retry attempts, real queue/backend cancellation, terminal clearing, reload recovery, an accessible detail-pane collapse/restore interaction that preserves diagnostics, and 500 synthetic-job render/filter/detail latency.
- Backend queue shutdown cancels active, queued, and queue-capacity-blocked submitters, clears tracked jobs/futures before restart, and uses exact object ownership so stale same-ID completion cannot remove a newer job.
- FastAPI lifecycle acceptance proves an active HTTP upscale can be cancelled through `DELETE /jobs/{job_id}`, the queue settles, and the next application lifespan starts workers with no stale job.

## Known limitations

- Live-site acceptance is point-in-time and may drift with external markup, advertisements, CDN policy, or anti-bot changes.
- Real Edge rendered the `768x32768` geometry case through vertical slicing with 55 raw slices and 55/55 ready Blob replacements; repeated interrupted runs can leave heavy backend work queued and are not acceptance evidence.
- Real Edge rendered a `2048x1200` source as two positioned horizontal tiles at a configured `1024px` source-slice width, with both Blob replacements ready and the queue settled.
- Canvas, CSS backgrounds, and WebGL image sources are outside discovery.
- Persistent extension trace storage and Trace Dashboard are not implemented.
- Artifact capture and reproduction packages are not implemented.
- GPU/VRAM trace sampling is not implemented.
- Dashboard now has monitor summary cards, keyed job rows, filters, a collapsible timeline/detail pane, copy-trace, safe JSON export, and cancel/retry controls. Safe original/enhanced preview policy remains in the existing comparison section; monitor diagnostics never persist image bytes or full source URLs.
- OCR depends on local Tesseract installation.
- Translation uses an unofficial best-effort Google endpoint and requires network access.
- Backend network exposure is not hardened; keep it loopback-only.
- Native-host generated manifest/executable are machine-specific artifacts even if present in this checkout.
- Live reader acceptance for the HTTP 422 checkpoint was not rerun without an `AI_MANGA_LIVE_URL`; current runtime proof is the deterministic Edge fixture with the real loopback backend/model.
- The lag and malformed-image checkpoints are verified by automated regression, full repository gates, and deterministic Edge E2E; a new long-duration live-browser performance soak on the exact reported reader has not yet been recorded.

## Next likely work

Live-reader checkpoint (2026-07-19): TruyenQQ Manga passed `22/22`, Manhwa `75/75`, Manhua `26/26`, and hentaivnx `16/16`. All four runs had zero false positives, duplicate jobs, stale replacements, sanitized failures, residual Referer rules, and unsettled queue state. The deterministic Edge worker/navigation/reload lifecycle remained green.

1. Improve focused model-manager/downloader/upscaler coverage.
2. Run longer reliability soak and production-quality benchmarks before release claims.

Update this file whenever a completed change alters the verified baseline, capabilities, limitations, or next priorities.
## Previous verified delta (2026-07-20)

- Page-load ahead processing now waits for `window.load`, snapshots eligible images once, assigns one owner per canonical source URL, and drains every unique snapshot source through the configured active-owner limit. Later dynamic images use normal viewport/prefetch promotion; duplicate source nodes stay suppressed even when rendered dimensions differ.
- Slice wrappers activate after raw slices and all segment jobs register successfully, before enhanced results arrive. Enhanced results replace exact raw nodes progressively; rollback remains group-atomic and releases the next ahead slot on success, failure, cancellation, fallback, slice completion, disable, and page hide.
- Verification is green: focused and full gates now cover `59` backend tests and `208` extension tests, plus Ruff, JavaScript syntax, and `73%` backend coverage; Edge E2E has zero browser exceptions, `55/55` tall slices, two responsive wide tiles, and settled queue/Referer/worker/navigation/reload state.

## Latest verified delta (2026-07-21)

- Reproduced the reported 5% case from local artifacts: an `800x1583` source became a `544x1080` result after the anime model received only about `136x270`, visibly corrupting dialogue glyphs.
- Screen `auto` orientation now follows source geometry. Automatic sizing caps DPR at `1.5` and uses a `1.15` detail multiplier instead of unbounded high-DPI expansion.
- Requested targets at or below `1.5x` use Lanczos/Pillow instead of neural inference. A direct API check produced `546x1080`, reported `model=lanczos`, `provider=Pillow`, `gpu=0`, and preserved the reproduced dialogue geometry.
- Full verification passed `60` backend tests, `210` extension tests, JavaScript checks, Ruff, and `73%` backend coverage. Real Edge E2E passed with zero browser exceptions, `55/55` tall slices, two responsive wide tiles, and settled queue/Referer/worker/navigation/reload state.

## Latest Dashboard interaction delta (2026-07-21)

- The Processing Monitor header now exposes a semantic `Hide details` / `Show details` control with `aria-controls` and synchronized `aria-expanded` state.
- Collapsing hides only the detail aside, expands the jobs table to the full monitor width, and preserves the selected job, timeline, and sanitized diagnostics for immediate restoration.
- Focused Dashboard regression passed `5/5`; fast verification passed `60` backend and `211` extension tests. A clean Edge E2E rerun clicked both states, preserved detail content, reported zero browser exceptions, rendered `55/55` tall slices and two responsive wide tiles, and settled queue, Referer, worker, navigation, and reload state.

## Previous strength and stale-runtime delta (2026-07-21)

- `/health` now exposes `pipelineVersion=3`; the extension and Native Messaging launcher require it and use the dedicated `127.0.0.1:8766` endpoint, so the pre-fix `8765` process is not accepted.
- Neural requests build a same-size Lanczos baseline and blend by `enhanceLevel`; `0%`, `5%`, and `100%` behavior is covered by unit tests. Browser-owned PNG originals reuse submitted bytes and output cache identities use `pipeline:v3-strength-blend`.
- Schema-4 settings migration restores whole-page ahead processing for old persisted settings, defaults to three active ahead owners, preserves later explicit disables, and keeps the existing one-shot snapshot/canonical duplicate contract.
- Fast verification passed `64` backend tests, `214` extension tests, JavaScript checks, Ruff, and coverage gates. The reproduced `800x1741 -> 884x1920` API benchmark returned `lanczos`/`Pillow`, zero GPU time, `882x1920`, `3.28 ms` input-cache work, and `354.21 ms` total latency. Edge fixture E2E passed with `55/55` tall slices, two wide tiles, zero browser exceptions, and settled queues; one earlier run hit the fixture's known worker-stop timing race.

## Latest strength-compute delta (2026-07-22)

- Root cause: pipeline v3 replaced neural finishing with a linear blend; `100%` returned raw neural output, while targets at or below `1.5x` never used the model, making Strength weak outside 4K.
- Pipeline v4 makes `0-10%` strictly model-free and uses WebP method `0`. From `15%`, neural input area grows monotonically with Strength up to a `500,000` pixel cap, the model result is resized to the exact Lanczos target, and nonlinear composition receives progressively stronger finishing.
- Direct reproduced benchmarks at `800x1741 -> 882x1920`: `5%` used `lanczos`/`Pillow`, zero GPU, and about `197 ms` total; `100%` used `anime_x4`/DirectML, about `1.39 s` GPU and `2.60 s` total, with `1.405x` measured sharpness gain and intentionally visible distortion.
- Full verification passed `69` backend tests, `216` extension tests, JavaScript checks, Ruff, and `77%` coverage. Edge fixture E2E passed with zero browser exceptions, `55/55` tall slices, two responsive wide tiles, one offscreen ahead commit at `scrollY=0`, and settled queue/rules/worker/navigation/reload state.
