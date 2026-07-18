# Deterministic reader fixture

This dependency-free local site uses generated SVG content only. It exercises browser image discovery and lifecycle behavior without copyrighted manga assets or external services.

Run it with:

```powershell
npm.cmd run fixture:reader
```

The command prints the random loopback URL. The automated HTTP contract is covered by `extension/tests/reader_fixture.test.cjs`.

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
| Open Shadow DOM | `#shadow-host` | Not supported by the current light-DOM scanner |
| Same-origin iframe | `#same-origin-frame` | Not supported because the content script does not run in all frames |
| CSS background image | `#css-background` | Not supported |
| Canvas-rendered image | `#canvas-rendered` | Not supported |

