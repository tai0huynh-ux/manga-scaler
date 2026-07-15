# AI Manga Upscaler engineering guide

## Scope routing

- Backend API contracts: `backend/app/models/schemas.py`, `backend/app/api/routes.py`, and API tests.
- Inference lifecycle: `upscaler.py`, `inference_queue.py`, `model_manager.py`, `gpu_provider.py`, and their focused tests.
- Browser scheduling: `extension/src/background.js` and `extension/tests/queue_scheduler.test.cjs`.
- Page discovery, slicing, and rendering: `extension/src/content.js`; inspect background scheduling only at the message boundary.
- Shared settings: compare `extension/src/config.js`, `backend/config.json`, and `shared/config/defaults.json`.

Do not read the whole repository by default. Start from the changed file, the routes above, direct consumers, and focused tests.

## Regression workflow

1. Reproduce a bug with a failing test before changing behavior.
2. State the invariant being restored.
3. Keep the patch local; search references before deleting or renaming code.
4. Run `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1 -Fast` while iterating.
5. Run `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` before completion.
6. Never weaken an existing assertion merely to make a patch pass unless the product contract intentionally changed.

## Codex auto sync

- After Codex completes a project change and focused verification succeeds, run `powershell -ExecutionPolicy Bypass -File scripts/auto-git-update.ps1` from the repository root to commit and push safe changes.
- Do not use a long-running file watcher for Git sync. Sync once at the end of each completed Codex change set.
- If `scripts/auto-git-update.ps1` stops because it detected a possible secret in a tracked file, do not bypass it; report the blocked file and fix the leak first.

## Critical invariants

- A stale completion must never remove or overwrite a newer job with the same image ID.
- Queue counters and futures must settle after success, failure, cancellation, and shutdown.
- DirectML device loss may retry once on a fallback provider; unrelated failures must propagate.
- Parent image removal after slicing must not remove, reorder, or resurrect segment jobs.
- JavaScript request fields and FastAPI aliases must remain contract-compatible.
