# Changelog

## Unreleased

- Added an accessible `Hide details` / `Show details` control to Processing Monitor; collapsing the detail pane expands the jobs table while preserving the selected job and timeline for immediate restoration.
- Fixed screen/automatic sizing corrupting manga text by avoiding neural inference when the requested target is at or below `1.5x` the source; these jobs now use a truthful Lanczos/Pillow resize path, keep aspect ratio, and report zero GPU time.
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
