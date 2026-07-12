var AI_MANGA_UPSCALER_CONFIG = Object.freeze({
  backend: {
    baseUrl: "http://127.0.0.1:8765",
    requestTimeoutMs: 20000,
    defaultProcessingTimeoutSeconds: 60,
  },
  cache: {
    memoryMaxEntries: 64,
    indexedDbName: "ai-manga-upscaler-cache",
    indexedDbStoreName: "images",
    indexedDbMaxEntries: 500,
  },
  images: {
    browserReadTimeoutMs: 4000,
    minWidthPx: 128,
    minHeightPx: 128,
    maxWidthPx: 8000,
    maxHeightPx: 12000,
    maxOutputWidthPx: 2048,
    maxOutputHeightPx: 8192,
    slicingEnabled: true,
    sliceMaxHeightPx: 2200,
    outputQuality: 90,
    prefetchMarginPx: 1800,
    cancelDistancePx: 3600,
  },
  queue: {
    preprocessingConcurrency: 3,
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
