# Codex tasks

## Completed

- [x] Implement Trace Core MVP backend JSONL writer.
- [x] Propagate `traceId` through content, background, `/upscale`, inference queue, upscaler, and image pipeline.
- [x] Add trace unit/API/queue/pipeline/extension tests.
- [x] Document Trace Core MVP architecture and limitations.
- [x] Reproduce eager offscreen preprocessing and premature active-state reporting.
- [x] Add `preprocessing_queued` and slot-owned `preprocessing`.
- [x] Add cancellable viewport-priority preprocessing waiters.
- [x] Bound and clean up long-image preprocessing stages.
- [x] Preserve Dashboard rows and image nodes across polling refreshes.
- [x] Add original-preview placeholders and error fallback.
- [x] Verify current-tab registry isolation.
- [x] Add focused regression tests and run repository verification.
- [x] Reproduce and reject hentaivnx reader chrome outside explicit page containers (`DISCOVERY-002`).
- [x] Bound browser image response-body reads even when abort is ignored (`DISCOVERY-003`).
- [x] Re-run the real Edge deterministic fixture after the live-site fixes.
- [x] Prove exact Referer rule ownership, startup barrier settlement, active-ID collision avoidance, URL normalization, redirect handling, cancellation, and timeout cleanup.
- [x] Stop and reactivate the actual Edge MV3 worker during a stalled protected read while preserving unrelated rules.
- [x] Prove full same-tab navigation cleanup and automatic unpacked-extension reload recovery without duplicate replacements.
- [x] Fix whole-page ahead migration, strength-controlled neural blending, stale backend selection, byte-preserving PNG caching, and resize-safe HD/FHD/2K routing; verify with full gates and Edge fixture E2E.
- [x] Restore effective Strength behavior with a model-free 0-10% fast path, strength-scaled neural compute from 15%, exact-size composition, aggressive 100% finishing, pipeline v4 isolation, benchmarks, and Edge E2E.
- [x] Verify Extension settings across Auto/HD/FHD/2K and Strength 5/35/100%; reprocess existing images on output-setting changes, protect focused controls from polling resets, and make Screen presets ignore hidden Manual Pixel caps.

## Manual follow-up

- [ ] Validate Trace Core MVP in Chrome against representative manga and webtoon sites.
- [ ] Validate slice counts and viewport behavior in Chrome against representative manga and webtoon sites.
- [ ] Record any site-specific anti-hotlink failures with Network and structured extension logs.
- [ ] Provide one current public TruyenQQ reader/chapter URL without a session token.
- [x] Re-run hentaivnx acceptance with worker-restart-safe status capture and prove chapter Blob replacement.
