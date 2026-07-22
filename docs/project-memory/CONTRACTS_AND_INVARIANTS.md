# Contracts and invariants

## Non-negotiable race-safety rules

1. A stale completion, failure, cancellation, or removal must never delete or overwrite a newer operation with the same `imageId`.
2. `imageId` alone is never mutation authority; use `operationId` and `sourceRevision`, plus `sourceFingerprint` for completion matching when available.
3. Queue counters, active maps, futures, workers, and slots must settle after success, failure, cancellation, timeout, preemption, and shutdown.
4. Browser image fetch and response-body reads must both race abort; a response implementation that ignores `AbortSignal` must not retain a preprocessing slot.
4. A cancelled queue key must not be resurrected by a delayed retry or late async callback.
5. Tab navigation generation must reject delayed storage reads and messages from the old page.
6. Render rollback may restore only DOM state still owned by that transaction; it must not overwrite a newer page or renderer assignment.
7. Raw-slice rollback is idempotent and may revoke each owned Blob URL at most once.
8. Parent cleanup after slicing must not remove, reorder, or resurrect committed segment jobs.
9. Segment completion must target the exact raw node and slice ownership token recorded at registration.
10. DirectML device loss may retry once on a fallback provider; unrelated failures must propagate.
11. Protected browser reads must await one startup cleanup barrier; cleanup may remove only exact-URL Referer rules matching the subsystem signature and must preserve every unrelated active rule ID.
12. Only the newest content-script instance for a document may discover, mutate, or render images after extension reload; older instances must become stale before async work can commit.
13. Backend queue shutdown must cancel active, queued, and capacity-blocked submissions, signal every tracked job, and clear queue/job/future ownership before a restart accepts new work.
14. Backend job cleanup may remove a client-job registry entry only when that entry still points to the exact job being settled; stale completion must preserve a newer same-ID job.

## Browser/backend JSON contract

`extension/src/background.js` sends browser-style names and `backend/app/models/schemas.py` preserves them through Pydantic aliases:

```text
imageUrl             -> image_url
imageData            -> image_data
schemaVersion        -> schema_version
jobId                -> job_id
tileSize             -> tile_size
enhanceLevel          -> enhance_level
maxOutputWidth       -> max_output_width
maxOutputHeight      -> max_output_height
outputQuality        -> output_quality
textProcessing       -> text_processing
traceId              -> trace_id
operationId          -> operation_id
queueKey              -> queue_key
sourceFingerprint    -> source_fingerprint
```

`attempt` keeps the same name. Any request-field change requires simultaneous checks in background request construction, Pydantic schemas, API route forwarding, service signatures, and `backend/tests/test_api_contract.py`.

Request schema version 1 requires HTTP/HTTPS when browser-owned bytes are absent. When valid `imageData` is present, `imageUrl` may be omitted or may carry Blob/Data source metadata; the backend must use the supplied bytes and must not download that metadata URL. `file:` and arbitrary schemes are always rejected.

Recoverable numeric drift is normalized before dispatch, including output dimensions below the backend minimum. Non-finite values, unsupported modes/tile sizes, malformed text-processing objects, and overlong identifiers fail locally as non-retryable request-normalization errors.

## Cache identity

Background cache identity includes:

- Source fingerprint when available; otherwise the canonical full URL.
- Parent fingerprint for segment variants.
- Segment coordinates/variant.
- Mode and enhancement level.
- Output dimensions and quality.
- Tile size.
- Text cleanup/translation/language options.

Backend output cache identity independently includes source hash, detected mode, model, scale, tile, enhancement, output bounds, quality, text options, and format.

Do not remove a cache-key component without proving outputs remain equivalent.

## Configuration alignment

Compare these files whenever changing shared defaults:

- `extension/src/config.js`: active browser defaults.
- `backend/config.json`: active backend defaults and model registry.
- `shared/config/defaults.json`: cross-component reference defaults.

The extension runtime and `shared/config/defaults.json` use a 300 px minimum for both input dimensions. Boundary behavior is: `299x299` rejected, `300x300` accepted, `301x301` accepted, and an image with either dimension below 300 rejected while both minimum toggles are enabled.

Persisted settings schema version 2 adds bounded `imageSliceMaxWidth` ownership. The internal default is `8192`, accepted values are `512` through `8192`, and migration must remain idempotent before the width setting is exposed through slicing behavior or UI.

Persisted settings schema version 4 preserves `aheadProcessingEnabled`, `aheadProcessingImageLimit` (1 through 50, default 3), and `prefetchMarginPx` (0 through 12000, default 1800). Migration is bounded and idempotent; pre-v4 data restores the one-shot ahead default instead of retaining a stale disabled value. After `window.load`, ahead processing admits every eligible current-page `seen` image to a metadata-only queue, keeps one owner for each canonical source URL, and drains through at most `aheadProcessingImageLimit` active owners. Eligible images discovered later join that queue immediately. Every admitted unique source must leave `DETECTED`; duplicates must terminate as `SKIPPED` with `duplicate-source` and must not enqueue bytes or backend work.

Preprocessing priority is strict: work intersecting the current viewport comes first, images below follow from near to far, and images above come last. Intersection/prefetch promotion may start visible work immediately, but active preprocessing and ahead ownership remain bounded. Distant normal-prefetch waiters may be deferred; ahead waiters are not cancelled solely for being beyond `cancelDistancePx`. Navigation, pagehide, disable, reprocess, source replacement, duplicate suppression, completion, fallback, rollback, and cancellation must terminalize reported backlog entries and clear or release owned ahead keys through guarded settlement paths.

Two-dimensional segment identity includes source X, Y, width, and height in operation IDs, source revisions, cache variants, DOM datasets, and display metrics. The renderer converts exact rendered tile geometry to percentages inside one responsive aspect-ratio wrapper. The wrapper stays hidden while raw slices and all segment jobs register, then activates once before enhanced results arrive; segment renders replace exact raw nodes progressively, while rollback remains group-atomic and idempotent before and after activation.

Browser-owned encoded dimensions are authoritative when DOM geometry is absent, stale, or constrained. A bounded PNG/JPEG/WebP/GIF header probe may promote an operation from the full-image path into slicing, but it must reuse the already-read bytes and guarded preprocessing slot rather than performing a second browser read.

## Output sizing and strength path

- `screenOrientation=auto` follows source image geometry, not the physical monitor orientation.
- Automatic output sizing caps the effective device-pixel ratio at `1.5` and uses a bounded `1.15` detail multiplier.
- `enhanceLevel <= 0.10` must never resolve or load an ONNX model, regardless of output preset. It uses aspect-safe Lanczos, bounded light finishing, WebP method `0`, and reports `lanczos`/`Pillow`/zero GPU time.
- `enhanceLevel >= 0.15` may use neural inference for every preset. Neural input area must increase monotonically with strength and remain bounded by source dimensions, safe model dimensions, and the `500,000` pixel cap.
- Neural output must be resized to the exact Lanczos target before composition. Strength controls a nonlinear neural weight plus progressively stronger finishing; `100%` is explicitly allowed to create halos or distortion.
- Neural and fast-path results use distinct backend keys and the extension `pipeline:v4-strength-compute` cache namespace. A stale v3 cache entry must never replace a current result.
- Screen sizing returns the selected HD/FHD/2K/4K dimensions exactly; Manual Pixel width/height caps apply only in `sizingMode=pixel` and must not silently constrain a Screen preset.
- Changes to output sizing, output quality, enhancement mode/Strength, performance, or text-processing settings invalidate current content operations and rediscover them so the new payload is rendered. Scheduling-only changes do not trigger a full reprocess.
- Popup/Dashboard polling must not overwrite a focused mode or Strength control; the value remains user-owned until focus leaves the control.

## Discovery support boundary

- The current scanner supports light-DOM `<img>` elements, including responsive `<picture>` sources after they resolve to the owned image element.
- Dynamically inserted and source-changing light-DOM images are observed.
- Open Shadow DOM images are not traversed.
- Same-origin iframe images are not scanned because the manifest does not inject the content script into all frames.
- CSS background images, canvas output, and WebGL sources are not discovered.
- The deterministic fixture under `extension/tests/fixtures/reader/` must keep supported and unsupported cases explicit.

## Result rejection and false-positive safety

- `blockedResultRules` contains only bounded, exact HTTP/HTTPS AI-result URLs with fragments removed; query strings remain part of identity. It is separate from `blacklistRules`, which targets normalized original sources.
- A result ban is authorized only by the current `tabId`, `imageId`, `operationId`, and registry `enhancedImageUrl`; stale or mismatched requests must not mutate the page or source blacklist.
- A blocked result is rejected before the content renderer receives or serializes its image bytes. The page registry becomes `skipped`, the original remains visible, and content emits `IMAGE_RESULT_REJECTED` only to settle the exact operation.
- If a result was already committed, the renderer retains the first successful original DOM snapshot and `restoreOriginal` must restore `src`, responsive attributes, picture sources, layout styles, classes, and owned Blob URL state without touching newer ownership.
- HentaiVNX-style promotional assets such as `/images/bn.png`, explicit banner/branding markers, and promotion copy are excluded cheaply at discovery. Generic chapter images sharing an `alt` string remain eligible.

## Provider and model contract

- Models accept float32 RGB NCHW and return float32 RGB NCHW.
- Configured model filenames and scale are authoritative in `backend/config.json`.
- Auto-downloaded artifacts require the pinned SHA-256 before atomic publication.
- Fixed square model input dimensions override the requested inference tile size.
- DirectML sessions disable memory-pattern optimization and run sequentially.

## Text-processing truthfulness

- Cleanup can operate locally without OCR.
- OCR availability requires both Tesseract and `pytesseract`.
- Translation may only run on recognized text; never fabricate source text or claim translation was applied when it was skipped.
- Translation currently uses a best-effort Google web endpoint plus local JSONL translation memory when OCR text exists.
- Remote translation behavior is user-configured through extension toggles and remains dependent on network availability.

## Security boundary

The backend is designed for a trusted local machine and binds to loopback by default. Before network exposure, add authenticated access, strict origin policy, SSRF protection, and URL allow/deny controls. Browser byte supply is preferred because it reuses browser cookies/cache and avoids backend access to protected remote URLs.

## Processing Monitor contract

- Monitor events use schema version 1 and exact operation identity; `imageId` or `traceId` alone never authorizes mutation.
- Terminal stages cannot transition to active or completed work. A retry creates a visibly new attempt/operation rather than reviving a terminal event.
- `COMPLETED` requires a confirmed renderer transaction commit for the current image or segment. Backend success alone is `RECEIVING_RESULT`, never completion.
- Progress remains `null` unless a producer supplies an explicitly measured value.
- Diagnostics exclude image bytes/base64, credentials, cookies, raw request/response bodies, browser profiles, personal paths, URL query values, and fragments.
- Source identity contains only scheme, hostname, shortened path, and query-key names. Fingerprints are exposed only as short prefixes.
- OCR, text removal, inpainting, and typesetting stages are not emitted unless the current runtime reports that exact work.
