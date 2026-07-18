# AI Manga Upscaler project state

The detailed verified baseline is maintained in [`docs/project-memory/CURRENT_STATE.md`](docs/project-memory/CURRENT_STATE.md). This file is the concise repository-root status required for recovery.

## Current checkpoint

- Project: `manga-scaler` / AI Manga Upscaler.
- Repository: `https://github.com/tai0huynh-ux/manga-scaler.git`.
- Branch: `main`.
- Recovered baseline: `7b8da5616a36a7fcfbab4520a49a9211868c06f7`.
- Automated baseline: 47 backend tests, 98 extension tests, JavaScript syntax checks, Ruff, and 71% backend coverage passed on 2026-07-18.
- Completed: viewport-aware discovery, operation-safe scheduling, transactional long-image slicing, backend inference lifecycle, provider fallback, text-processing foundations, tracing, and native-host startup support.
- Not yet proven: deterministic reader fixture, browser E2E, representative live-site acceptance, production-model quality benchmarks, OCR/text-edit acceptance, reliability soak, and clean installer lifecycle.

## Active milestone

Build the first deterministic offline reader fixture and add boundary/extreme-aspect regression coverage before changing production behavior. Fix only failures reproduced by those tests.

## Required reading

1. [`AI_PROJECT_RULES.md`](AI_PROJECT_RULES.md)
2. [`AGENTS.md`](AGENTS.md)
3. [`docs/project-memory/README.md`](docs/project-memory/README.md)
4. [`docs/CODEX_EXECUTION_STATE.md`](docs/CODEX_EXECUTION_STATE.md)

