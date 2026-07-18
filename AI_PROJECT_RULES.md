# AI Manga Upscaler project rules

These rules define the repository-wide execution contract. `AGENTS.md` adds the focused edit-routing and verification workflow, while `docs/project-memory/README.md` is the durable handoff entry point.

## Recovery before edits

1. Verify the repository root, `main` branch, `origin`, `HEAD`, `origin/main`, divergence, and working tree before changing source.
2. Stop on unexplained staged, unstaged, or untracked source/test work.
3. Do not use `git reset`, `git clean`, `git stash`, `git rebase`, `git restore`, force-push, or history rewriting as an automatic recovery action.
4. Preserve and report corrupted or suspicious Git metadata before attempting a recoverable repair.

## Evidence-backed changes

1. Read `docs/project-memory/README.md`, `CURRENT_STATE.md`, and the task-specific memory node before implementation files.
2. Reproduce behavioral bugs with a failing focused test and state the invariant being restored.
3. Keep patches inside the documented ownership boundary and inspect direct consumers before editing contracts.
4. Never delete a failing test, weaken an assertion, or replace runtime acceptance with an easier fixture merely to make a gate pass.
5. Treat browser, model, GPU, live-site, installer, and packaging claims as unproven until their corresponding runtime acceptance has run.

## Verification and synchronization

During iteration run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1 -Fast
```

Before completing a checkpoint run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
```

After a green change set:

1. Update the affected project-memory nodes and append `docs/project-memory/WORK_LOG.md`.
2. Update `PROJECT_STATE.md` and `docs/CODEX_EXECUTION_STATE.md` when the verified baseline or next checkpoint changes.
3. Review `git diff`, `git diff --check`, secret exposure, and tracked runtime artifacts.
4. Run `scripts/auto-git-update.ps1` once to commit and push the safe checkpoint.
5. Verify `HEAD` equals `origin/main` and the tracked working tree is clean.

## Critical invariants

- A stale completion must never overwrite or remove a newer operation with the same image ID.
- Queue counters, active work, futures, retries, and slots must settle on every terminal path.
- DirectML device loss may retry once on a fallback provider; unrelated failures propagate.
- Parent cleanup after slicing must not remove, reorder, duplicate, or resurrect segment jobs.
- JavaScript request fields and FastAPI aliases remain contract-compatible.
- Secrets, credentials, cookies, browser profiles, downloaded copyrighted fixtures, model binaries, and machine-specific runtime artifacts must not be committed.

