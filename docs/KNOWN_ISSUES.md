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

## Remaining limitations

- Extension trace events do not have a persistent local event store.
- Trace Dashboard is not implemented yet.
- Trace Artifact Capture and reproduction packages are not implemented yet.
- Per-tile trace events are intentionally not emitted in default mode.
- GPU/VRAM trace sampling is not implemented.
- Website anti-hotlink rules can still prevent the background reader from obtaining source bytes. The Dashboard link may work in a normal tab while preprocessing reports `browser-read-error`.
- Hentaivnx live chapter replacement remains unproven. Its sampled CDN requires Referer, and the final worker diagnostic was not stable enough to claim a completed replacement after the timeout fix.
- Current TruyenQQ URLs are now verified, but the live gate is not green: Hive 293 measured 66/75 stable original-image Blob replacements (88%) with nine detected-but-unreplaced images.
- Manhua 320 reached 26/26 replacements but exposed tracking/avatar false positives before the candidate-filter fix; a clean post-fix rerun was blocked by backend instability.
- Processing Monitor core is implemented, but real Dashboard cancel/retry/filter/export/reload interaction and the 500-job browser-render load gate remain unproven.
- Canvas, CSS `background-image`, and custom WebGL readers are outside the `<img>` discovery path.
- Natural long-duration MV3 suspension/soak timing is not yet characterized, although deterministic Edge worker stop/reactivation is green.
- Browser-level extension behavior still requires manual verification on representative manga sites.
- Hentaivnx and a clean post-fix Manga run remain unverified; an exact root probe of `https://hentaivnx.live` failed with an external `fetch failed` before reader discovery, so do not promote this checkpoint to live-site PASS.
