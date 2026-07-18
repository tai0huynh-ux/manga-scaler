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
- Queue concurrency, active cancellation, stop settlement, counters, and trace propagation.
- DirectML fallback specificity and failed-provider session eviction.
- Text cleanup, truthful capability reporting, rendering, and translation memory.
- Content source replacement races and stale completion rejection.
- Renderer transaction rollback and Blob ownership.
- Preprocessing priority, slot limits, timeout/cancellation settlement.
- Long-image transaction commit, rollback, sibling cancellation, and segment ordering.
- Minimum-dimension boundaries, extreme-tall row coverage, and safe extreme-wide rejection.
- Dependency-free local reader endpoints for responsive, lazy, dynamic, protected, cross-origin, and unsupported source categories.
- Protected-reader transport endpoints for exact per-page Referer bytes, slow/hanging/disconnected bodies, invalid image payloads, and abortable large streams.
- Real Edge unpacked-extension flow through static/dynamic discovery, browser byte read, backend DirectML inference, Blob rendering, false-positive rejection, and queue settlement.
- Background operation isolation, retry invalidation, cache identity, tab generation.
- Exact-URL Referer rule serialization, terminal cleanup, and discovery-time rule rejection.
- Background-provider initialization cleanup for interrupted temporary and legacy Referer session rules.
- Dashboard stable keyed rows and safe preview policy.

## Manual gaps

Automated tests do not prove:

- Long-running Chrome/Edge MV3 service-worker suspension/restart behavior.
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
