# Changelog

## Unreleased

- Reduced scroll jank during image replacement: result bytes use asynchronous browser Blob conversion when available, are preloaded/decoded off the visible image, the fixed pre-swap fade wait is gone, and the final DOM swap is deferred to an idle/frame-safe point while layout dimensions stay frozen.
- Fixed valid images remaining as `Detected, not queued for preprocessing`: every unique eligible image now enters a metadata-only page backlog immediately, including lazy/dynamic images discovered after load, while active preprocessing remains bounded.
- Changed image priority to match reading direction: current viewport first, then images below from near to far, then images above. Duplicate sources now end as explicit `Skipped` records, and disabling/reprocessing/page exit settles unscheduled backlog state.
- Added an exact `Ban wrong result` Dashboard action. It stores only the current AI result URL, never the original source URL, restores a committed image to its original DOM state, and skips the same result before base64/render delivery on future operations.
- Added schema-5 `blockedResultRules` migration with bounded HTTP/HTTPS normalization and separate Dashboard removal controls for original-source and AI-result rules.
- Rejected HentaiVNX `/images/bn.png` and explicit promotion/banner assets during discovery while preserving normal chapter images with generic reader `alt` text.
- Fixed Dashboard image rows so an original preview appears as soon as an image is detected, before preprocessing or AI completion. Remote previews use lazy/low-priority loading; protected CDN failures fall back to a one-shot, operation-checked browser read without retrying the same failed URL every poll.
- Fixed extension/browser lag from monitor persistence and Dashboard rendering: monitor recovery snapshots are compact and bounded, summary-only reads avoid transferring timelines while the list is closed, polling is single-flight/visibility-aware, and the Processing Monitor job list is collapsed by default until opened.
- Prevented delayed content messages from resurrecting an operation cancelled during service-worker restart; retries continue to use a new operation identity.
- Fixed Screen preset output being silently capped by hidden Manual Pixel limits; HD/FHD/2K/4K now send the selected dimensions exactly. Changing output sizing, quality, mode, Strength, or text settings reprocesses existing discovered images with a distinct cache identity, and focused Strength controls are no longer overwritten by polling.
- Added a real Edge settings matrix gate (`npm.cmd run test:e2e:edge-settings`) covering Auto, HD 5%, Full HD 35%, and 2K 100% request/output behavior with zero browser exceptions.
- Added an accessible `Hide details` / `Show details` control to Processing Monitor; collapsing the detail pane expands the jobs table while preserving the selected job and timeline for immediate restoration.
- Added backend pipeline compatibility `4` on `127.0.0.1:8766`; the extension and Native Messaging launcher reject stale strength pipelines even when they return HTTP 200.
- Fixed Enhancement Strength becoming nearly ineffective after neural blending: `0-10%` is now a model-free Lanczos path with minimum-effort WebP encoding, while `15-100%` progressively increases neural input compute, nonlinear contribution, and finishing strength. Neural output is resized to the exact requested geometry before composition, and `100%` is intentionally aggressive enough to distort.
- Versioned extension output caching as `pipeline:v4-strength-compute`, so weak v3 results cannot replace current images.
- Restored whole-page `window.load` ahead admission for migrated settings, with safe defaults of three active ahead owners and canonical duplicate suppression; later dynamic images join the bounded page backlog immediately.
- Fixed screen/automatic sizing corrupting manga text by reserving the model-free path for explicit `0-10%` strength and bounding strength-aware neural inputs instead of destructively reducing every source to one quarter of the result.
- Changed screen-preset automatic orientation to follow source-image geometry instead of the desktop monitor, bounded automatic DPR at `1.5`, reduced the detail multiplier to `1.15`, and versioned the extension cache identity so malformed legacy results are not reused.
- Fixed extreme manga pages becoming narrow or malformed by promoting source-verified tall/wide images into slicing and preserving responsive aspect ratio during Blob rendering.
- Changed slice preprocessing to yield between segments and render percentage geometry in a contained wrapper; the original page stays visible until raw slices and all segment jobs register, then the wrapper activates once and enhanced results replace exact raw nodes progressively.
- Changed ahead processing to wait for `window.load`, admit all eligible current-page images once, deduplicate canonical source URLs, and drain through the configured active-owner limit; later eligible images join without reopening the initial page scan.
- Added Trace Core MVP with backend append-only JSONL tracing, trace ID propagation across extension/backend boundaries, safe error correlation, cache hit/miss events, and image pipeline tile-plan summary events.
- Added focused trace tests for backend writer behavior, `/upscale` trace contract, inference queue propagation, pipeline summary events, and extension trace propagation/retry/cache behavior.
- Added the `preprocessing_queued` lifecycle state and made active preprocessing conditional on acquiring a slot.
- Added viewport-aware discovery/scheduling and a cancellable metadata priority queue.
- Added stage-specific slicing timeouts, guarded slot release, atomic rollback, and terminal registry updates.
- Changed Dashboard polling to keyed rendering and added explicit state descriptions.
- Added a safe placeholder and load-error fallback for original previews that remain unavailable after the direct URL and protected browser-read paths.
- Added regression coverage for current-tab registry isolation, 23-image concurrency, waiter priority/cancellation, slice cleanup, and stable Dashboard nodes.
