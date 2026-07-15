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
