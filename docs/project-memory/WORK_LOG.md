# Durable work log

Append one concise entry for every completed Codex change set. Keep old entries intact. Use exact verification, commit, and push results; do not record planned work as completed.

## Entry template

```markdown
## YYYY-MM-DD - Short title

- Request: What the user wanted.
- Changes: Files and behavior changed.
- Invariant/decision: Safety rule or design choice affected.
- Verification: Exact focused/full/manual results.
- Git: Commit hash and push result when known. An entry cannot contain the hash of the same commit that introduces it; in that case, identify the commit by its title and record the resulting hash in the completion report or a later entry.
- Remaining: Known blocker, follow-up, or `None`.
```

## 2026-07-18 - Repository-wide project memory

- Request: Create a deep durable project tree so future sessions can work without rereading every file and can resume after chat loss.
- Changes: Added the project-memory index, architecture tree, runtime flows, contracts/invariants, test/change map, current verified state, and this append-only work log; linked the maintenance workflow from `AGENTS.md` and project status documentation.
- Invariant/decision: Memory is modular and verification-backed. New sessions read the index and only the task-specific node; every completed change updates affected nodes and appends a work-log entry.
- Verification: Full `scripts/verify.ps1` passed: 47 backend tests, 98 extension tests, JavaScript syntax checks, Ruff, and 71% backend coverage. Project-memory Markdown links resolved and `git diff --check` passed.
- Git: This entry is introduced by the automatic sync commit for "Repository-wide project memory"; use `git log -- docs/project-memory/WORK_LOG.md` to recover its exact hash.
- Remaining: Keep this memory synchronized after every completed project change.

## 2026-07-18 - Recovery contract and mandatory state documents

- Request: Recover Git integrity without rewriting valid metadata, restore the mandatory project documents, and establish the next evidence-backed checkpoint.
- Changes: Quarantined injected Git `desktop.ini` files outside the repository with a path-preserving manifest; added `AI_PROJECT_RULES.md`, `PROJECT_STATE.md`, and `docs/CODEX_EXECUTION_STATE.md`; linked them from the project master and synchronized current project memory.
- Invariant/decision: Git recovery is recoverable and limited to exact injected filenames. Runtime work remains blocked from release claims until deterministic fixtures and real acceptance exist.
- Verification: `git fsck --full` and fetch passed; `HEAD` matched `origin/main` with zero divergence; the full gate passed both before and after the documentation change with 47 backend tests, 98 extension tests, Ruff, JavaScript syntax checks, and 71% backend coverage.
- Git: Introduced by the automatic sync commit for "Recovery contract and mandatory state documents"; use `git log -- docs/project-memory/WORK_LOG.md` to recover its exact hash.
- Remaining: Build the deterministic reader fixture and geometry boundary coverage.

## 2026-07-18 - Deterministic reader and geometry boundaries

- Request: Create the first offline reader fixture, add 300 px boundary and extreme-aspect tests, and fix only reproduced production bugs.
- Changes: Added a dependency-free two-origin synthetic reader server and contract tests; covered responsive, lazy, dynamic, protected, false-positive, same-URL byte-change, long-image, Blob/Data URL, Shadow DOM, iframe, CSS, and canvas cases; aligned extension minimum dimensions and background fallbacks to 300 px.
- Invariant/decision: Both input dimensions must meet the enabled 300 px minimum. Extreme-tall slicing covers every source row exactly once; extreme-wide images never enter vertical slicing and are rejected safely when over the width limit. Unsupported discovery sources remain explicit.
- Verification: The new boundary test first failed with `128 !== 300`, proving configuration drift. Targeted tests passed 101/101; the full gate passed 47 backend tests and 104 extension tests with Ruff, JavaScript syntax checks, and 71% backend coverage. In-app browser smoke loaded 22 light-DOM images plus the Shadow DOM and iframe fixtures with the expected synthetic dimensions.
- Git: Introduced by the automatic sync commit for "Deterministic reader and geometry boundaries"; use `git log -- extension/tests/reader_fixture.test.cjs` to recover its exact hash.
- Remaining: Automated unpacked-extension browser E2E is not yet implemented.

## 2026-07-18 - Real Edge fixture E2E

- Request: Continue automatically to the next safe checkpoint and prove the unpacked extension against the deterministic reader through a real backend/model.
- Changes: Added a dependency-free CDP Edge/Chrome E2E harness, a focused synthetic PNG route, isolated temporary browser profiles, extension service-worker proof, threshold/false-positive assertions, Blob-render assertions, and backend queue settlement checks.
- Invariant/decision: Browser E2E must prove discovery, dispatch, backend completion, exact DOM replacement, rejection behavior, and settled queues. SVG remains useful for browser discovery fixtures but real inference fixtures use Pillow-compatible PNG.
- Verification: The first E2E attempt reproduced deterministic SVG rejection before the backend. After switching the inference route to generated PNG, `test:e2e:edge-fixture` passed with two accepted/completed jobs, zero failed/cancelled jobs, two `768x768` Blob outputs, and queue size/waiting/processing all zero. The full gate passed 47 backend tests and 105 extension tests with Ruff, JavaScript syntax checks, and 71% backend coverage.
- Git: Introduced by the automatic sync commit for "Real Edge fixture E2E"; use `git log -- extension/tests/e2e/edge_fixture_e2e.cjs` to recover its exact hash.
- Remaining: Representative live-site and expanded navigation/restart/long-image browser acceptance remain unproven.

## 2026-07-18 - Live reader false-positive and browser-read settlement

- Request: Continue recovery into the first incomplete live-site checkpoint, preserve Git integrity, and fix only runtime-proven failures.
- Changes: Rejected reader chrome outside explicit page containers and added an abort race around browser fetch plus response-body reads; added `DISCOVERY-002` and `DISCOVERY-003` regressions.
- Invariant/decision: Reader chrome must not be upscaled as chapter content, and a CDN response that ignores abort must never retain a preprocessing slot indefinitely.
- Verification: Both regressions failed before their fixes and passed afterward. Fast verification passed 47 backend tests and 107 extension tests. The real Edge deterministic E2E passed with two `768x768` Blob replacements and settled queues. Hentaivnx HTTP/DOM discovery and Referer behavior were verified, but live chapter replacement was not proven because the final worker diagnostic became unavailable.
- Git: Introduced by the automatic sync commit for "Live reader false-positive and browser-read settlement"; use `git log -- docs/project-memory/WORK_LOG.md` to recover its exact hash.
- Remaining: Obtain one current public TruyenQQ reader URL and repeat worker-restart-safe live acceptance; do not claim representative live-site PASS yet.

## 2026-07-18 - Protected reader transport fixture

- Request: Continue Phase A1 with deterministic evidence for protected-reader Referer and response-body failure boundaries.
- Changes: Added exact per-chapter Referer responses with distinct bytes at one URL, slow and hanging bodies, mid-body disconnect, HTTP 200 HTML, invalid PNG magic bytes, and an abortable large stream; documented the fixture matrix.
- Invariant/decision: The fixture must reproduce transport and validation boundaries without external sites, copyrighted content, unbounded buffers, or leaked response timers. Production behavior is unchanged in this checkpoint.
- Verification: The new tests first failed with HTTP 404 before the fixture routes existed. Focused fixture tests passed 6/6; the full repository gate passed 47 backend tests and 110 extension tests with JavaScript syntax checks, Ruff, and 71% backend coverage; the real Edge fixture E2E passed with two `768x768` Blob replacements and all queue counters at zero.
- Git: Introduced by the automatic sync commit for the protected reader transport fixture; use `git log -- extension/tests/fixtures/reader/server.cjs` to recover its exact hash.
- Remaining: Add failing DNR lifecycle/isolation regressions, then apply the smallest production fix and repeat real browser acceptance.

## 2026-07-18 - Exact-URL Referer rule isolation

- Request: Continue Phase A1 and prevent protected-reader DNR rules from leaking or crossing page Referers.
- Changes: Removed broad persistent Referer rules from image discovery; serialized temporary browser reads per exact image URL while preserving concurrency across different URLs; proved rule removal after success, invalid image data, mid-body failure, and abort.
- Invariant/decision: At most one temporary Referer rule may govern a given exact image URL at a time. Discovery creates no DNR mutation, every terminal read removes its rule, and the per-URL lock registry settles to zero.
- Verification: Both regressions failed before the fix: discovery produced one broad session rule and concurrent same-URL reads started two fetches. Seven focused DNR/read tests passed after the fix; the full gate passed 47 backend tests and 113 extension tests with JavaScript syntax checks, Ruff, and 71% backend coverage; real Edge fixture E2E passed with two `768x768` Blob replacements, zero failures/cancellations, and settled queues.
- Git: Introduced by the automatic sync commit for exact-URL Referer rule isolation; use `git log -- extension/src/background.js` to recover its exact hash.
- Remaining: Prove navigation and extension reload cleanup while a protected read is active, then resume representative live-site acceptance.

## 2026-07-18 - Worker-restart Referer cleanup

- Request: Continue Phase A1 and prevent a terminated MV3 worker from leaving Referer session rules active after the next worker initialization.
- Changes: Added a provider initialization barrier that enumerates session rules, removes only Referer-modifying rules in the extension-owned current/legacy ID range, and completes before any new browser-read rule is installed.
- Invariant/decision: Worker initialization must recover interrupted DNR state without deleting unrelated session rules or racing a new exact-URL read with stale-rule cleanup.
- Verification: The regression first failed with both interrupted rule IDs still present. Five focused DNR tests passed after the fix; the full gate passed 47 backend tests and 114 extension tests with JavaScript syntax checks, Ruff, and 71% backend coverage; real Edge fixture E2E remained green with two `768x768` Blob replacements and settled queues.
- Git: Introduced by the automatic sync commit for worker-restart Referer cleanup; use `git log -- extension/src/background.js` to recover its exact hash.
- Remaining: Real browser worker termination/reload during an active protected read is still unproven.

## 2026-07-18 - Protected-read lifecycle acceptance

- Request: Prove protected image reads across actual MV3 worker termination/reactivation, same-tab navigation, and unpacked-extension reload before resuming live-site acceptance.
- Changes: Narrowed startup cleanup to the exact owned-rule signature; reserved active DNR IDs; normalized network URLs without reordering query parameters; added exact redirect-target rules; skipped Blob/Data DNR; made content reinjection parse-safe; and added a newest-instance DOM lease with stale marker/work invalidation.
- Invariant/decision: No startup cleanup may remove an unrelated rule, no protected read may install before initialization settles, no old content context may commit after reload, and every terminal path must settle rules, locks, retries, registry, and queues.
- Verification: Focused tests first reproduced broad cleanup, fragment/blob/data handling, ID reuse, delayed-cleanup races, and reload duplicate-context failures. The final gate passed 47 backend tests and 126 extension tests with JavaScript checks, Ruff, and 71% backend coverage. Real Edge stopped the actual service-worker version during a stalled read, restarted through a real content event, preserved an unrelated rule, rejected the old image, rendered a new image, invalidated Chapter A on navigation, automatically recovered after `chrome.runtime.reload()`, produced zero duplicate replacements and browser exceptions, and settled all temporary rules/queues/locks.
- Git: Pending the automatic sync commit for this checkpoint.
- Remaining: Run representative TruyenQQ Manga/Manhwa/Manhua and hentaivnx DOM-replacement acceptance; SPA/history navigation remains outside the current deterministic fixture.
## 2026-07-19 - Partial public live-reader acceptance

- Request: Continue Phase A1 live-reader acceptance in the isolated worktree without changing the main checkout.
- Changes: Added a public-reader E2E command, rejected lazy comment `noavatar` assets, added backend uptime/counter rollback detection, bounded health polling, timeout snapshots, and sanitized diagnostic source identities.
- Invariant/decision: Live evidence must not count backend counters after a restart, classify comment/avatar UI as chapter content, or expose query values/full source URLs in diagnostics.
- Verification: Full gate-equivalent commands passed using the existing project Python runtime: 47 backend tests, 133 extension tests, JavaScript checks, Ruff, and 71% coverage. Deterministic Edge lifecycle E2E passed. Manga One Piece on `truyenqqko.com` passed 64/64 replacements and 116/116 backend completions, including two sliced images. Manhua Yêu Thần Ký passed 3/3 replacements and 17/17 backend completions, including one sliced image. A heavy Manhwa chapter did not settle within 240 seconds; an earlier heavy chapter caused a backend restart under load, now detected as a failed acceptance condition.
- Git: Pending the isolated worktree checkpoint commit and push; no main-checkout files were changed.
- Remaining: Bound and fix heavy Manhwa segmentation/backend restart behavior; rerun hentaivnx only when external challenges permit stable evidence.

## 2026-07-19 - Processing Monitor event contract

- Request: Begin the Processing Monitor/Image Diagnostic mission in the isolated `c518` worktree without modifying the main checkout.
- Changes: Added schema version 1, the real/optional stage vocabulary, allowed transitions, terminal guards, renderer-commit completion enforcement, structured error normalization, URL sanitization, sensitive payload exclusion, measured-progress enforcement, and a verified lifecycle ownership map.
- Invariant/decision: Backend response completion is not DOM completion. `COMPLETED` is legal only after the current content renderer confirms its transaction commit. Internal stages are indeterminate and must not be fabricated when no current event reports them.
- Verification: The new tests first failed because the contract module did not exist. The completed checkpoint passed 139 extension tests, 47 backend tests, JavaScript syntax checks, Ruff, and 71% backend coverage. The repository verification script could not locate a worktree-local `.venv`; the same full commands were run with the existing project virtualenv against this isolated worktree.
- Git: Pending automatic isolated-branch sync for `feat(monitor): define processing event contract`.
- Remaining: Wire lifecycle events and persisted bounded history, then move terminal completion authority to the confirmed renderer commit.

## 2026-07-19 - Processing Monitor lifecycle and Dashboard

- Request: Continue the isolated Processing Monitor mission through runtime wiring and Dashboard expansion without changing the main checkout.
- Changes: Added bounded sanitized monitor session/local persistence with worker-restart recovery, operation-aware lifecycle ingestion, segment parent linkage/aggregation, structured backend errors with 422 retry blocking, content render-start/commit/failure messages, post-DOM statistics, Dashboard summary/table/timeline/filter/actions/export, and content cancel/retry handling.
- Invariant/decision: Backend receipt is `RECEIVING_RESULT`; only a current content renderer `RENDER_COMMITTED` event may change a registry row to `fixed/cache` and increment processed statistics. Monitor event ingestion is serialized so render preparation cannot race commit.
- Verification: Full extension suite passed 152 tests, including a 500-job snapshot/filter load gate; backend 47 tests; JavaScript checks; Ruff; 71% coverage; deterministic Edge fixture/lifecycle E2E passed with zero browser exceptions, zero failed/cancelled jobs, and settled queues. The existing worktree-equivalent Python runtime was used because `.venv` is absent in this isolated checkout.
- Git: Pending automatic isolated-branch sync for `feat(monitor): expose image job lifecycle`.
- Remaining: Add monitor-specific browser dashboard/recovery/load assertions and complete the final acceptance matrix; representative heavy Manhwa remains a known external throughput limitation.

## 2026-07-19 - Processing Monitor deterministic browser evidence

- Request: Close the monitor E2E assertion gap in the isolated worktree without changing the main checkout.
- Changes: Connected to the initial Edge service worker, asserted the monitor snapshot after two real DOM Blob commits, verified every completed row has `renderCommit.confirmed === true`, excluded image bytes, and closed the initial CDP client before worker-stop lifecycle checks.
- Invariant/decision: The monitor assertion must observe the same live worker that processed the successful page, while the lifecycle stop test must not keep that worker target artificially alive.
- Verification: `npm.cmd test` passed 152 extension tests; backend pytest passed 47 tests; Ruff and 71% coverage passed; `npm.cmd run test:e2e:edge-fixture` passed with two completed jobs, zero browser exceptions, zero failed/cancelled jobs, settled queues, worker restart, navigation, and reload evidence.
- Git: Pending automatic isolated-branch sync; main checkout remains untouched.
- Remaining: Dashboard UI interaction coverage and representative heavy Manhwa/hentaivnx acceptance remain open.

## 2026-07-19 - Live reader harness and slicing DOM compatibility

- Request: Continue automatically from the pushed lifecycle checkpoint into live TruyenQQ acceptance and repair only runtime-proven regressions.
- Changes: Added the Edge live-reader harness with original-image snapshotting, complete sliced-group Blob measurement, quiescence evidence, and exception classification. Removed whole-object `dataset` assignments from raw-slice preparation/registration. Reader-chrome filtering now walks nested reading containers and rejects one-pixel tracking GIFs and `noavatar` assets.
- Invariant/decision: Real HTMLElement getter-only DOM properties remain intact. A live PASS requires stable Blob replacement for at least 95% of original eligible chapter images, zero extension-owned false positives, zero duplicates/stale work, settled queues, and zero temporary rules.
- Verification: The dataset regression failed before the production fix and passed afterward. Integrated full verification passed 49 backend tests, 139 extension tests, JavaScript checks, Ruff, and 71% coverage. Hive 293 measured 75/75 detected and 66/75 stable replacements (88%) with 184/184 backend successes, zero extension exceptions, and zero residual rules. Manhua 320 measured 26/26 replacements and 110/110 backend successes but exposed reader-chrome false positives. No hentaivnx or clean Manga PASS is claimed because the backend became unresponsive after repeated live runs.
- Git: Integrated changes committed and pushed as `c7b687e3be6acbbf9dc944fb3be959cf6edf3106`.
- Remaining: Repair Hive's detected-but-unreplaced scheduling path, restart the backend in a clean isolated process, then rerun all three TruyenQQ readers before hentaivnx.

## 2026-07-19 - HTTP 422 diagnostics and browser-owned request contract

- Request: Identify the exact 422 field, preserve safe validation details, normalize request/settings drift, prefer browser-owned bytes, and prove the lifecycle/runtime gate remains settled.
- Changes: Added the structured FastAPI validation handler and Dashboard error contract; made 422 non-retryable; normalized every upscale request with schema version 1; added idempotent persisted-setting migration; allowed Blob/Data/missing URL metadata only with `imageData`; skipped backend download when browser bytes exist; corrected live-reader eligible-image reporting.
- Invariant/decision: Browser-owned bytes are authoritative. URL-only requests remain HTTP/HTTPS, unsafe schemes never reach the downloader, request diagnostics never contain full URLs or image bytes, and local contract failures never retry.
- Verification: Reproduced `body.maxOutputWidth=128` / `greater_than_equal`; normalized dispatch sends `256`. Full verification passed 52 backend tests, 141 extension tests, JavaScript checks, Ruff, and 72% coverage. Real Edge fixture/lifecycle E2E passed with stable Blob rendering, duplicate replacements `0`, stale Chapter A entries `0`, residual rules `0`, browser exceptions `0`, and settled queue. Secret and tracked runtime-artifact scans found zero hits.
- Git: Contract implementation committed and pushed as `f0da83c7c94d796b0e240d02d4945ef7d190133d`; documentation and final harness correction follow in the next green sync commit.
- Remaining: A representative live reader still requires an explicit `AI_MANGA_LIVE_URL`; current runtime evidence is deterministic contract-equivalent rather than a new live-site PASS.
## 2026-07-19 - Live-reader identity evidence and Hive scheduling checkpoint

- Request: Continue clean live-reader acceptance with stable image identity and per-image sanitized evidence.
- Changes: Added stable marker/operation identity to the Edge live harness; excluded renderer-owned Blob slices from source inventory; captured sanitized URL, byte-length, source-kind, normalized output limits, backend status, trace, DOM dimensions, duplicate, failure, and cleanup evidence; preserved nested request metadata in sanitized background traces; added deterministic helper tests. Added a focused regression for requeueing discovered `seen` images when they re-enter prefetch.
- Verification: `npm.cmd test` passed 148 extension tests and JavaScript checks; `scripts/verify.ps1 -Fast` passed 52 backend tests and 148 extension tests. Clean Manga 1188 passed 64/64 replacements with 68/68 backend completions, zero duplicates/stale replacements, zero false positives, and zero residual rules. Clean Hive 293 remained 66/75 replacements (88%) with nine bottom reader images left `seen`; no backend failures, duplicate jobs, stale replacements, extension exceptions, or residual rules were observed.
- Decision: Live gate remains `FIX_REQUIRED`; extreme-image work is not started.
- Remaining: Determine why the nine bottom Hive nodes remain `seen` despite `refreshPriorities()` requeue coverage, then rerun Manhwa, Manhua, and hentaivnx.

## 2026-07-19 - Processing Monitor main synchronization and Dashboard browser gate

- Request: Validate and complete the Processing Monitor against current `main`, then prove the real Dashboard before any main integration.
- Changes: Merged current `origin/main` into the feature branch with a normal merge (`66c1022`), preserving the 52-test HTTP 422/browser-owned request contract. Added Dashboard site/tab/search filters and stage-specific clear actions. Retry now returns a new content operation and the background records a linked monitor retry attempt with incremented `retryCount`.
- Invariant/decision: Dashboard actions are tested through the real extension page and service-worker message boundary. A retry cannot revive the terminal operation; it creates a new operation linked to the original. Cancellation removes the scheduler job and invokes backend cancellation when a backend job is active.
- Verification: 172 extension tests, 52 backend tests, Ruff, 72% coverage, and deterministic Edge fixture/lifecycle E2E passed. Dashboard Edge evidence passed with summary counts (2 completed, 2 failed, 1 cancelled, 1 timed out, 1 cache hit), status/stage/site/tab/search filters, sanitized 422 detail/export, retry `count=1` linked to its parent, real cancellation, reload recovery, and 500 synthetic jobs rendered in 80 ms with 11 ms filter and 7 ms detail latency; browser exceptions were zero. Exact `https://hentaivnx.live` root fetch failed externally; no explicit Manhwa URL was supplied for a new run, so prior Hive 293 66/75 evidence remains the current bounded result.
- Git: Merge commit `66c1022` is in the isolated branch; the Dashboard/retry changes are pending the next safe sync. Main has not been modified.
- Remaining: Run/record a clean Manhwa URL gate when supplied, preserve the hentaivnx external blocker, then integrate only after the final main preflight.

## 2026-07-19 - Clean four-site live-reader acceptance

- Request: Finish the interrupted live-reader checkpoint, repair only runtime-proven site failures, and require at least 95% stable Blob replacement with zero false positives, duplicate/stale work, residual rules, or unsettled queues.
- Changes: The Edge harness now waits by stable marker, captures promotion blockers, and clicks a real visible semantic close control when an advertisement overlay occludes the reader. Pending queue updates preserve the original trace and emit `background.job.reprioritized`; enqueue duplicate evidence includes operation identity so separate replacement operations sharing a correlation trace remain distinct.
- Invariant/decision: Production occlusion rules remain conservative. The harness may dismiss a visible overlay through its actual control but never mutates site DOM to hide or remove it. Job identity is operation-scoped, while trace identity remains correlation-scoped.
- Verification: TruyenQQ Manga passed `22/22` with `42/42` backend completions; Manhwa passed `75/75` with `56/56`; Manhua passed `26/26` with `109/109`; hentaivnx passed `16/16` with `33/33`. Every run reported false positives `0`, duplicate jobs `0`, stale replacements `0`, failures `0`, residual Referer rules `0`, and queue size/waiting/processing `0`. Deterministic Edge worker/navigation/reload E2E passed. Full verification passed 52 backend tests, 155 extension tests, JavaScript checks, Ruff, and 72% coverage.
- Git: Implementation and verified state committed as `915920450d9d3975fc6db807e530dd9292c9a129`; the documentation pointer follow-up records this hash before push.
- Remaining: Start extreme-image geometry and rendering acceptance from the pushed green baseline.

## 2026-07-19 - Deterministic extreme-image geometry contract

- Request: Continue from the clean live-reader baseline and close the extreme-image geometry checkpoint before starting Processing Monitor work.
- Changes: Expanded the minimum-dimension matrix to eight exact small/boundary cases; covered row-complete slicing for `512x16384` and `768x32768`; proved `16384x512` and `32768x768` never enter vertical slicing; and verified generated fixture PNG dimensions from IHDR metadata without binary assets.
- Invariant/decision: The shared 300 px minimum remains exact, every tall source row is represented once, and unsafe extreme-wide images are rejected without invoking vertical slicing. No production behavior changed, and no real-browser `32768`-pixel render is claimed.
- Verification: Focused geometry tests passed `3/3`; fixture tests passed `7/7`; full verification passed 52 backend tests, 155 extension tests, JavaScript checks, Ruff, and 72% coverage. Real Edge fixture/lifecycle E2E passed with queue/rules settled and zero duplicate replacements, stale navigation entries, or browser exceptions. Secret filename, tracked runtime-artifact, and fixture copyright-artifact scans returned zero findings; `git fsck --full` succeeded with dangling objects only.
- Remaining: Start the Processing Monitor checkpoint with a fresh branch/worktree/ancestry preflight and direct Dashboard browser E2E acceptance.

## 2026-07-19 - Real-browser extreme geometry acceptance

- Request: Complete the next documented geometry checkpoint after Processing Monitor integration.
- Changes: Added a dedicated `/geometry-e2e` deterministic reader page containing a real `768x32768` PNG, a focused fixture regression, and an Edge target that waits for the actual vertical-slice Blob DOM commit and backend settlement.
- Invariant/decision: The extreme image must remain one source DOM node, must not be treated as a direct replacement, and every raw slice must commit as a ready Blob before the browser gate passes. Interrupted repeated runs may leave heavy backend work queued and are not counted as acceptance.
- Verification: Focused reader fixture tests passed 9/9; full extension suite passed 180 tests; backend passed 52 tests; Ruff and 72% coverage passed. A clean Edge run passed `768x32768` with 55 raw slices, 55/55 ready Blob replacements, one source node, zero browser exceptions, and settled queue state.
- Git: Pending feature checkpoint commit and fast-forward integration into `main`; no main files changed in this change set yet.
- Remaining: Expand backend restart/cancellation E2E, reliability soak, and production-quality benchmarks.

## 2026-07-19 - Processing Monitor integrated into main

- Request: Validate the isolated Processing Monitor against current `main`, preserve every HTTP 422/live-reader/lifecycle/geometry contract, prove the real Dashboard, and integrate the green result into `main`.
- Changes: Merged current main into `codex/live-reader-acceptance-c518` with hunk-level state resolution, retained all current tests, added active/pending operation diagnostics to the lifecycle harness, then fast-forwarded `main` to integration commit `0e4f3f91bf15463ba5454e6b455438f32aa80d0e`.
- Invariant/decision: Monitor state is sanitized and bounded; stale or terminal operations cannot revive; `COMPLETED` requires a confirmed DOM render commit; 422 remains structured and non-retryable; Dashboard actions cross the real MV3 service-worker boundary.
- Verification: Full main gate passed 52 backend tests, 179 extension tests, JavaScript checks, Ruff, and 72% coverage. Edge Dashboard/lifecycle E2E passed summary/filter/detail, sanitized export, cancel, linked retry, reload recovery, 500-job load, worker termination, navigation, extension reload, queue/rule settlement, and zero browser exceptions. Existing clean live acceptance remains `22/22` Manga, `75/75` Manhwa, `26/26` Manhua, and `16/16` hentaivnx with zero duplicate/stale work or residual rules.
- Remaining: Add backend restart/cancellation E2E, reliability soak, and production-quality benchmarks.

## 2026-07-19 - Real-browser geometry integrated into main

- Request: Complete the `768x32768` browser checkpoint without losing the current Processing Monitor and HTTP 422 contracts, then integrate the verified branch into `main`.
- Changes: Merged current `origin/main` into the isolated feature branch with both state histories preserved, pushed merge commit `83e5a175dd39ca4ca64ad2fa84ca98dc208bb317`, and fast-forwarded `main` to that commit.
- Invariant/decision: The geometry gate counts only a clean run with one source DOM node, vertical slicing rather than direct replacement, all 55 raw slices committed as ready Blob URLs, and backend queue size/waiting/processing settled to zero.
- Verification: On final `main`, `scripts/verify.ps1` passed 52 backend tests, 180 extension tests, JavaScript checks, Ruff, and 72% coverage. Edge fixture/Dashboard/geometry/lifecycle E2E passed with 55/55 geometry slices, zero browser exceptions, zero duplicate replacements, zero stale navigation entries, and settled queues/rules.
- Remaining: Expand backend restart/cancellation E2E, reliability soak, and production-quality benchmarks.

## 2026-07-19 - Backend restart and cancellation hardening

- Request: Continue with backend restart/cancellation E2E while preserving the integrated Monitor, HTTP 422, live-reader, worker/DNR, and geometry contracts.
- Changes: Added tracked job/enqueue ownership, shutdown signalling for all jobs, cancellation of queue-capacity-blocked submissions, exact-object registry cleanup, and a FastAPI HTTP cancel plus lifespan restart acceptance test.
- Invariant/decision: Shutdown must settle active, queued, and blocked submitters before restart; an old completion may remove only its own registry entry and can never erase a newer job using the same client ID.
- Verification: Three focused regressions failed before the fix. Final verification passed 57 backend tests, 180 extension tests, JavaScript checks, Ruff, and 73% coverage with `inference_queue.py` at 92%. Edge fixture/Dashboard/geometry/lifecycle E2E passed with 55/55 geometry slices, zero browser exceptions, zero duplicate/stale work, and settled queues/rules.
- Git: Pending isolated feature-branch automatic sync; main remains unchanged by this change set.
- Remaining: Improve focused model-manager/downloader/upscaler coverage, then run reliability soak and production-quality benchmarks.

## 2026-07-19 - Backend lifecycle checkpoint integrated into main

- Request: Integrate the verified backend restart/cancellation checkpoint without modifying or weakening existing browser lifecycle assertions.
- Changes: Pushed feature commit `edd461eecafd2807335f70f08f6b607a856c9ce4` and fast-forwarded the clean, unchanged `main` worktree to it.
- Verification: Final main `scripts/verify.ps1` passed 57 backend tests, 180 extension tests, JavaScript checks, Ruff, and 73% coverage. The first Edge run was rejected after a transient pre-reload registry count of two; an unchanged clean rerun passed Dashboard, 55/55 geometry slices, worker restart, navigation, extension reload, zero browser exceptions, and settled queues/rules.
- Remaining: Improve focused model-manager/downloader/upscaler coverage, then run reliability soak and production-quality benchmarks.

## 2026-07-19 - Slice-width settings contract

- Request: Add user-controlled slice width/height and bounded ahead-of-viewport processing without destabilizing the green lifecycle.
- Changes: Added aligned `sliceMaxWidthPx=8192` defaults, persisted `imageSliceMaxWidth`, schema-version-2 migration bounds, background status/message handling, and content-side settings loading. No UI or slicing behavior is exposed in this checkpoint.
- Invariant/decision: A user-visible control is not published until the two-dimensional crop/render path is green. Existing vertical slicing remains unchanged, and migration is bounded and idempotent.
- Verification: The new migration and message-contract assertions failed before implementation, then passed. Fast verification passed 57 backend tests, 180 extension tests, JavaScript checks, and all existing lifecycle regressions.
- Remaining: Implement two-dimensional segmentation and exact DOM layout, then expose the width/height controls.

## 2026-07-19 - Two-dimensional slice rendering

- Request: Let users control both slice width and height while preserving exact reconstruction and all stale-operation guarantees.
- Changes: Added width/height controls to Popup and Dashboard, row-major X/Y crop planning, full coordinate cache/operation identity, and absolute tile positioning inside a relative wrapper. The deterministic geometry fixture now includes `2048x1200` grid slicing alongside the existing `768x32768` vertical case.
- Invariant/decision: Input maximums remain an independent safety gate; extreme-wide processing requires explicit user permission. Every source pixel belongs to exactly one tile, and any segment registration/render failure rolls back the entire group.
- Verification: New grid crop/layout regressions failed before implementation, then passed. Fast verification passed 57 backend tests and 182 extension tests. Real Edge passed two `1024x1200` source tiles rendered at exact `0px`/`512px` positions, retained 55/55 tall slices, reported zero browser exceptions/duplicates/stale work, and settled queues/rules.
- Remaining: Add bounded processing of images ahead of the viewport with user controls and navigation/reload settlement coverage.

## 2026-07-19 - Bounded ahead-of-viewport processing

- Request: Preprocess eligible images before they enter the viewport without scheduling an unbounded chapter and without weakening worker/navigation/reload lifecycle guarantees.
- Changes: Added schema-version-3 settings for `aheadProcessingEnabled`, `aheadProcessingImageLimit`, and `prefetchMarginPx`; added Popup/Dashboard controls; selected nearest eligible `seen` images into a retained bounded window; added strict visible/prefetch/lookahead queue tiers, duplicate suppression, disable/cancel cleanup, and deterministic reader/Edge lookahead fixtures.
- Invariant/decision: Lookahead owns only the bounded image window and never stores image bytes. Visible work outranks lookahead. Keys are released when images enter normal prefetch, are cancelled, replaced, removed, or the page is hidden; existing guarded slot, queue, DNR, registry, and Blob-commit settlement paths remain authoritative.
- Verification: The new regressions failed before implementation and then passed. Full verification passed 57 backend tests, 187 extension tests, JavaScript checks, Ruff, and 73% backend coverage. Real Edge passed worker termination/reactivation, same-tab navigation, extension reload, two-dimensional geometry, and the new offscreen lookahead case (`rectTop=3200`, `viewportDistance=2715`, `scrollY=0`) with zero browser exceptions, duplicate replacements, stale entries, residual Referer rules, and unsettled queues.
- Git: Green implementation committed as `f634734` on `main`; this documentation checkpoint records the verified baseline.
- Remaining: Improve focused model-manager/downloader/upscaler coverage, then run reliability soak and production-quality benchmarks.

## 2026-07-20 - One-shot initial ahead processing

- Request: Run ahead processing once when each page opens, then process only newly encountered images as scrolling reaches the normal viewport/prefetch window; never repeat work for an already queued or completed image.
- Changes: Added a per-content-page completion guard, moved ahead selection to one explicit pass after initial discovery, and removed repeated lookahead calls from discovery, intersection, scroll, resize, and settings refresh paths. Later dynamic images remain `seen` until viewport promotion.
- Invariant/decision: The initial pass remains bounded by `aheadProcessingImageLimit` and preserves visible/prefetch/lookahead priority. Existing operation identity, active-state, and completed-key guards remain the sole duplicate authority.
- Verification: Focused one-shot, dynamic-image, duplicate-suppression, priority, and viewport regressions passed `8/8`. The 500-image regression proves initial discovery and selection stay below fixed layout-read budgets and a second lookahead call performs no additional layout reads. Full verification passed 57 backend tests, 189 extension tests, JavaScript checks, Ruff, and 73% backend coverage. The first Edge fixture run hit the known transient pre-reload registry-count assertion; an unchanged clean rerun passed offscreen lookahead at `scrollY=0`, 55/55 tall slices, two-dimensional slicing, Dashboard, worker/navigation/reload lifecycle, zero browser exceptions, and settled queues/rules.
- Remaining: Processing Monitor storage-write batching and event-driven runtime maintenance remain separate performance work.

## 2026-07-20 - Event-driven extension lag reduction

- Request: Diagnose why enabling the extension lagged the browser while inference CPU/GPU remained idle, research established browser-extension performance practices, and apply the fixes without changing the one-shot ahead-processing contract.
- Changes: Capped active monitor history at 500; coalesced hot session and durable local monitor snapshots; batched seen statistics; cached migrated runtime settings with `storage.onChanged` updates and stale-read protection; made enable/disable discovery idempotent; detached and re-registered image observers without duplicate listeners; kept completed images skipped; moved later viewport promotion to `IntersectionObserver`; limited scroll refresh to preprocessing waiters; removed the duplicate backend start and watchdog tab ping; and replaced `/health` directory scans with an O(1) `ImageCache.file_count`.
- Invariant/decision: Every page still gets at most one bounded initial ahead pass. Images discovered later remain `seen` until observer promotion. Terminal monitor events remain durable, stale operations retain exact identity guards, and cache counting performs one startup scan rather than periodic request-time scans.
- Verification: Regression tests first reproduced 503 active monitor rows despite a 500 limit, 20 monitor snapshots/storage reads for 20-event bursts, 600 layout reads for 200 idle images on one refresh, duplicate backend health checks, disabled discovery activity, re-enable observer loss, and `/health` directory traversal. Final `scripts/verify.ps1` passed 59 backend tests, 199 extension tests, JavaScript syntax checks, Ruff, and 73% backend coverage. A 20-request in-process health benchmark measured 5.85 ms median, 6.54 ms p95, and 12.39 ms maximum after startup.
- Git: Work continued safely on auto-synchronized parent `11091a2`; final implementation and memory updates are pending the required repository auto-sync.
- Remaining: Record a longer live-browser performance soak if release-level latency/power claims are required.

## 2026-07-20 - Source-verified slicing and atomic responsive rendering

- Request: Fix manga pages that became extremely narrow or malformed after enhancement, restore automatic slicing when page DOM geometry was stale or constrained, and remove reading lag caused by processed segment insertion.
- Changes: `ImageProvider` now records the actual rendered rectangle before stale width/height attributes; the content preprocessor reads bounded PNG/JPEG/WebP/GIF headers and promotes oversized source bytes into the existing slice transaction without a duplicate browser read; full-image rendering keeps responsive width, automatic height, aspect ratio, and `object-fit: contain`; the crop loop yields between segments; raw tile geometry is percentage-based inside an aspect-ratio wrapper with CSS containment; segment results render while the wrapper is hidden and the original page remains visible, then the completed group activates once after every segment succeeds. Raw slices skip the visible fade delay, while operation identity, full-group rollback, Blob revocation, and fallback ownership remain unchanged.
- Invariant/decision: Encoded browser-owned geometry is authoritative when DOM geometry would incorrectly choose the full-image path. A partially completed slice group must never replace the source page; activation is atomic only after every exact segment operation has committed, and any failure restores the original page. Responsive resizing must not stretch either full results or reconstructed grids.
- Verification: New regressions failed before implementation for stale `76x1536` HTML geometry, fixed-axis full rendering, fixed-pixel grid layout, immediate parent hiding, and a `900x12000` encoded source constrained to `900x1500` in the DOM. Focused regressions passed, then fast verification passed 59 backend tests and 204 extension tests with JavaScript syntax checks. Full repository verification passed the same 59 backend and 204 extension tests, Ruff, and 73% backend coverage. Real Edge unpacked-extension E2E then passed with 55/55 ready slices for `768x32768`, two responsive 50% tiles for `2048x1200` inside a measured 735 px wrapper, zero browser exceptions, and settled queue, Referer-rule, worker, navigation, and reload state.
- Research: Applied the browser-standard `aspect-ratio`, `object-fit`, CSS containment, cooperative task yielding, and single-commit layout guidance documented by MDN and web.dev; the detached/hidden wrapper keeps expensive image replacement outside the visible reader until one final activation.
- Remaining: Run a long-duration live-reader performance soak on the exact reported site if release-level frame-time and memory evidence is required.
