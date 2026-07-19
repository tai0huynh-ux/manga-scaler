# AI Manga Upscaler project state

The detailed verified baseline is maintained in [`docs/project-memory/CURRENT_STATE.md`](docs/project-memory/CURRENT_STATE.md). This file is the concise repository-root status required for recovery.

## Current checkpoint

- Project: `manga-scaler` / AI Manga Upscaler.
- Repository: `https://github.com/tai0huynh-ux/manga-scaler.git`.
- Branch: `main`.
- Starting baseline for the protected-read lifecycle checkpoint: `83c0c2ebc67ff8c7daa3414628fd599b3205a758`.
- Protected-read lifecycle checkpoint: real Edge worker termination/reactivation, same-tab navigation, and unpacked-extension reload are green with 47 backend tests, 126 extension tests, JavaScript syntax checks, Ruff, and 71% backend coverage on 2026-07-18.
- Protected-read lifecycle checkpoint committed and pushed as `f21a208b31b228e4f6043dae211cbb93f3bded12`.
- Integrated live-reader/error-contract checkpoint committed and pushed as `c7b687e3be6acbbf9dc944fb3be959cf6edf3106` with 49 backend tests, 139 extension tests, Ruff, JavaScript checks, and 71% coverage green.
- HTTP 422/browser-owned request contract checkpoint committed and pushed as `f0da83c7c94d796b0e240d02d4945ef7d190133d`: `maxOutputWidth=128` is normalized to `256`, structured validation details remain visible, 422 is non-retryable, and browser-owned bytes no longer require an HTTP download URL.
- Current integrated gate: 57 backend tests, 187 extension tests, JavaScript checks, Ruff, 73% backend coverage, deterministic Edge fixture/lifecycle/geometry/lookahead E2E, and real Dashboard browser/load E2E green with zero browser exceptions.
- Clean live-reader acceptance is green on TruyenQQ Manga (`22/22`), Manhwa (`75/75`), Manhua (`26/26`), and hentaivnx (`16/16`); deterministic geometry tests cover the 300 px boundary, `512x16384`/`768x32768` tall slicing, and safe `16384x512`/`32768x768` wide rejection.
- Completed: viewport-aware discovery, operation-safe scheduling, transactional long-image slicing, backend inference lifecycle, provider fallback, text-processing foundations, tracing, and native-host startup support.
- Not yet proven: production-model quality benchmarks, OCR/text-edit acceptance, reliability soak, and clean installer lifecycle.
- Real Edge geometry gate now covers `768x32768`: vertical slicing produced 55 raw slices with 55/55 Blob commits, one source DOM node, and settled backend queue.
- Geometry acceptance was fast-forwarded into `main` at `83e5a175dd39ca4ca64ad2fa84ca98dc208bb317` after the full main gate passed.
- Bounded ahead-of-viewport processing is implemented at `f634734`: users can enable/disable it, set a 1-50 image window, and tune the 0-12000 px prefetch margin. Real Edge committed an image beyond the legacy margin before scrolling while lifecycle queues/rules remained settled.

## Active milestone

Bounded ahead-of-viewport processing is the current green implementation checkpoint on `main` at `f634734`. Visible work outranks prefetch and lookahead, only the nearest configured image window is scheduled, duplicate operations are suppressed, and disable/navigation/removal paths settle owned state. Processing Monitor, HTTP 422, live-reader, worker/DNR lifecycle, geometry, and backend restart contracts remain green.

## Required reading

1. [`AI_PROJECT_RULES.md`](AI_PROJECT_RULES.md)
2. [`AGENTS.md`](AGENTS.md)
3. [`docs/project-memory/README.md`](docs/project-memory/README.md)
4. [`docs/CODEX_EXECUTION_STATE.md`](docs/CODEX_EXECUTION_STATE.md)
