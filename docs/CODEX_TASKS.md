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

## Manual follow-up

- [ ] Validate Trace Core MVP in Chrome against representative manga and webtoon sites.
- [ ] Validate slice counts and viewport behavior in Chrome against representative manga and webtoon sites.
- [ ] Record any site-specific anti-hotlink failures with Network and structured extension logs.
- [ ] Provide one current public TruyenQQ reader/chapter URL without a session token.
- [ ] Re-run hentaivnx acceptance with worker-restart-safe status capture and prove a chapter Blob replacement or a stable terminal failure.
