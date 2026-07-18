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

Run representative live-reader acceptance on current public TruyenQQ Manga/Manhwa/Manhua chapters, then hentaivnx when no external challenge blocks automation. Require stable DOM Blob replacement, zero false-positive chrome, zero duplicate/stale work, settled queues, and no temporary Referer rules.

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
