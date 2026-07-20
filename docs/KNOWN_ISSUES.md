# Known issues

## Resolved

- **All discovered images appeared active:** resolved by separating `preprocessing_queued` from slot-owning `preprocessing`.
- **Distant images filled the preprocessing queue on discovery:** resolved with prefetch-only scheduling and viewport priority.
- **Long-image operations could leave ambiguous preprocessing records:** resolved with stage-specific timeout reasons, guarded release, rollback, fallback, and terminal registry updates.
- **Dashboard reloaded image nodes every poll:** resolved with keyed row updates.
- **Remote original previews displayed broken-image icons:** resolved by showing a placeholder unless a stable local preview URL exists.
- **Current-page Dashboard mixed tabs:** already resolved before this change; regression coverage confirms `PageImageRegistry.list(tabId)` is used.
- **Live reader chrome was processed as chapter content:** resolved for readers that expose `reading-detail box_doc` with explicit `.page-chapter` containers; direct chrome outside those containers is rejected.
- **A non-cooperative CDN response body could retain preprocessing forever:** resolved by racing both browser fetch and body reads against abort.
- **Worker startup cleanup could delete unrelated Referer rules or reuse active IDs:** resolved with exact ownership signatures, active-ID reservation, and an idempotent initialization barrier.
- **Unpacked-extension reload could leave stale/duplicate content contexts:** resolved with reinjectable block scope, a newest-instance DOM lease, stale-marker cleanup, and verified automatic rediscovery.
- **Dashboard reported only `Backend returned 422`:** resolved by preserving sanitized FastAPI validation details/trace IDs, marking 422 non-retryable, normalizing request fields before dispatch, and accepting browser-owned bytes without forcing an HTTP source URL.
- **Live advertisement overlays prevented bottom-page scheduling:** resolved in acceptance by locating and clicking the real visible close control; production occlusion rejection remains conservative.
- **Duplicate live jobs were over-counted across replacement operations:** resolved by preserving pending trace identity, distinguishing reprioritization from enqueue, and including operation identity in duplicate evidence.
- **Backend shutdown could retain queued job registry entries:** resolved by tracking every job/enqueue operation, cancelling capacity-blocked submitters, identity-safe cleanup, and verified clean lifespan restart.
- **Processed extreme pages could collapse into a narrow strip:** resolved by measuring the rendered rectangle, probing encoded source dimensions, promoting oversized PNG/JPEG/WebP/GIF bytes into slicing, and keeping full renders aspect-safe.
- **Segment insertion caused visible reading churn and delayed the main replacement:** resolved by registering segments in a hidden responsive wrapper, activating once before enhanced results arrive, and replacing exact raw nodes progressively with group rollback on failure.
- **The initial ahead pass stopped after its first batch:** resolved by taking one `window.load` snapshot and draining every unique source through the bounded active-owner limit.
- **Identical source URLs at different DOM sizes could enqueue duplicate work:** resolved with page-lifetime canonical source ownership and duplicate-node suppression.
- **Screen presets fed severely downsampled manga into the anime model and corrupted text at 5% strength:** resolved by source-oriented presets, bounded automatic sizing, a Lanczos/Pillow path for targets up to `1.5x`, and a cache-identity bump that excludes stale malformed results.

## Remaining limitations

- Extension trace events do not have a persistent local event store.
- Trace Dashboard is not implemented yet.
- Trace Artifact Capture and reproduction packages are not implemented yet.
- Per-tile trace events are intentionally not emitted in default mode.
- GPU/VRAM trace sampling is not implemented.
- Website anti-hotlink rules can still prevent the background reader from obtaining source bytes. The Dashboard link may work in a normal tab while preprocessing reports `browser-read-error`.
- Canvas, CSS `background-image`, and custom WebGL readers are outside the `<img>` discovery path.
- Natural long-duration MV3 suspension/soak timing is not yet characterized, although deterministic Edge worker stop/reactivation is green.
- The four-site live gate is point-in-time and may drift with public markup, advertisements, CDN policy, or anti-bot changes.
- Repeated interrupted `768x32768` browser runs can leave expensive backend work queued; acceptance evidence must come from a clean run that settles queue size, waiting, and processing to zero.
