# AI Manga Upscaler project state

The detailed verified baseline is maintained in [`docs/project-memory/CURRENT_STATE.md`](docs/project-memory/CURRENT_STATE.md). This file is the concise repository-root status required for recovery.

## Current checkpoint

- Project: `manga-scaler` / AI Manga Upscaler.
- Repository: `https://github.com/tai0huynh-ux/manga-scaler.git`.
- Branch: `main`.
- Starting baseline for the protected-read lifecycle checkpoint: `83c0c2ebc67ff8c7daa3414628fd599b3205a758`.
- Protected-read lifecycle checkpoint: real Edge worker termination/reactivation, same-tab navigation, and unpacked-extension reload are green with 47 backend tests, 126 extension tests, JavaScript syntax checks, Ruff, and 71% backend coverage on 2026-07-18.
- Completed: viewport-aware discovery, operation-safe scheduling, transactional long-image slicing, backend inference lifecycle, provider fallback, text-processing foundations, tracing, and native-host startup support.
- Not yet proven: representative live-site acceptance, production-model quality benchmarks, OCR/text-edit acceptance, reliability soak, and clean installer lifecycle.

## Active milestone

Continue Phase A1 with live-reader acceptance. The deterministic lifecycle gate now proves owned orphan cleanup, unrelated-rule preservation, actual MV3 worker stop/reactivation, full navigation cancellation, automatic extension-reload recovery, zero duplicate replacements, and settled queues/rules. Live hentaivnx chapter replacement remains unproven, and a verified public TruyenQQ reader URL is still required.

## Required reading

1. [`AI_PROJECT_RULES.md`](AI_PROJECT_RULES.md)
2. [`AGENTS.md`](AGENTS.md)
3. [`docs/project-memory/README.md`](docs/project-memory/README.md)
4. [`docs/CODEX_EXECUTION_STATE.md`](docs/CODEX_EXECUTION_STATE.md)
