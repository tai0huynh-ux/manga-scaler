# Codex execution state

## Recovery result

- Verified date: 2026-07-18, Asia/Bangkok.
- Active project: `manga-scaler` / AI Manga Upscaler.
- Repository: `https://github.com/tai0huynh-ux/manga-scaler.git`.
- Branch: `main`.
- Starting and recovered HEAD: `7b8da5616a36a7fcfbab4520a49a9211868c06f7`.
- `origin/main`: matched recovered HEAD after a successful fetch.
- Divergence: `0` local-only / `0` remote-only commits.
- Working tree at recovery: clean; no staged, unstaged, or untracked source/test files.
- Git integrity: `git fsck --full` passed after exactly 250 injected `desktop.ini` files were moved out of `.git` into a recoverable external backup. One unreachable blob remained and Git classified it as dangling, not corruption.
- Recovery manifest: stored outside the repository under the local Codex backup directory; no Git ref, object, index, config, or valid metadata was rewritten.

## Last green checkpoint

- Commit `4a2e304` was the last implementation baseline documented before project-memory creation.
- Commit `7b8da56` added verified project-memory documentation without runtime changes.
- Full baseline verification on `7b8da56`: 47 backend tests passed, 98 extension tests passed, JavaScript syntax checks passed, Ruff passed, and total backend coverage was 71% against the 45% gate.

## Architecture and acceptance state

- Architecture ownership and runtime flows are mapped under `docs/project-memory/`.
- Unit and VM-based extension regressions cover core queue, stale-operation, renderer, slicing, API, provider, and tracing invariants.
- Browser-level unpacked-extension E2E is not automated.
- Representative manga/webtoon live-site acceptance remains manual and unproven for the current baseline.
- Production ONNX quality, DirectML/CUDA execution, OCR quality, text removal/reinsertion, soak, packaging, clean install, upgrade, and uninstall are not release-proven.

## Completed checkpoint

- Phase: deterministic test-system foundation.
- Added a loopback-only synthetic reader fixture with no copyrighted assets or external dependencies.
- Added and passed boundary cases `299x299`, `300x300`, `301x301`, `300x100`, and `100x300`.
- Reproduced and fixed the runtime/shared minimum-dimension drift (`128` versus the documented `300`).
- Added extreme-tall source-row coverage and safe extreme-wide rejection tests.
- Browser smoke proved the fixture loads dynamic, responsive, Blob/Data URL, cross-origin, protected, Shadow DOM, iframe, CSS, canvas, and `512x16384` geometry cases. This smoke did not load the unpacked extension.
- Unsupported discovery is explicit: Shadow DOM, iframe, CSS background, and canvas.

## Next exact action

Verify the active TruyenQQ domain and run sanitized representative-site Chrome/Edge acceptance. Record eligible/detected/requested/replaced counts, false positives, lazy-load behavior, ordering, anti-hotlink evidence, and external blockers without committing cookies, profiles, screenshots, or downloaded site content.

## Unpacked-extension E2E checkpoint

- Browser: Microsoft Edge 150, isolated temporary profile, repository extension loaded unpacked.
- Backend: real loopback FastAPI service with `DmlExecutionProvider` and `anime_x4` model.
- Fixture: synthetic PNG-only focused E2E page plus the broader deterministic reader server.
- Result: two eligible images accepted and completed, including one dynamically inserted image.
- Rendering: both source URLs replaced by ready Blob outputs at `768x768`.
- Rejection: `299x299`, `300x100`, and a 300 px logo were not scheduled.
- Settlement: backend queue size/waiting/processing returned to zero; failed and cancelled stayed zero.
- Boundary: this proves the focused local flow, not live-site Manga/Manhwa/Manhua acceptance or long-running service-worker restart behavior.
