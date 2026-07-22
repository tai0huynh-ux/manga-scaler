# Changelog

## Unreleased

- Added an accessible `Hide details` / `Show details` control to Processing Monitor; collapsing the detail pane expands the jobs table while preserving the selected job and timeline for immediate restoration.
- Added backend pipeline compatibility `4` on `127.0.0.1:8766`; the extension and Native Messaging launcher reject stale strength pipelines even when they return HTTP 200.
- Fixed Enhancement Strength becoming nearly ineffective after neural blending: `0-10%` is now a model-free Lanczos path with minimum-effort WebP encoding, while `15-100%` progressively increases neural input compute, nonlinear contribution, and finishing strength. Neural output is resized to the exact requested geometry before composition, and `100%` is intentionally aggressive enough to distort.
- Versioned extension output caching as `pipeline:v4-strength-compute`, so weak v3 results cannot replace current images.
- Restored one whole-page `window.load` ahead snapshot for migrated settings, with safe defaults of three ahead owners and canonical duplicate suppression; later dynamic images still promote only through viewport/prefetch observers.
- Fixed screen/automatic sizing corrupting manga text by reserving the model-free path for explicit `0-10%` strength and bounding strength-aware neural inputs instead of destructively reducing every source to one quarter of the result.
- Changed screen-preset automatic orientation to follow source-image geometry instead of the desktop monitor, bounded automatic DPR at `1.5`, reduced the detail multiplier to `1.15`, and versioned the extension cache identity so malformed legacy results are not reused.
- Fixed extreme manga pages becoming narrow or malformed by promoting source-verified tall/wide images into slicing and preserving responsive aspect ratio during Blob rendering.
- Changed slice preprocessing to yield between segments and render percentage geometry in a contained wrapper; the original page stays visible until raw slices and all segment jobs register, then the wrapper activates once and enhanced results replace exact raw nodes progressively.
- Changed ahead processing to wait for `window.load`, snapshot all eligible current-page images once, deduplicate canonical source URLs, and drain the snapshot through the configured active-owner limit; images discovered later still wait for viewport/prefetch promotion.
- Added Trace Core MVP with backend append-only JSONL tracing, trace ID propagation across extension/backend boundaries, safe error correlation, cache hit/miss events, and image pipeline tile-plan summary events.
- Added focused trace tests for backend writer behavior, `/upscale` trace contract, inference queue propagation, pipeline summary events, and extension trace propagation/retry/cache behavior.
- Added the `preprocessing_queued` lifecycle state and made active preprocessing conditional on acquiring a slot.
- Added viewport-aware discovery/scheduling and a cancellable metadata priority queue.
- Added stage-specific slicing timeouts, guarded slot release, atomic rollback, and terminal registry updates.
- Changed Dashboard polling to keyed rendering and added explicit state descriptions.
- Replaced broken remote original previews with a placeholder and load-error fallback.
- Added regression coverage for current-tab registry isolation, 23-image concurrency, waiter priority/cancellation, slice cleanup, and stable Dashboard nodes.
