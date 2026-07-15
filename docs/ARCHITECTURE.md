# Extension image lifecycle

The content script discovers eligible `<img>` elements independently from scheduling them. Discovery records every eligible image with `IMAGE_SEEN`; preprocessing begins only when the image enters the configured viewport prefetch margin.

The normal lifecycle is:

```text
seen -> preprocessing_queued -> preprocessing -> waiting -> processing -> fixed/cache
```

Terminal branches are `error`, `timeout`, `cancelled`, `removed`, and `superseded`. `preprocessing_queued` means a metadata-bearing waiter exists but owns no slot. `preprocessing` is emitted only after the waiter acquires a slot. A guarded release closure ensures each acquired slot is released at most once.

## Preprocessing scheduler

Content-side waiters contain operation identity, the image node, page order, viewport distance, queue time, resolution callback, cancellation state, and timeout handle. Selection order is viewport distance, page order, then queue time. Detached, superseded, blocked, distant, unloaded, or timed-out operations cannot later acquire a slot.

Backend jobs retain their separate scheduler in the service worker. An image enters backend state `waiting` only after `ENQUEUE_IMAGE` is accepted.

## Long-image transaction

A long-image operation owns one preprocessing slot while it reads, fingerprints, decodes, crops, encodes, loads raw slices, fingerprints segments, commits the wrapper, and registers segment jobs. Stage-specific limits identify browser read, decode, crop, encode, raw-slice load, fingerprint, and segment-enqueue failures.

The slice transaction owns its wrapper, raw nodes, Blob URLs, original-image visibility, segment records, and operation identity. Any failure rolls back the transaction and either enqueues the full image exactly once or records a terminal preprocessing failure. Stale operations cannot remove a newer operation with the same image ID.

## Dashboard and registry

`GET_PAGE_IMAGES` requires a content tab ID and returns `PageImageRegistry.list(tabId)`. Tab close and navigation cancel jobs and remove that tab's registry.

Dashboard rows are keyed by `tabId:imageId:operationId`. Polling updates status and changed URLs without recreating unchanged `<img>` nodes. Direct website URLs remain available through “Open original image” but are not used as previews; only local extension, Blob/data, or localhost cache URLs are rendered.

## Trace Core MVP

Trace identity flows through the processing path:

```text
content traceId
-> background queue
-> backend /upscale request
-> inference job
-> upscaler
-> image pipeline
-> cache/output
-> background completion/failure
-> content terminal render/failure
```

The content script creates an opaque `traceId` for each logical operation. Background jobs keep that `traceId` across cache hit/miss, backend request, retry, cancellation, and completion. Backend `/upscale` accepts optional `traceId`, `operationId`, `queueKey`, `attempt`, and `sourceFingerprint`; if `traceId` is missing, the backend creates a fallback.

Backend trace events use schema version `1` and include timestamp, event name, trace ID, component, stage, status, and small controlled metadata. Trace events are written to `backend/logs/trace.jsonl` by default through an append-only writer. Trace writes are isolated from business failures: serialization or file errors are logged as warnings and do not fail image processing.

Privacy constraints:

- No raw image bytes.
- No base64 image payloads.
- No DOM nodes, request objects, response objects, tensors, or full exception objects.
- Cache keys and source fingerprints are shortened in trace events.

When trace is disabled in `backend/config.json`, backend trace calls are no-ops. Extension trace events remain transient in message/job metadata and debug-only structured events; there is no persistent extension trace store in this phase.
