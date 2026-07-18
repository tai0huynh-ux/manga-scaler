# AI Manga Upscaler project state

The detailed verified baseline is maintained in [`docs/project-memory/CURRENT_STATE.md`](docs/project-memory/CURRENT_STATE.md). This file is the concise repository-root status required for recovery.

## Current checkpoint

- Project: `manga-scaler` / AI Manga Upscaler.
- Repository: `https://github.com/tai0huynh-ux/manga-scaler.git`.
- Branch: `main`.
- Current committed baseline: `8495a7704d324a1b3108ddda985cf85ff8fc525e`.
- Active fixture checkpoint: the full gate passed 47 backend tests, 110 extension tests, JavaScript syntax checks, Ruff, and 71% backend coverage on 2026-07-18.
- Completed: viewport-aware discovery, operation-safe scheduling, transactional long-image slicing, backend inference lifecycle, provider fallback, text-processing foundations, tracing, and native-host startup support.
- Not yet proven: representative live-site acceptance, production-model quality benchmarks, OCR/text-edit acceptance, reliability soak, and clean installer lifecycle.

## Active milestone

Continue Phase A1 protected-reader acceptance. The deterministic fixture now covers exact per-chapter Referer bytes and response-body failure modes. Next, prove DNR rule isolation and cleanup with failing regressions before changing production behavior. Live hentaivnx chapter replacement remains unproven, and a verified public TruyenQQ reader URL is still required.

## Required reading

1. [`AI_PROJECT_RULES.md`](AI_PROJECT_RULES.md)
2. [`AGENTS.md`](AGENTS.md)
3. [`docs/project-memory/README.md`](docs/project-memory/README.md)
4. [`docs/CODEX_EXECUTION_STATE.md`](docs/CODEX_EXECUTION_STATE.md)
