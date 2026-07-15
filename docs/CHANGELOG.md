# Changelog

## Unreleased

- Added the `preprocessing_queued` lifecycle state and made active preprocessing conditional on acquiring a slot.
- Added viewport-aware discovery/scheduling and a cancellable metadata priority queue.
- Added stage-specific slicing timeouts, guarded slot release, atomic rollback, and terminal registry updates.
- Changed Dashboard polling to keyed rendering and added explicit state descriptions.
- Replaced broken remote original previews with a placeholder and load-error fallback.
- Added regression coverage for current-tab registry isolation, 23-image concurrency, waiter priority/cancellation, slice cleanup, and stable Dashboard nodes.
