var AI_MANGA_UPSCALER_CONFIG = Object.freeze({
  backend: {
    baseUrl: "http://127.0.0.1:8765",
    requestTimeoutMs: 20000,
  },
  cache: {
    memoryMaxEntries: 64,
    indexedDbName: "ai-manga-upscaler-cache",
    indexedDbStoreName: "images",
    indexedDbMaxEntries: 500,
  },
  images: {
    minDimensionPx: 300,
    prefetchMarginPx: 1800,
    cancelDistancePx: 3600,
  },
  queue: {
    maxConcurrentRequests: 2,
  },
  render: {
    fadeMs: 180,
  },
  retry: {
    maxAttempts: 3,
    baseDelayMs: 750,
  },
  enhancement: {
    defaultMode: "auto",
    defaultLevel: 0.35,
    modes: ["auto", "manga", "artwork", "photo"],
  },
});
