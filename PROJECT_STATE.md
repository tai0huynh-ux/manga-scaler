# AI Manga Upscaler project state

The detailed verified baseline is maintained in [`docs/project-memory/CURRENT_STATE.md`](docs/project-memory/CURRENT_STATE.md). This file is the concise repository-root status required for recovery.

## Current checkpoint

- Project: `manga-scaler` / AI Manga Upscaler.
- Repository: `https://github.com/tai0huynh-ux/manga-scaler.git`.
- Branch: `main`.
- Current committed baseline before the active DNR checkpoint: `5a015f5c93afbed79e2e925cc9a88c7e61e2cec2`.
- Active DNR checkpoint: the full gate passed 47 backend tests, 113 extension tests, JavaScript syntax checks, Ruff, and 71% backend coverage on 2026-07-18.
- Completed: viewport-aware discovery, operation-safe scheduling, transactional long-image slicing, backend inference lifecycle, provider fallback, text-processing foundations, tracing, and native-host startup support.
- Not yet proven: representative live-site acceptance, production-model quality benchmarks, OCR/text-edit acceptance, reliability soak, and clean installer lifecycle.

## Active milestone

Continue Phase A1 protected-reader acceptance. Discovery no longer creates broad Referer rules, and exact-image temporary rules are serialized and cleaned on every tested terminal path. Next, prove navigation/extension-reload cleanup during active reads. Live hentaivnx chapter replacement remains unproven, and a verified public TruyenQQ reader URL is still required.

## Required reading

1. [`AI_PROJECT_RULES.md`](AI_PROJECT_RULES.md)
2. [`AGENTS.md`](AGENTS.md)
3. [`docs/project-memory/README.md`](docs/project-memory/README.md)
4. [`docs/CODEX_EXECUTION_STATE.md`](docs/CODEX_EXECUTION_STATE.md)
