# Runtime flows

## Normal image lifecycle

```text
DOM discovery
  -> IMAGE_SEEN
  -> preprocessing_queued
  -> preprocessing slot acquired
  -> browser reads displayed bytes
  -> inspect encoded source geometry
  -> promote to slicing when source dimensions exceed slice limits
  -> source fingerprint
  -> ENQUEUE_IMAGE
  -> background waiting
  -> background processing
  -> browser cache hit OR backend /upscale
  -> UPSCALE_COMPLETE
  -> transactional Blob render
  -> fixed/cache
```

Terminal states are `error`, `timeout`, `cancelled`, `removed`, and `superseded`. After `window.load`, each page takes one snapshot of eligible `seen` images, sorts by viewport distance and page order, canonicalizes the source URL, and keeps only the nearest owner for each source. The snapshot queue drains through a bounded number of active ahead owners (`aheadProcessingImageLimit`); it does not stop after the first batch. The snapshot is never rebuilt for later mutations, intersections, scrolls, resizes, or settings refreshes. Images discovered after the snapshot remain `seen` until normal viewport/prefetch promotion; operation, source-owner, and completed-key guards suppress duplicate work.

When disabled, discovery and load callbacks remain dormant and the pending snapshot queue is discarded. Re-enabling detaches and re-registers existing observers once, preserves completed/source-owner suppression, and runs the page-load snapshot only when the page has not already consumed it. `IntersectionObserver` promotes later images; scroll/resize work only reprioritizes currently queued preprocessing waiters and never scans the full discovered-image registry.

## Identity model

- `imageId`: logical image record identifier; not sufficient by itself for mutation authority.
- `operationId`: exact processing attempt authority for one source revision.
- `sourceRevision`: content-side identity derived from page generation, URL, dimensions, render size, and source generation.
- `sourceFingerprint`: SHA-256 of browser-supplied bytes when available.
- `queueKey`: background/backend job identity: `tabId:imageId:operationId`.
- `traceId`: correlation only; it does not replace queue or cache identity.
- `tab generation`: rejects delayed messages from a previous navigation.

Every mutation, completion, failure, remove, or cancel that can affect current work must carry the exact operation identity.

## Content preprocessing scheduler

```text
eligible candidate
  -> waiter(distance, pageOrder, queuedAt, operation)
  -> sort by distance, then page order, then time
  -> acquire one of preprocessingConcurrency slots
  -> guarded release closure
```

- Queued operations own no slot and use `preprocessing_queued`.
- Detached, superseded, distant, timed-out, or cancelled waiters cannot later acquire a slot.
- Slot release is idempotent and must settle on success, failure, cancellation, and fallback.

## Background scheduling

```text
ENQUEUE_IMAGE
  -> operation-keyed pending map
  -> foreground jobs before deferred retries
  -> page order, then queued time
  -> active map limited to 1..2 jobs
  -> cache lookup
  -> backend call or cache completion
  -> statistics and registry update
  -> content completion/failure message
```

- Retry uses exponential delay and preserves `traceId` while incrementing `attempt`.
- Deferred retry work can be preempted by normal work.
- Cancellation invalidates the queue key so timers or late results cannot resurrect it.
- Tab close/navigation increments generation and clears queue, retries, registry, and tab statistics.
- Runtime settings are cached after one migrated storage read and patched by `storage.onChanged`; a pending enable change is merged over any older read that completes later.

## Monitor and health persistence

```text
processing events
  -> in-memory monitor ingest/prune
  -> 100 ms coalesced storage.session snapshot
  -> 5 s storage.local checkpoint
  -> terminal event shortens durable checkpoint to 250 ms
```

- Explicit recovery, retry-link creation, and history clearing flush session and local state immediately.
- Active monitor records are deterministically capped at 500; completed and error histories retain their independent limits.
- Seen counters batch burst increments before touching local storage.
- Backend cache artifact names are indexed once at `ImageCache` startup and updated on save/hit, so `/health` reports the file count without a request-time directory traversal.

## Long-image transaction

```text
read parent bytes
  -> inspect encoded PNG/JPEG/WebP/GIF dimensions when DOM geometry did not request slicing
  -> promote constrained tall/wide sources into the slice transaction
  -> fingerprint parent
  -> decode source
  -> crop/encode raw segments, yielding between segments
  -> load all raw segment Blob URLs
  -> fingerprint every segment
  -> prepare wrapper transaction
  -> commit hidden wrapper while keeping parent visible
  -> register every segment job
  -> activate wrapper and hide parent after registration succeeds
  -> remove parent registry job
  -> render enhanced segments inside the active wrapper progressively
```

Failure before, during, or after commit rolls back owned DOM state and Blob URLs. Depending on the stage, the operation either enqueues the full image exactly once or records a terminal preprocessing error. One segment failure rolls back the entire committed group and cancels sibling jobs. The original page remains visible until raw slices and every segment job are registered; the responsive wrapper then replaces it once, and enhanced segment results commit in place without repeated parent reflow.

The wrapper owns responsive geometry: source tile coordinates are converted to percentages inside one aspect-ratio box, and CSS containment limits layout/paint invalidation. Raw segment nodes retain wrapper-owned percentages when their enhanced Blob replaces the temporary crop. Full images use the measured rendered rectangle rather than stale HTML width/height attributes and never lock both axes to fixed pixels.

Removing only the hidden parent DOM node must preserve an already committed slice group. A true parent source change must roll back the old group before replacement work begins.

## Backend inference flow

```text
/upscale validation
  -> queue submit
  -> browser bytes or remote download fallback
  -> SHA-256 source key
  -> RGB decode and original PNG cache
  -> optional text processing
  -> auto/manual mode resolution
  -> requested output-scale calculation
  -> target scale <= 1.5: Lanczos/Pillow resize without model loading
  -> target scale > 1.5: model resolution/download/checksum/session
  -> neural source fit to output bounds
  -> deterministic output cache key
  -> cache hit OR tiled inference
  -> resize-only post-processing OR baseline/neural blend by enhanceLevel
  -> grayscale policy
  -> WebP encode and atomic save
  -> quality metrics and response
```

DirectML device-loss signatures may trigger one model reload on the next provider. Other inference errors propagate unchanged.

Resize-only jobs preserve the source aspect ratio and remain distinct in backend and extension cache identities. They still run configured post-processing, grayscale policy, WebP encoding, quality analysis, cancellation checks, and renderer commit. Screen-preset `auto` orientation follows source geometry; automatic sizing caps DPR at `1.5` and uses a `1.15` detail multiplier to bound high-DPI work. Neural jobs create a same-size Lanczos baseline and blend the model result by `enhanceLevel`; `0` is baseline, low values are low AI contribution, and `1` is full neural output. Browser-owned PNG originals reuse submitted bytes without a second encode.

## Trace flow

```text
content operation
  -> background queue/cache/backend request
  -> FastAPI request
  -> inference queue
  -> upscaler
  -> image pipeline summaries
  -> cache/output
  -> background completion/failure
  -> content render/failure
```

Backend trace is append-only JSONL. Extension trace is transient/debug-only. Raw bytes, base64 payloads, credentials, cookies, request/response objects, tensors, and full sensitive metadata must not enter trace events.
