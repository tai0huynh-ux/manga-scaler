# Processing Monitor contract

This document maps the verified 2026-07-19 runtime after monitor wiring and Dashboard browser acceptance. A row marked `not emitted` must remain indeterminate in the Dashboard; its name must not be presented as active work merely because the backend contains a related capability.

## Lifecycle ownership

| Stage | Owner | Input | Output | Identifier | Error path | Cancellation path | Current coverage |
|---|---|---|---|---|---|---|---|
| Content discovery / `DETECTED` | content script | eligible DOM `img` | `IMAGE_SEEN` registry record | `tabId`, `imageId`, `operationId`, source revision | candidate rejected or preprocessing error | removal, navigation, disable | queue scheduler and Edge fixture/live-reader tests |
| Viewport wait / `WAITING_FOR_VIEWPORT` | content script | detected offscreen image | retained `seen` operation | image and operation identity | removal or source change | removal, navigation, disable | viewport scheduling and Dashboard browser tests |
| Source acquisition / `READING_SOURCE` | content plus background browser reader | displayed `currentSrc` | browser-owned bytes | operation, source revision | timeout, HTTP, MIME/magic, abort | preprocessing signal and background fetch abort | protected-reader and queue tests |
| Source validation / `VALIDATING_SOURCE` | content script | acquired bytes and DOM metadata | fingerprint and enqueue payload | `sourceFingerprint` | empty/invalid/non-image/size/slice failures | preprocessing signal | source-read and slicing regressions |
| Queue admission / `QUEUED` | background scheduler | `ENQUEUE_IMAGE` | operation-keyed pending job | `queueKey = tabId:imageId:operationId` | disabled, stale generation, invalid identity | explicit cancel, tab cleanup, cancel-all | queue scheduler tests |
| Deferred queue / `DEFERRED` | background scheduler | retryable failure or preempted work | delayed retry behind foreground jobs | same queue key, incremented attempt | retry exhaustion | retry timer invalidation and active abort | retry/preemption tests |
| Backend request / `SENDING_TO_BACKEND` | background upscale provider and FastAPI route | sanitized metadata plus browser bytes | structured response or error | queue key as backend `jobId`, trace ID | structured HTTP detail | abort plus `DELETE /jobs/{job_id}` | API, cancellation, and trace tests |
| Download / `DOWNLOADING` | backend downloader | remote URL only when bytes absent | bounded image bytes | backend job and trace | download validation/network errors | backend cancel event checked around stages | downloader/API tests; live monitor event not emitted |
| Decode / `DECODING` | backend pipeline | image bytes | RGB image | backend job and trace | decode `ValueError` | backend cancel checks | image-pipeline and API tests |
| Classification / `CLASSIFYING` | backend upscaler | decoded image and requested mode | detected mode/profile | backend job and trace | processing failure | backend cancel checks | classifier tests; dedicated trace stage not emitted |
| Model loading / `LOADING_MODEL` | model manager | selected model | loaded model/provider | backend job and trace | model unavailable/provider error | cancellation observed before inference | model/provider tests; current trace reports resolved model only |
| Inference / `UPSCALING` | upscaler and image pipeline | fitted image/model/tile plan | enhanced image | backend job and trace | model/GPU/inference failure | cancel event between bounded operations | inference/provider recovery tests |
| OCR / `OCR` | text processor | image when enabled | recognized regions/metadata | backend job and trace | capability or processing error | backend cancel checks around text stage | text processor tests; dedicated monitor stage not emitted |
| Text removal / `REMOVING_TEXT` | text processor | recognized/cleanup regions | cleaned image | backend job and trace | text processing error | backend cancel checks around text stage | text processor tests; dedicated monitor stage not emitted |
| Inpainting / `INPAINTING` | no distinct runtime stage | none | none | none | none | none | not emitted; do not display as active |
| Typesetting / `TYPESETTING` | text renderer when enabled | translated text regions | rendered text image | backend job and trace | text processing error | backend cancel checks around text stage | text processor tests; dedicated monitor stage not emitted |
| Encoding / `ENCODING` | backend pipeline | enhanced RGB image | WebP bytes and cache artifact | cache key, backend job, trace | encoding/cache failure | backend cancel checks | pipeline/cache/API tests |
| Result receipt / `RECEIVING_RESULT` | background provider | JSON metadata then local cache fetch | bytes for content renderer | operation, source revision, fingerprint, trace | HTTP/response-body error | browser abort and backend cancel | queue scheduler tests |
| Renderer preparation / `PREPARING_RENDER` | content renderer | result bytes and original DOM snapshot | loaded Blob transaction | exact operation and source identity | Blob load or stale transaction | renderer rollback/revoke | renderer transaction tests |
| DOM commit / `RENDERING` -> `COMPLETED` | content renderer | prepared transaction | confirmed replacement in the correct image/segment | exact operation, source revision, fingerprint, segment identity | rollback on load/stale failure | operation cancel/segment rollback | renderer and Edge DOM replacement tests |
| Rollback | content renderer/slice transaction | failed or stale transaction | original DOM restored, Blob URLs revoked | transaction token and operation | terminal render failure | same rollback path | renderer/slicing tests |
| Cache | background and backend caches | fingerprint/variant/output contract | verified cached result and metadata | fingerprint-derived cache key | cache miss/corrupt entry falls through | active browser job remains cancellable | cache identity tests |
| Cleanup | content/background/backend queue | terminal/removal/navigation/restart | counters, futures, DNR rules, Blob URLs settled | operation, queue key, tab generation | interrupted work becomes non-active | cancel and generation invalidation | queue, protected-read, worker-restart and navigation tests |

## Identity authority

- `imageId` is a logical record key, never sufficient mutation authority.
- `operationId` authorizes one exact attempt/source revision.
- `jobId` is currently the background `queueKey` passed to the backend cancellation API.
- `traceId` correlates diagnostics only.
- `sourceFingerprint` identifies browser-supplied bytes; diagnostics expose only a short prefix.
- `tabId` plus tab generation isolates navigation and tabs.
- Long-image parent/segment identity uses parent operation metadata, segment image IDs, segment operation IDs, and segment index/source bounds. No second parent identifier is needed.

## Event and state rules

`extension/src/processing-monitor.js` owns schema version 1, allowed transitions, terminal-stage enforcement, structured error normalization, URL sanitization, sensitive-field exclusion, and measured-progress enforcement. `COMPLETED` is rejected unless `renderCommit.confirmed` is true. Runtime wiring must preserve that rule and must ignore events from stale operations.

Backend trace stages currently available are `request`, `queue`, `decode`, `input_cache`, `model`, `output_cache`, `inference`, `encode`, `provider_recovery`, and aggregate `upscale`. They can be mapped to the public stage model only when an event is actually observed. OCR, text removal, inpainting, and typesetting must not be synthesized from elapsed time.
