# Runtime flows

## Normal image lifecycle

```text
DOM discovery
  -> IMAGE_SEEN
  -> preprocessing_queued
  -> preprocessing slot acquired
  -> browser reads displayed bytes
  -> source fingerprint
  -> ENQUEUE_IMAGE
  -> background waiting
  -> background processing
  -> browser cache hit OR backend /upscale
  -> UPSCALE_COMPLETE
  -> transactional Blob render
  -> fixed/cache
```

Terminal states are `error`, `timeout`, `cancelled`, `removed`, and `superseded`. A discovered offscreen image remains `seen` until it enters the prefetch margin or is selected by the bounded ahead-processing window. The window is limited by `aheadProcessingImageLimit`, selects the nearest eligible images, and retains its keys until those images enter normal prefetch or are cancelled.

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

## Long-image transaction

```text
read parent bytes
  -> fingerprint parent
  -> decode source
  -> crop/encode raw segments
  -> load all raw segment Blob URLs
  -> fingerprint every segment
  -> prepare wrapper transaction
  -> commit wrapper and hide parent
  -> register every segment job
  -> remove parent registry job
```

Failure before or during commit rolls back owned DOM state and Blob URLs. Depending on the stage, the operation either enqueues the full image exactly once or records a terminal preprocessing error. One segment failure rolls back the entire committed group and cancels sibling jobs.

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
  -> model resolution/download/checksum/session
  -> source fit to output bounds
  -> deterministic output cache key
  -> cache hit OR tiled inference
  -> enhancement and grayscale policy
  -> WebP encode and atomic save
  -> quality metrics and response
```

DirectML device-loss signatures may trigger one model reload on the next provider. Other inference errors propagate unchanged.

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
