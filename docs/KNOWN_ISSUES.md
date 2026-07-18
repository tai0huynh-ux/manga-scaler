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

## Remaining limitations

- Extension trace events do not have a persistent local event store.
- Trace Dashboard is not implemented yet.
- Trace Artifact Capture and reproduction packages are not implemented yet.
- Per-tile trace events are intentionally not emitted in default mode.
- GPU/VRAM trace sampling is not implemented.
- Website anti-hotlink rules can still prevent the background reader from obtaining source bytes. The Dashboard link may work in a normal tab while preprocessing reports `browser-read-error`.
- Hentaivnx live chapter replacement remains unproven. Its sampled CDN requires Referer, and the final worker diagnostic was not stable enough to claim a completed replacement after the timeout fix.
- A current public TruyenQQ reader URL is still unverified.
- Canvas, CSS `background-image`, and custom WebGL readers are outside the `<img>` discovery path.
- Natural long-duration MV3 suspension/soak timing is not yet characterized, although deterministic Edge worker stop/reactivation is green.
- Browser-level extension behavior still requires manual verification on representative manga sites.
