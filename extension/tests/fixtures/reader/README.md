# Deterministic reader fixture

This dependency-free local site uses generated SVG content only. It exercises browser image discovery and lifecycle behavior without copyrighted manga assets or external services.

Run it with:

```powershell
npm.cmd run fixture:reader
```

The command prints the random loopback URL. The automated HTTP contract is covered by `extension/tests/reader_fixture.test.cjs`.

With the backend running on `127.0.0.1:8765` and a compatible model installed, run the real Edge/Chrome unpacked-extension gate:

```powershell
npm.cmd run test:e2e:edge-fixture
```

The E2E gate uses an isolated temporary browser profile, loads the repository extension, exercises static and dynamically inserted PNG images through the real backend/model, verifies Blob replacement and false-positive rejection, and requires the backend queue to settle at zero.

## Fixture matrix

| Category | Fixture | Current extension support |
|---|---|---|
| Plain `<img src>` | `#plain-src` | Supported |
| `srcset` | `#responsive-srcset` | Supported |
| `<picture>` | `#picture-source` | Supported |
| `data-src` activation | `#data-src-image` | Supported after the page assigns `src` |
| Lazy source replacement | `#lazy-source-change` | Supported through load/mutation observation |
| Infinite scroll | `#infinite-scroll-added` | Supported |
| Dynamically inserted image | `#mutation-added` | Supported |
| Same URL, changed bytes | `#same-url-changing-bytes` | Supported when the source fingerprint changes |
| Removed during processing | `#remove-during-processing` | Supported cancellation path |
| Long parent image | `#slice-parent` | Supported through transactional slicing |
| Logo, banner, ad, avatar, thumbnail and layout chrome | named fixture IDs | Expected false positives: rejected |
| Data URL | `#data-url` | Discoverable; background HTTP reads do not apply |
| Blob URL | `#blob-url` | Discoverable; page-owned Blob lifetime may limit reads |
| Cross-origin image | `#cross-origin` | Supported when browser permissions/read rules allow it |
| Cookie/referrer-sensitive image | protected endpoints | Supported through browser-context reads |
| Exact per-reader Referer | `/protected/referer.png` | Returns distinct PNG bytes for `/chapter/a` and `/chapter/b`; rejects missing or incorrect Referer |
| Slow or non-settling body | `/protected/slow-body.png`, `/protected/hanging-body.png` | Deterministic body-consumption abort coverage |
| Mid-body disconnect | `/protected/disconnect-body.png` | Deterministic truncated transport failure |
| Invalid image response | `/protected/html-as-image`, `/protected/fake-image.png` | HTTP 200 HTML and false image MIME/magic-byte coverage |
| Large streaming response | `/protected/large-body.png` | Bounded chunk generation with client-abort cleanup |
| Open Shadow DOM | `#shadow-host` | Not supported by the current light-DOM scanner |
| Same-origin iframe | `#same-origin-frame` | Not supported because the content script does not run in all frames |
| CSS background image | `#css-background` | Not supported |
| Canvas-rendered image | `#canvas-rendered` | Not supported |
