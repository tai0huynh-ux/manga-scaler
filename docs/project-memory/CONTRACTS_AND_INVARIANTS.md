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

## Discovery support boundary

- The current scanner supports light-DOM `<img>` elements, including responsive `<picture>` sources after they resolve to the owned image element.
- Dynamically inserted and source-changing light-DOM images are observed.
- Open Shadow DOM images are not traversed.
- Same-origin iframe images are not scanned because the manifest does not inject the content script into all frames.
- CSS background images, canvas output, and WebGL sources are not discovered.
- The deterministic fixture under `extension/tests/fixtures/reader/` must keep supported and unsupported cases explicit.

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
