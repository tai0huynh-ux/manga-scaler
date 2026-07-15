# Engineering decisions

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
