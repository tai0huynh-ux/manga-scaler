# Known issues

## Resolved

- **All discovered images appeared active:** resolved by separating `preprocessing_queued` from slot-owning `preprocessing`.
- **Distant images filled the preprocessing queue on discovery:** resolved with prefetch-only scheduling and viewport priority.
- **Long-image operations could leave ambiguous preprocessing records:** resolved with stage-specific timeout reasons, guarded release, rollback, fallback, and terminal registry updates.
- **Dashboard reloaded image nodes every poll:** resolved with keyed row updates.
- **Remote original previews displayed broken-image icons:** resolved by showing a placeholder unless a stable local preview URL exists.
- **Current-page Dashboard mixed tabs:** already resolved before this change; regression coverage confirms `PageImageRegistry.list(tabId)` is used.

## Remaining limitations

- Website anti-hotlink rules can still prevent the background reader from obtaining source bytes. The Dashboard link may work in a normal tab while preprocessing reports `browser-read-error`.
- Canvas, CSS `background-image`, and custom WebGL readers are outside the `<img>` discovery path.
- Chrome can suspend the MV3 service worker; tab generation checks prevent stale resurrection, but runtime inspection should account for worker restarts.
- Browser-level extension behavior still requires manual verification on representative manga sites.
