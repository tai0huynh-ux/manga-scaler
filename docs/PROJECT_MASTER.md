# AI Manga Upscaler project status

The extension discovers page images, preprocesses only a viewport-aware subset, optionally divides long images into transactional raw slices, and sends accepted jobs to the local FastAPI backend.

Trace Core MVP is implemented as a lightweight correlation layer across content, background, FastAPI, inference queue, upscaler, image pipeline, and cache/output boundaries. The durable backend trace sink is append-only JSONL; the extension keeps transient trace metadata in messages, queue jobs, registry entries, and structured debug events.

Current extension lifecycle and queue design are documented in [ARCHITECTURE.md](ARCHITECTURE.md). Active limitations are tracked in [KNOWN_ISSUES.md](KNOWN_ISSUES.md), implementation history in [CHANGELOG.md](CHANGELOG.md), and manual follow-up in [CODEX_TASKS.md](CODEX_TASKS.md).
