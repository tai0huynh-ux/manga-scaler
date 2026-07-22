# Test and change map

## Change routing

| Change area | Start with | Direct consumers | Focused verification |
|---|---|---|---|
| API request/response | `backend/app/models/schemas.py`, `backend/app/api/routes.py` | `upscaler.py`, `extension/src/background.js` | `test_api_contract.py`, `test_api.py` |
| Backend job lifecycle | `inference_queue.py`, `upscaler.py` | routes, pipeline, model manager | `test_inference_queue.py`, `test_provider_recovery.py` |
| Model/provider behavior | `model_manager.py`, `gpu_provider.py` | upscaler, health route | `test_provider_recovery.py`, `test_config.py` |
| Tile/image behavior | `image_pipeline.py` | upscaler, comparisons route | `test_image_pipeline.py`, `test_quality.py` |
| Text cleanup/translation | `text_processor.py` | routes, upscaler, extension settings | `test_text_processor.py` |
| Trace behavior | `core/tracing.py` and emitting boundary | routes, queue, upscaler, pipeline, extension | `test_tracing.py` plus trace-focused JS tests |
| Background queue/cache | `extension/src/background.js` | content messages, backend API, dashboard | `queue_scheduler.test.cjs` |
| Discovery/slicing/render | `extension/src/content.js` | background message boundary only | `queue_scheduler.test.cjs` |
| Dashboard reconciliation | `extension/src/dashboard.js` | background registry contract | `dashboard_rendering.test.cjs` |
| Processing Monitor contract | `extension/src/processing-monitor.js` | content, background, Dashboard | `processing_monitor.test.cjs`, then adjacent queue/dashboard tests |
| Shared settings | all three config files | popup, dashboard, content, background, backend | config/API tests plus extension suite |
| Native startup | `native-host/*`, background launch functions | backend health/start flow | manual Chrome/Edge verification |
| Reader fixture contract | `extension/tests/fixtures/reader/server.cjs` | content discovery and browser E2E | `reader_fixture.test.cjs` plus `test:e2e:edge-fixture` |

## Verification commands

During implementation:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1 -Fast
```

Before completion:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
```

When browser/backend behavior is in scope and the real backend/model are available:

```powershell
npm.cmd run test:e2e:edge-fixture
```

Full verification runs:

- Backend pytest suite.
- JavaScript syntax checks.
- Extension Node test suite.
- Ruff linting.
- Coverage run with a 45% minimum.

## Baseline test coverage by intent

- API health, error shape, trace ID, browser aliases.
- Deterministic image classification and quality metrics.
- Tiled merge correctness, cancellation, and trace summaries.
- Queue concurrency, active/queued/capacity-blocked cancellation, clean stop/restart settlement, same-ID stale completion safety, counters, and trace propagation.
- FastAPI HTTP cancellation followed by application lifespan restart with no stale backend job.
- DirectML fallback specificity and failed-provider session eviction.
- Text cleanup, truthful capability reporting, rendering, and translation memory.
- Content source replacement races and stale completion rejection.
- Renderer responsive geometry, hidden-wrapper atomic activation, transaction rollback, and Blob ownership.
- Preprocessing priority, slot limits, timeout/cancellation settlement.
- Long-image transaction commit, rollback, sibling cancellation, and segment ordering.
- Minimum-dimension boundaries, encoded PNG/JPEG/WebP/GIF source promotion, extreme-tall row coverage, and safe extreme-wide rejection.
- Dependency-free local reader endpoints for responsive, lazy, dynamic, protected, cross-origin, and unsupported source categories.
- Protected-reader transport endpoints for exact per-page Referer bytes, slow/hanging/disconnected bodies, invalid image payloads, and abortable large streams.
- Real Edge unpacked-extension flow through static/dynamic discovery, browser byte read, backend DirectML inference, responsive percentage-based slice rendering, atomic wrapper activation, false-positive rejection, and queue settlement.
- Background operation isolation, retry invalidation, cache identity, tab generation.
- Exact-URL Referer rule serialization, terminal cleanup, and discovery-time rule rejection.
- Background-provider initialization cleanup for interrupted temporary and legacy Referer session rules.
- Rule-ownership preservation, ID collision avoidance, delayed-startup races, URL normalization, redirect matching, cancellation, and timeout lock release.
- Real Edge MV3 worker stop/reactivation, full navigation invalidation, and unpacked-extension reload with automatic content recovery.
- Page-load ahead snapshot: `window.load` one-shot wiring, nearest canonical-source ownership, duplicate URLs with different render sizes, bounded active pumping until every snapshot source settles, disable/cancellation/fallback/slice settlement, and a real Edge image committed as a Blob while `scrollY=0` beyond the legacy prefetch margin.
- Public live-reader E2E (`test:e2e:edge-live-reader`) with sanitized URL diagnostics, backend restart detection, and Manga/Manhwa/Manhua category evidence.
- Dashboard stable keyed rows, origin previews from detected state, protected-preview fallback, default-collapsed lazy monitor list, summary-only reads, and accessible detail-pane collapse/restore behavior verified through DOM regression and real Edge interaction.
- Processing Monitor transition safety, DOM-commit completion guard, structured 422 normalization, URL/token redaction, image-data exclusion, and indeterminate progress.
- Compact monitor persistence caps idle detection/completed/error history without dropping started work, and recovered terminal operations reject delayed content re-enqueue after worker restart.
- Source-oriented screen presets, bounded high-DPI automatic output sizing, resize-safe cache versioning, and aspect-preserving Lanczos output for targets at or below `1.5x`.
- Pipeline-v4 compatibility health, stale-backend rejection, schema-4 ahead migration, exact 5%/100% slider payloads, model-free fast routing, monotonic strength-controlled neural compute, exact output geometry, aggressive maximum finishing, browser-owned PNG byte reuse, and the active `8766` endpoint.
- Screen preset exact-target behavior, Manual Pixel/Auto/Screen output-limit matrices, settings-triggered content reprocessing, cache isolation across resolution/Strength, focused-control polling protection, and real Edge Popup acceptance for Auto/HD 5%/FHD 35%/2K 100%.

## Manual gaps

Automated tests do not prove:

- Long-running natural Chrome/Edge suspension timing and soak behavior beyond deterministic CDP stop/reactivation.
- Native Messaging registration and hidden backend startup on a fresh machine.
- DirectML/CUDA execution with production ONNX files.
- Protected-image reads across representative manga/CDN hosts.
- Visual quality of real manga, artwork, photo, OCR cleanup, and translated rendering.
- Model auto-download availability and pinned upstream artifact stability.

Record manual evidence in `docs/CODEX_TASKS.md`, `docs/KNOWN_ISSUES.md`, and the work log.

## Completion discipline

1. Reproduce regressions with a failing focused test.
2. State the invariant being restored.
3. Search direct references before rename/delete.
4. Keep changes local to the routed ownership boundary.
5. Run fast verification while iterating and full verification before completion.
6. Update this project memory and product docs to match verified reality.
7. Run `scripts/auto-git-update.ps1` once for the completed change set.
