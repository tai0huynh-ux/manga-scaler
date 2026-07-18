# Project memory index

This directory is the durable handoff for AI Manga Upscaler work. Read this file first in a new session. Do not scan the whole repository unless the task crosses an undocumented boundary or the memory is demonstrably stale.

## Reading order

1. [CURRENT_STATE.md](CURRENT_STATE.md) - verified baseline, active limitations, and next work.
2. [ARCHITECTURE_TREE.md](ARCHITECTURE_TREE.md) - ownership tree and module responsibilities.
3. Read only the task-specific reference:
   - [RUNTIME_FLOWS.md](RUNTIME_FLOWS.md) for end-to-end behavior and state transitions.
   - [CONTRACTS_AND_INVARIANTS.md](CONTRACTS_AND_INVARIANTS.md) for compatibility and race-safety rules.
   - [TEST_AND_CHANGE_MAP.md](TEST_AND_CHANGE_MAP.md) for edit routing and verification.
4. [WORK_LOG.md](WORK_LOG.md) - append-only summaries of completed project changes.

Existing product records remain authoritative for their own scope:

- `docs/DECISIONS.md`: accepted engineering decisions.
- `docs/KNOWN_ISSUES.md`: resolved and remaining limitations.
- `docs/CHANGELOG.md`: product-facing implementation history.
- `docs/CODEX_TASKS.md`: completed and manual follow-up tasks.

## Maintenance contract

After every completed change set:

1. Update only the affected memory nodes.
2. Update `CURRENT_STATE.md` when the verified baseline, risks, or next work changes.
3. Append one entry to `WORK_LOG.md`; never rewrite prior entries to hide history.
4. Update `CONTRACTS_AND_INVARIANTS.md` when a contract or safety rule changes.
5. Update `TEST_AND_CHANGE_MAP.md` when files, commands, or test ownership change.
6. Record major decisions in `docs/DECISIONS.md`, not only in the work log.
7. Run the repository verification required by `AGENTS.md` before claiming the memory is current.

Memory must describe verified behavior, not plans presented as implemented behavior. If verification is incomplete, label the state explicitly.
