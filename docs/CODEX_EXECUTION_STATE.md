# Codex execution state

## Recovery result

- Verified date: 2026-07-18, Asia/Bangkok.
- Active project: `manga-scaler` / AI Manga Upscaler.
- Repository: `https://github.com/tai0huynh-ux/manga-scaler.git`.
- Branch: `main`.
- Starting recovered HEAD: `7b8da5616a36a7fcfbab4520a49a9211868c06f7`.
- Starting HEAD for the protected-read lifecycle checkpoint: `83c0c2ebc67ff8c7daa3414628fd599b3205a758`.
- `origin/main`: matched `83c0c2ebc67ff8c7daa3414628fd599b3205a758` with zero divergence before implementation.
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
- Deterministic Edge unpacked-extension E2E is automated and green against the real loopback backend/model.
- Representative Manga/Manhwa/Manhua and hentaivnx live-site acceptance is green for the current point-in-time public pages.
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

Expand backend restart/cancellation E2E without reopening the green Processing Monitor, HTTP 422, live-reader, worker/DNR, or extreme-geometry contracts.

## Extreme-image geometry contract checkpoint

- Added the exact eight-case minimum-dimension matrix from `16x16` through the `299/300/301` boundary and asymmetric `300x100` / `100x300` cases.
- Expanded deterministic vertical slicing coverage to `512x16384` and `768x32768`, asserting every source row is covered exactly once with no gaps or overlap.
- Expanded safe extreme-wide rejection to `16384x512` and `32768x768`; neither input may enter vertical slicing.
- Real Edge rendered `768x32768` through vertical slicing with 55 raw slices and 55/55 ready Blob replacements; interrupted repeated runs can leave heavy backend work queued and are not acceptance evidence.
- Verified synthetic fixture PNG dimensions from IHDR metadata for every small/boundary case; no binary reader asset was committed.
- Full verification passed 52 backend tests, 155 extension tests, JavaScript checks, Ruff, and 72% backend coverage. Real Edge fixture/lifecycle E2E passed with queue/rules settled and zero duplicate replacements, stale Chapter A entries, or browser exceptions.
- Secret filename, tracked runtime-artifact, and fixture copyright-artifact scans returned zero findings. `git fsck --full` returned success with dangling objects only.
- This checkpoint changes tests and verified state only; it does not claim a real-browser render of the `32768`-pixel synthetic case.

## Clean live-reader acceptance checkpoint

- The live harness scrolls by stable image markers, waits until each image owns preprocessing work, and clicks a real semantic close control when an advertisement overlay blocks the candidate probes. It never removes or hides site nodes directly.
- Pending queue updates retain the original trace and emit `background.job.reprioritized` instead of a second enqueue event. Duplicate evidence includes operation identity, so replacement operations sharing one correlation trace are not conflated.
- TruyenQQ Manga: `22/22` detected and replaced, `42/42` backend completions.
- TruyenQQ Manhwa: `75/75` detected and replaced, `56/56` backend completions, `210/210` raw slices ready.
- TruyenQQ Manhua: `26/26` detected and replaced, `109/109` backend completions, `108/108` raw slices ready.
- hentaivnx: `16/16` detected and replaced, `33/33` backend completions, `32/32` raw slices ready.
- Every live run completed with false positives `0`, duplicate jobs `0`, stale replacements `0`, sanitized failures `0`, residual Referer rules `0`, and queue size/waiting/processing `0`.
- Deterministic Edge lifecycle acceptance passed worker stop/reactivation, unrelated-rule preservation, navigation invalidation, extension reload recovery, and queue/rule settlement with browser exceptions `0`.
- Full verification passed 52 backend tests, 155 extension tests, JavaScript checks, Ruff, and 72% backend coverage.
- Green implementation/state commit: `915920450d9d3975fc6db807e530dd9292c9a129`; use it as the starting baseline for the extreme-image geometry checkpoint.

## HTTP 422 and browser-owned request checkpoint

- Root cause: persisted/output-limit drift could send `body.maxOutputWidth=128`; FastAPI rejects it with validation type `greater_than_equal` because the contract minimum is `256`.
- Backend validation failures now return only sanitized field/type/message plus trace ID. The extension preserves those fields through the registry and Dashboard, and treats 422 as non-retryable.
- Every backend dispatch passes through one request normalizer. It clamps recoverable numeric drift, rejects non-finite values, unsupported modes/tile sizes and malformed text settings, emits only sanitized request metadata, and declares request schema version 1.
- Stored settings migrate idempotently to schema version 1, keep known valid values, bound numeric fields, reject wrong boolean types/unknown keys, and reset the unsupported historical value `anime` to the documented default instead of claiming an unproven legacy mapping.
- With browser-owned `imageData`, the API accepts Blob/Data metadata or no source URL and does not invoke the downloader. Without bytes, only HTTP/HTTPS URLs are accepted.
- Verification: 52 backend tests, 141 extension tests, JavaScript checks, Ruff, 72% coverage, secret/runtime-artifact scans with zero findings, and deterministic Edge lifecycle E2E PASS. Edge produced stable Blob replacements, duplicate replacements `0`, stale Chapter A entries `0`, residual Referer rules `0`, browser exceptions `0`, and queue processing/waiting/size `0`.
- Commit/push: `f0da83c7c94d796b0e240d02d4945ef7d190133d` reached `origin/main` with zero divergence.
- Live-site URL acceptance was not rerun because `AI_MANGA_LIVE_URL` was not supplied; the deterministic contract-equivalent fixture is the current runtime proof.

Processing Monitor synchronization is now in progress on `codex/live-reader-acceptance-c518`; direct Dashboard browser interaction/load acceptance passed after the normal merge from current `origin/main`. Main integration remains pending the live-site decision.

## Protected-read lifecycle acceptance checkpoint

- Startup cleanup now recognizes the smallest current exact-rule signature instead of deleting any Referer rule in a broad numeric range; unrelated and non-Referer session rules remain untouched.
- Every protected read awaits one idempotent initialization barrier, skips all active rule IDs, and cannot race delayed cleanup. Cleanup inspection/update rejection settles instead of permanently blocking reads.
- HTTP(S) matching preserves query order and percent encoding, strips fragments that cannot reach the network request, skips DNR for Blob/Data URLs, and installs exact follow-up rules for observed redirect targets including HTTP-to-HTTPS.
- Same-URL reads remain serialized across page Referers. Cancellation, timeout, invalid bytes, disconnect, redirect, and success release locks and remove every installed temporary rule.
- Real Edge CDP stops the actual unpacked MV3 service-worker version during a stalled protected read. The replacement worker removes the orphan rule, preserves an unrelated rule, does not render/retry the old image, and processes a new image.
- Same-tab Chapter A to Chapter B navigation aborts and removes Chapter A work/rules; Chapter B renders once and no Chapter A registry entry remains.
- `chrome.runtime.reload()` now recovers without page reload. Content script block scoping permits safe reinjection, and a DOM-backed instance lease prevents old/new content contexts from racing or duplicating replacements.
- Edge lifecycle result: zero browser exceptions, zero duplicate replacements, zero residual Referer rules, and queue/active/retry/read-lock state settled to zero.
- Verification: 47 backend tests, 126 extension tests, JavaScript syntax checks, Ruff, 71% backend coverage, and real Edge fixture/lifecycle E2E passed.
- Commit/push: `f21a208b31b228e4f6043dae211cbb93f3bded12` is at `origin/main` with zero divergence and a clean tree at the checkpoint boundary.

## Live reader slicing and candidate-filter checkpoint

- Real HTMLElement getter-only `dataset` objects now work through raw-slice preparation and segment registration without replacing the DOM property.
- Reader-chrome detection walks nested `.reading-detail.box_doc` ancestors; common one-pixel tracking GIFs and `noavatar` assets are rejected before scheduling.
- The live harness snapshots original chapter images before raw-slice insertion and measures a sliced original as complete only when every raw slice has a stable Blob replacement.
- Hive 293 measured 75/75 detected, 66/75 replacements (88%), 184/184 backend successes, zero sanitized failures, zero residual rules, and zero extension exceptions; nine originals remained unreplaced.
- Manhua 320 measured 26/26 replacements with 110/110 backend successes in the clean first-pass run, but two reader-chrome false positives blocked PASS.
- Backend `/health` stopped responding after repeated live runs; no hentaivnx or clean Manga result is claimed.
- Integrated commit/push: `c7b687e3be6acbbf9dc944fb3be959cf6edf3106` reached `origin/main`; full verification passed 49 backend tests, 139 extension tests, JavaScript checks, Ruff, and 71% coverage.

## Worker-restart Referer cleanup checkpoint

- Provider initialization enumerates extension session rules and removes only Referer-modifying rules with IDs from `1000` through `199999`, covering current temporary rules and the retired broad-rule range.
- New browser reads await the cleanup barrier, preventing a new rule from racing removal of a reused stale ID.
- The regression first failed with rule IDs `1000` and `100000` left active, then passed after the fix while unrelated rules were preserved.
- Full verification passed 47 backend tests and 114 extension tests with JavaScript syntax checks, Ruff, and 71% backend coverage.
- Real Edge fixture E2E remained green with two completed `768x768` Blob replacements and queue size/waiting/processing all zero.
- Deterministic browser-level worker termination/reload during an active protected read is proven; representative live-site lifecycle acceptance remains pending.

## Exact-URL Referer isolation checkpoint

- The regressions first failed because discovery installed one broad session rule and two same-URL reads started concurrently under different Referers.
- Image discovery no longer mutates DNR state.
- Temporary Referer rules remain exact-URL scoped and reads for the same URL are serialized; different image URLs retain normal concurrency.
- Success, invalid image bytes, body disconnect/failure, and body-consumption abort all remove their temporary rule.
- The exact-URL read-lock registry returns to zero after settlement.
- Full verification passed 47 backend tests and 113 extension tests with JavaScript syntax checks, Ruff, and 71% backend coverage.
- Real Edge fixture E2E passed with two completed `768x768` Blob replacements and queue size/waiting/processing all zero.

## Protected reader transport fixture checkpoint

- Exact `/chapter/a` and `/chapter/b` Referers return distinct valid PNG bytes from the same image URL; missing or incorrect Referer returns HTTP 403.
- Slow, hanging, disconnected, invalid-MIME/body, invalid-magic, and large streaming response paths are deterministic and dependency-free.
- The tests first failed with HTTP 404 before route implementation, then passed 6/6.
- Full verification passed 47 backend tests and 110 extension tests with JavaScript syntax checks, Ruff, and 71% backend coverage.
- Real Edge fixture E2E remained green with two `768x768` Blob replacements and queue size/waiting/processing all zero.
- No production runtime behavior changes in this fixture-only checkpoint.

## Unpacked-extension E2E checkpoint

- Browser: Microsoft Edge 150, isolated temporary profile, repository extension loaded unpacked.
- Backend: real loopback FastAPI service with `DmlExecutionProvider` and `anime_x4` model.
- Fixture: synthetic PNG-only focused E2E page plus the broader deterministic reader server.
- Result: two eligible images accepted and completed, including one dynamically inserted image.
- Rendering: both source URLs replaced by ready Blob outputs at `768x768`.
- Rejection: `299x299`, `300x100`, and a 300 px logo were not scheduled.
- Settlement: backend queue size/waiting/processing returned to zero; failed and cancelled stayed zero.
- Boundary: this proves the focused local flow, not live-site Manga/Manhwa/Manhua acceptance or long-running service-worker restart behavior.

## Live-site discovery checkpoint

- Git was revalidated after quarantining one recreated `.git/objects/0f/desktop.ini`; `git fsck --full` returned success with only the known dangling blob, fetch passed, `HEAD` matched `origin/main` at `37cc0ed`, divergence was zero, and the tree was clean.
- `www.hentaivnx.live` and a public reader returned HTTP 200. The sampled reader exposed 15 chapter images on a cross-origin CDN plus non-chapter reader chrome.
- Edge reproduced `DISCOVERY-002`: `/images/bn.png` reader chrome was accepted and rendered as a Blob. A structural regression now rejects direct reader chrome outside explicit `.page-chapter` containers while preserving page images.
- Edge reproduced `DISCOVERY-003`: chapter records could remain in `preprocessing` while the backend queue stayed empty. Browser image reads now race both `fetch` and `response.arrayBuffer()` against abort, with a regression for a response body that ignores the signal.
- CDN evidence: the sampled image redirected without Referer and returned HTTP 200 JPEG with the reader Referer. The final live diagnostic did not produce stable chapter completion evidence because worker evaluation became unavailable; cleanup succeeded and backend queue counters settled to zero.
- No cookies, browser profiles, screenshots, downloaded reader content, or session-token URLs were committed.
- TruyenQQ remains an external/manual blocker: previously attempted domains timed out or resolved to an unrelated SEO shell, so one current public reader/chapter URL is required.

## Processing Monitor contract checkpoint

- Work continues only on `codex/live-reader-acceptance-c518` in the isolated `c518` worktree. Starting `HEAD` and branch upstream matched `093fd7b3988f9a22b5018d6587a5a1f0def0b90c`; no main-checkout integration was performed.
- Added a versioned processing-event contract and lifecycle ownership map. Terminal states cannot revive, progress is indeterminate unless measured, structured 422 errors are non-retryable, and sensitive image/credential/URL data is excluded.
- `COMPLETED` now has a contract-level renderer-commit guard. Runtime still uses the legacy registry and must be wired in the next checkpoint before this invariant is production-enforced.
- Verification: 139 extension tests, 47 backend tests, JavaScript syntax checks, Ruff, and 71% backend coverage passed. Full-equivalent backend gates used the existing project virtualenv because the isolated worktree has no `.venv`.
- Next exact action: add the bounded monitor store and operation-aware lifecycle ingestion, then make content-side render confirmation the only completion event.

## Processing Monitor lifecycle checkpoint

- Added `ProcessingMonitorStore` persistence through `chrome.storage.session` plus sanitized local history, deterministic prune, worker-restart interruption recovery, segment aggregation, and dashboard snapshot APIs.
- Background queue/cache/backend paths now report queue, backend send, result receipt, retry/deferred, timeout/failure, and cancellation events. Content reports render preparation/rendering and DOM commit/failure. Processed statistics increment only after a confirmed commit.
- Dashboard monitor uses the existing Dashboard page and exposes summary cards, filters, keyed rows, timeline/detail diagnostics, trace copy, sanitized export, cancel, retry, and terminal-history clearing.
- Verification: 152 extension tests, 47 backend tests, JavaScript checks, Ruff, 71% coverage, a 500-job snapshot/filter load gate, and deterministic Edge lifecycle E2E passed. No main-checkout files were changed.
- Next exact action: add dashboard-specific Edge assertions for persistence/cancel/retry/export and a 100-500 synthetic-job load gate before final acceptance.
