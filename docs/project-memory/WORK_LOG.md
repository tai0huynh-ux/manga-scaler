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
