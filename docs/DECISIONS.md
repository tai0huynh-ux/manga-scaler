# Engineering decisions

## 2026-07-15 — Separate discovery, queued preprocessing, and active preprocessing

All eligible images remain discoverable for page statistics, but only images inside the prefetch margin enter preprocessing. A cancellable priority queue orders waiters by viewport distance, page order, and queue time. This prevents distant chapter images from occupying slots merely because they appeared earlier in the DOM.

`preprocessing_queued` and `preprocessing` are distinct registry states. The latter is valid only while an operation owns a preprocessing slot.

## 2026-07-15 — Keep Dashboard image nodes stable

Dashboard polling uses keyed row reconciliation. Unchanged preview URLs retain the same image node and browser request. Remote website URLs are links, not preview sources, because extension pages do not reliably share anti-hotlink headers, cookies, or signed URL context.
