# Changelog

## Unreleased

- Fixed extreme manga pages becoming narrow or malformed by promoting source-verified tall/wide images into slicing and preserving responsive aspect ratio during Blob rendering.
- Changed slice preprocessing to yield between segments and render percentage geometry in a contained hidden wrapper; the original page stays visible until all enhanced segments load, then the group swaps into the reader once.
- Changed ahead processing to one bounded pass after each page's initial discovery; later images are processed only when they enter the viewport/prefetch margin, while queued and completed identities remain deduplicated.
- Added Trace Core MVP with backend append-only JSONL tracing, trace ID propagation across extension/backend boundaries, safe error correlation, cache hit/miss events, and image pipeline tile-plan summary events.
- Added focused trace tests for backend writer behavior, `/upscale` trace contract, inference queue propagation, pipeline summary events, and extension trace propagation/retry/cache behavior.
- Added the `preprocessing_queued` lifecycle state and made active preprocessing conditional on acquiring a slot.
- Added viewport-aware discovery/scheduling and a cancellable metadata priority queue.
- Added stage-specific slicing timeouts, guarded slot release, atomic rollback, and terminal registry updates.
- Changed Dashboard polling to keyed rendering and added explicit state descriptions.
- Replaced broken remote original previews with a placeholder and load-error fallback.
- Added regression coverage for current-tab registry isolation, 23-image concurrency, waiter priority/cancellation, slice cleanup, and stable Dashboard nodes.
