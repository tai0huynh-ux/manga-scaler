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
