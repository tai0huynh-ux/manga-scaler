# Engineering decisions

## 2026-07-20 - Keep the source visible until a responsive slice group is complete

Context: A stale or constrained DOM size could send an extreme manga page through full-image inference, producing a very narrow output at the backend height cap. Existing slicing also exposed temporary raw slices and replaced them one by one, increasing visible layout/paint churn while reading.

Decision: Inspect bounded PNG/JPEG/WebP/GIF headers after the existing browser read and promote oversized source bytes into slicing. Yield between crop/encode segments, then build every slice in one hidden, contained, percentage-positioned wrapper; render enhanced segments there and activate the wrapper only after all exact segment operations succeed.

Reason: Browser-owned bytes describe source geometry more reliably than stale HTML attributes, while a single final DOM swap preserves scroll continuity and avoids mixed temporary/enhanced strips.

Consequence: The original image remains visible during processing, full renders keep responsive width and automatic height, segment failure rolls back without disturbing the reader, and real-browser geometry assertions use responsive percentages plus measured positions rather than fixed pixel style values.

## 2026-07-19 - Browser-owned bytes are authoritative request input

Context: Protected and Blob/Data images may already be available to the browser while the backend cannot safely or meaningfully download their display URL.

Decision: Request schema version 1 accepts Blob/Data metadata or no URL only when `imageData` is present. The backend uses those bytes directly; URL-only requests remain restricted to HTTP/HTTPS.

Reason: This closes the 422 contract gap without loosening the downloader's SSRF boundary or adding intrusive browser permissions.

Consequence: The extension normalizes and sanitizes every request before dispatch, persisted settings migrate idempotently, and invalid local contracts are non-retryable.

## 2026-07-16 - Trace Core MVP uses append-only JSONL

Context: The project needs trace/debug correlation before adding a dashboard or artifact capture.

Options considered: reuse operational logs only; add SQLite immediately; emit OpenTelemetry; write a small JSONL trace file.

Decision: use a small append-only JSONL writer at `backend/app/core/tracing.py` and keep trace failure independent from business failure.

Reason: JSONL is inspectable, dependency-free, easy to test, and matches the current local-first project shape.

Trade-off: querying traces is manual until a dashboard or index is added.

Consequence: trace events include schema version, timestamp, event, trace ID, component, status, and controlled metadata, while raw image/base64 data is excluded.

## 2026-07-16 - Trace ID propagates across extension and backend boundaries

Context: Existing IDs (`operationId`, `queueKey`, backend job ID, fingerprints, and cache keys) each cover only part of the pipeline.

Options considered: replace existing IDs with a single ID; derive trace IDs from URLs/cache keys; add a separate opaque correlation ID.

Decision: add `traceId` as an opaque correlation ID and preserve all existing IDs.

Reason: this avoids changing cache identity, queue authority, or stale-operation guards.

Trade-off: trace events carry more IDs, and documentation must explain their roles.

Consequence: retries keep the same `traceId` while `attempt` increments; backend fallback trace IDs are created for older clients.

## 2026-07-16 - No per-tile events in default tracing

Context: Tiled inference can produce many internal tile operations per image.

Options considered: emit every tile; emit no image pipeline trace; emit one tile-plan summary plus inference/merge terminal events.

Decision: emit one tile-plan summary and inference/merge summary events.

Reason: it gives enough debugging context without high event volume or tensor/image retention.

Trade-off: individual tile coordinates are unavailable from default traces.

Consequence: future detailed tile tracing should be opt-in if needed.

## 2026-07-15 — Separate discovery, queued preprocessing, and active preprocessing

All eligible images remain discoverable for page statistics, but only images inside the prefetch margin enter preprocessing. A cancellable priority queue orders waiters by viewport distance, page order, and queue time. This prevents distant chapter images from occupying slots merely because they appeared earlier in the DOM.

`preprocessing_queued` and `preprocessing` are distinct registry states. The latter is valid only while an operation owns a preprocessing slot.

## 2026-07-15 — Keep Dashboard image nodes stable

Dashboard polling uses keyed row reconciliation. Unchanged preview URLs retain the same image node and browser request. Remote website URLs are links, not preview sources, because extension pages do not reliably share anti-hotlink headers, cookies, or signed URL context.
