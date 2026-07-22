# Engineering decisions

## 2026-07-20 - Activate registered slice wrappers before enhanced results arrive

Context: A stale or constrained DOM size could send an extreme manga page through full-image inference, producing a very narrow output at the backend height cap. Waiting for every backend segment result before replacing the main image made long pages appear stuck, while inserting each enhanced segment into the reader caused visible layout/paint churn.

Decision: Inspect bounded PNG/JPEG/WebP/GIF headers after the existing browser read and promote oversized source bytes into slicing. Yield between crop/encode segments, build every slice in one hidden, contained, percentage-positioned wrapper, register all exact segment jobs, and activate the wrapper once registration succeeds. Enhanced results then replace their exact raw nodes progressively; any later segment failure still rolls back the whole group.

Reason: Browser-owned bytes describe source geometry more reliably than stale HTML attributes, while a single final DOM swap preserves scroll continuity and avoids mixed temporary/enhanced strips.

Consequence: The original image remains visible until the raw wrapper is ready and registered, full renders keep responsive width and automatic height, enhanced segment results no longer delay the main swap, segment failure rolls back without disturbing the reader, and real-browser geometry assertions use responsive percentages plus measured positions rather than fixed pixel style values.

## 2026-07-20 - Drain one canonical-source snapshot after page load

Context: A bounded lookahead that stopped after its first batch left later images in the same loaded page unprocessed, while identical URLs rendered at different sizes could create duplicate backend work.

Decision: On `window.load`, snapshot all eligible `seen` images once, sort by viewport distance and page order, assign one page-lifetime owner per canonical source URL, and drain the snapshot with the configured active-owner limit. New images discovered after the snapshot remain on normal viewport/prefetch promotion.

Consequence: Every loaded page gets one bounded, eventually draining ahead pass; duplicate source nodes are skipped even when their DOM render sizes differ, and settlement paths release capacity for the next unique snapshot entry.

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

## 2026-07-21 - Use deterministic resize below the neural-resolution threshold

Status: Superseded for enhancement routing by the 2026-07-22 strength-compute decision. The source-geometry and bounded automatic-sizing protections remain in force.

Context: Screen and automatic output limits could require an `x4` model to process a source first reduced to roughly one quarter of the requested result. A reproduced `800x1583` manga page became a `136x270` neural input for a `544x1080` result, corrupting dialogue even at 5% post-processing strength.

Decision: When the requested target scale is at or below `1.5x` the decoded source, resize directly with Pillow Lanczos, then apply the configured bounded enhancement and encoding stages. Larger targets retain the configured ONNX model path.

Reason: Small upscales and downscales do not need neural super-resolution. Avoiding destructive pre-model reduction preserves text and line geometry while removing GPU inference cost.

Consequence: Resize-only responses truthfully report `model=lanczos`, `provider=Pillow`, `scale=1`, and no tile size. Screen auto-orientation follows source geometry, automatic DPR is capped at `1.5`, and the extension cache namespace is versioned to prevent old malformed AI outputs from surviving the fix.

## 2026-07-21 - Blend neural reconstruction by the user strength control

Status: Superseded by the 2026-07-22 strength-compute decision because blending alone removed the former neural finishing stage and made maximum strength too weak.

Context: A 5% setting previously changed only post-processing after the full neural model had already reconstructed the page, so HD/FHD/2K text could still merge or become malformed.

Decision: Build a same-size Lanczos baseline for neural jobs and blend the model result into it using `enhanceLevel`; resize-only jobs never load a neural model and keep only bounded post-processing. Version the backend and extension cache identities together.

Reason: The slider now controls the expensive and visually destructive operation the user expects. A low setting stays close to source geometry, while 100% remains an explicit full-neural choice.

Consequence: `0%` is baseline, `5%` is a measured low neural contribution, and `100%` is the full model result. Browser-owned PNG bytes are written directly to the original cache, avoiding an extra decode/encode cycle.

## 2026-07-21 - Reject stale local backends by pipeline identity

Context: A disconnected process on the former `8765` port returned HTTP 200 and made the extension appear healthy while still running the pre-resize code.

Decision: Run the active backend on `127.0.0.1:8766`, expose `pipelineVersion=3` through `/health`, and require that identity in both the MV3 worker and Native Messaging launcher.

Reason: HTTP reachability alone cannot prove that the process implements the current image and cache contracts.

Consequence: Old processes are ignored, new cache artifacts cannot collide with pre-fix results, and startup failures become explicit instead of silently routing work to stale code.

## 2026-07-22 - Make strength control compute, composition, and finishing

Context: Pipeline v3 used only a linear Lanczos/neural blend. At `100%` it returned the raw neural image and skipped the sharpen/contrast finishing that previously made 4K visibly better. Targets at or below `1.5x` also never reached the model, so HD/FHD/2K barely responded to the slider.

Decision: `0-10%` is a strict model-free fast path. Starting at `15%`, every preset may use neural inference. Neural input pixels grow monotonically with strength from the minimum required x4 input toward source detail, capped at `500,000` pixels and safe model dimensions. The model result is resized back to the exact Lanczos target, blended on a nonlinear curve, then receives progressively stronger finishing. The fast path uses WebP method `0`; neural paths retain the configured encoding method.

Reason: One control now changes both latency and visible intensity. Five percent remains fast and geometry-safe, normal strengths remain bounded for whole-page use, and the user can deliberately choose a slow, extreme `100%` result.

Consequence: Pipeline/cache compatibility advances to `4` / `pipeline:v4-strength-compute`. On reproduced `800x1741 -> 882x1920` slices, `5%` completed model-free in about `197 ms`, while `100%` used DirectML in about `2.60 s` and visibly produced the requested aggressive, potentially distorted result.
