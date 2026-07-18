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
