importScripts("./config.js");

const DEFAULT_STATE = Object.freeze({
  enabled: true,
  mode: AI_MANGA_UPSCALER_CONFIG.enhancement.defaultMode,
  enhanceLevel: AI_MANGA_UPSCALER_CONFIG.enhancement.defaultLevel,
  processed: 0,
  errors: 0,
  cacheHits: 0,
  cacheMisses: 0,
  totalLatencyMs: 0,
  lastQuality: null,
  lastDetectedMode: null,
});

/**
 * Tracks durable counters and computes extension performance metrics.
 */
class StatisticsTracker {
  constructor(storageArea) {
    this.storageArea = storageArea;
  }

  async ensureDefaults() {
    const current = await this.storageArea.get(DEFAULT_STATE);
    await this.storageArea.set({ ...DEFAULT_STATE, ...current });
  }

  async recordSuccess({ latencyMs, cacheHit, quality = null, detectedMode = null }) {
    const current = await this.storageArea.get(DEFAULT_STATE);
    await this.storageArea.set({
      processed: Number(current.processed ?? 0) + 1,
      cacheHits: Number(current.cacheHits ?? 0) + (cacheHit ? 1 : 0),
      cacheMisses: Number(current.cacheMisses ?? 0) + (cacheHit ? 0 : 1),
      totalLatencyMs: Number(current.totalLatencyMs ?? 0) + latencyMs,
      lastQuality: quality || current.lastQuality || null,
      lastDetectedMode: detectedMode || current.lastDetectedMode || null,
    });
  }

  async recordError() {
    const current = await this.storageArea.get(DEFAULT_STATE);
    await this.storageArea.set({
      errors: Number(current.errors ?? 0) + 1,
    });
  }

  async snapshot(queueSnapshot) {
    const current = await this.storageArea.get(DEFAULT_STATE);
    const processed = Number(current.processed ?? 0);
    const cacheHits = Number(current.cacheHits ?? 0);
    const cacheMisses = Number(current.cacheMisses ?? 0);
    const cacheTotal = cacheHits + cacheMisses;

    return {
      enabled: Boolean(current.enabled),
      mode: current.mode || AI_MANGA_UPSCALER_CONFIG.enhancement.defaultMode,
      enhanceLevel: Number(current.enhanceLevel ?? AI_MANGA_UPSCALER_CONFIG.enhancement.defaultLevel),
      processed,
      errors: Number(current.errors ?? 0),
      cacheHits,
      cacheMisses,
      queueSize: queueSnapshot.queueSize,
      processing: queueSnapshot.processing,
      waiting: queueSnapshot.waiting,
      averageLatencyMs: processed > 0 ? Math.round(Number(current.totalLatencyMs ?? 0) / processed) : 0,
      cacheHitRatio: cacheTotal > 0 ? cacheHits / cacheTotal : 0,
      lastQuality: current.lastQuality || null,
      lastDetectedMode: current.lastDetectedMode || null,
    };
  }
}

/**
 * Provides a bounded in-memory LRU cache for hot image blobs.
 */
class MemoryCacheProvider {
  constructor(maxEntries) {
    this.maxEntries = maxEntries;
    this.items = new Map();
  }

  async get(key) {
    if (!this.items.has(key)) {
      return null;
    }

    const value = this.items.get(key);
    this.items.delete(key);
    this.items.set(key, value);
    return value;
  }

  async set(key, value) {
    if (this.items.has(key)) {
      this.items.delete(key);
    }

    this.items.set(key, value);
    while (this.items.size > this.maxEntries) {
      const oldestKey = this.items.keys().next().value;
      this.items.delete(oldestKey);
    }
  }
}

/**
 * Provides a persistent IndexedDB cache that survives browser restarts.
 */
class IndexedDBCacheProvider {
  constructor(databaseName, storeName, maxEntries) {
    this.databaseName = databaseName;
    this.storeName = storeName;
    this.maxEntries = maxEntries;
    this.databasePromise = null;
  }

  async get(key) {
    const database = await this.open();
    const record = await this.request((transaction) => transaction.objectStore(this.storeName).get(key));
    if (!record) {
      return null;
    }

    record.lastAccessedAt = Date.now();
    await this.request((transaction) => transaction.objectStore(this.storeName).put(record));
    return {
      buffer: record.buffer,
      contentType: record.contentType,
      cacheKey: record.cacheKey,
      detectedMode: record.detectedMode,
      quality: record.quality,
    };
  }

  async set(key, value) {
    const database = await this.open();
    const transaction = database.transaction(this.storeName, "readwrite");
    transaction.objectStore(this.storeName).put({
      key,
      buffer: value.buffer,
      contentType: value.contentType,
      cacheKey: value.cacheKey,
      detectedMode: value.detectedMode,
      quality: value.quality,
      byteLength: value.buffer.byteLength,
      lastAccessedAt: Date.now(),
    });
    await this.waitForTransaction(transaction);
    await this.prune();
  }

  open() {
    if (this.databasePromise) {
      return this.databasePromise;
    }

    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) {
          const store = database.createObjectStore(this.storeName, { keyPath: "key" });
          store.createIndex("lastAccessedAt", "lastAccessedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.databasePromise;
  }

  async request(operation) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, "readwrite");
      const request = operation(transaction);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  waitForTransaction(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async prune() {
    const database = await this.open();
    const readTransaction = database.transaction(this.storeName, "readonly");
    const readStore = readTransaction.objectStore(this.storeName);
    const index = readStore.index("lastAccessedAt");
    const keys = [];

    await new Promise((resolve, reject) => {
      const request = index.openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        keys.push(cursor.primaryKey);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });

    const excess = keys.length - this.maxEntries;
    if (excess <= 0) {
      return;
    }

    const writeTransaction = database.transaction(this.storeName, "readwrite");
    const writeStore = writeTransaction.objectStore(this.storeName);
    keys.slice(0, excess).forEach((key) => writeStore.delete(key));
    await this.waitForTransaction(writeTransaction);
  }
}

/**
 * Coordinates memory and persistent cache providers with a single interface.
 */
class CompositeCacheProvider {
  constructor(memoryCache, persistentCache) {
    this.memoryCache = memoryCache;
    this.persistentCache = persistentCache;
  }

  async get(key) {
    const memoryHit = await this.memoryCache.get(key);
    if (memoryHit) {
      return { ...memoryHit, source: "memory" };
    }

    const persistentHit = await this.persistentCache.get(key);
    if (persistentHit) {
      await this.memoryCache.set(key, persistentHit);
      return { ...persistentHit, source: "indexeddb" };
    }

    return null;
  }

  async set(key, value) {
    await this.memoryCache.set(key, value);
    await this.persistentCache.set(key, value);
  }
}

/**
 * Calls the local backend and materializes a blob payload for the renderer.
 */
class BackendUpscaleProvider {
  constructor(baseUrl, requestTimeoutMs) {
    this.baseUrl = baseUrl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextHeaderRuleId = 1000;
  }

  async upscale(imageUrl, options, abortSignal) {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), this.requestTimeoutMs);
    const signal = this.combineSignals(abortSignal, timeoutController.signal);

    try {
      const imageData = options.imageData || (await this.readBrowserImage(imageUrl, options.pageUrl, signal));
      const response = await fetch(`${this.baseUrl}/upscale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          mode: options.mode,
          enhanceLevel: options.enhanceLevel,
          imageData,
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const metadata = await response.json();
      const imageResponse = await fetch(metadata.imageUrl, { signal });
      if (!imageResponse.ok) {
        throw new Error(`Image fetch returned ${imageResponse.status}`);
      }

      const buffer = await imageResponse.arrayBuffer();
      return {
        buffer,
        contentType: metadata.contentType || imageResponse.headers.get("content-type") || "image/png",
        cacheKey: metadata.cacheKey,
        backendCacheHit: Boolean(metadata.cacheHit),
        detectedMode: metadata.detectedMode,
        quality: metadata.quality,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async readBrowserImage(imageUrl, pageUrl, signal) {
    const ruleId = this.nextHeaderRuleId++;
    try {
      if (pageUrl) {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [ruleId],
          addRules: [{
            id: ruleId,
            priority: 1,
            action: {
              type: "modifyHeaders",
              requestHeaders: [{ header: "Referer", operation: "set", value: pageUrl }],
            },
            condition: {
              regexFilter: `^${this.escapeRegex(imageUrl)}$`,
              resourceTypes: ["xmlhttprequest", "other"],
            },
          }],
        });
      }
      const response = await fetch(imageUrl, {
        method: "GET",
        cache: "force-cache",
        credentials: "include",
        signal,
      });
      if (!response.ok) {
        throw new Error(`Browser could not read displayed image (${response.status})`);
      }
      const buffer = await response.arrayBuffer();
      if (!this.isImageBuffer(buffer)) {
        throw new Error("Website returned HTML or non-image data instead of the displayed image");
      }
      return this.arrayBufferToBase64(buffer);
    } finally {
      if (pageUrl) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
      }
    }
  }

  escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  isImageBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    return (
      (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
      (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ||
      (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) ||
      (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) ||
      (bytes.length > 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)
    );
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  combineSignals(primarySignal, timeoutSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();

    if (primarySignal?.aborted || timeoutSignal.aborted) {
      controller.abort();
      return controller.signal;
    }

    primarySignal?.addEventListener("abort", abort, { once: true });
    timeoutSignal.addEventListener("abort", abort, { once: true });
    return controller.signal;
  }
}

/**
 * Schedules image jobs by viewport distance while enforcing concurrency limits.
 */
class QueueScheduler {
  constructor({ maxConcurrentRequests, cacheProvider, upscaleProvider, statisticsTracker }) {
    this.maxConcurrentRequests = maxConcurrentRequests;
    this.cacheProvider = cacheProvider;
    this.upscaleProvider = upscaleProvider;
    this.statisticsTracker = statisticsTracker;
    this.pending = new Map();
    this.active = new Map();
  }

  enqueue(job) {
    if (this.active.has(job.imageId)) {
      this.updatePriority(job.imageId, job.viewportDistance);
      return;
    }

    const existing = this.pending.get(job.imageId);
    this.pending.set(job.imageId, {
      ...existing,
      ...job,
      attempt: existing?.attempt ?? 1,
      queuedAt: existing?.queuedAt ?? performance.now(),
      viewportDistance: Number.isFinite(job.viewportDistance) ? job.viewportDistance : Number.MAX_SAFE_INTEGER,
    });
    this.drain();
  }

  updatePriority(imageId, viewportDistance) {
    const pendingJob = this.pending.get(imageId);
    if (pendingJob) {
      pendingJob.viewportDistance = viewportDistance;
    }
  }

  cancel(imageId) {
    if (this.pending.delete(imageId)) {
      return;
    }

    const activeJob = this.active.get(imageId);
    if (activeJob) {
      activeJob.abortController.abort();
      this.active.delete(imageId);
      this.drain();
    }
  }

  snapshot() {
    return {
      queueSize: this.pending.size + this.active.size,
      processing: this.active.size,
      waiting: this.pending.size,
    };
  }

  drain() {
    while (this.active.size < this.maxConcurrentRequests && this.pending.size > 0) {
      const job = this.nextJob();
      this.pending.delete(job.imageId);
      const abortController = new AbortController();
      this.active.set(job.imageId, { ...job, abortController, startedAt: performance.now() });
      this.process({ ...job, abortController }).finally(() => {
        this.active.delete(job.imageId);
        this.drain();
      });
    }
  }

  nextJob() {
    return [...this.pending.values()].sort((left, right) => {
      if (left.viewportDistance !== right.viewportDistance) {
        return left.viewportDistance - right.viewportDistance;
      }
      return left.queuedAt - right.queuedAt;
    })[0];
  }

  async process(job) {
    const startedAt = performance.now();
    try {
      const cacheIdentity = `${job.imageUrl}|${job.mode}|${job.enhanceLevel}`;
      const cached = await this.cacheProvider.get(cacheIdentity);
      if (job.abortController.signal.aborted) {
        return;
      }
      if (cached) {
        await this.statisticsTracker.recordSuccess({
          latencyMs: performance.now() - startedAt,
          cacheHit: true,
          quality: cached.quality,
          detectedMode: cached.detectedMode,
        });
        this.sendComplete(job, cached, true);
        return;
      }

      const result = await this.upscaleProvider.upscale(
        job.imageUrl,
        {
          mode: job.mode,
          enhanceLevel: job.enhanceLevel,
          pageUrl: job.pageUrl,
          imageData: job.imageData,
        },
        job.abortController.signal,
      );
      if (job.abortController.signal.aborted) {
        return;
      }
      await this.cacheProvider.set(cacheIdentity, result);
      await this.statisticsTracker.recordSuccess({
        latencyMs: performance.now() - startedAt,
        cacheHit: false,
        quality: result.quality,
        detectedMode: result.detectedMode,
      });
      this.sendComplete(job, result, false);
    } catch (error) {
      if (job.abortController.signal.aborted) {
        return;
      }

      if (job.attempt < AI_MANGA_UPSCALER_CONFIG.retry.maxAttempts) {
        const delay = AI_MANGA_UPSCALER_CONFIG.retry.baseDelayMs * Math.pow(2, job.attempt - 1);
        setTimeout(() => {
          this.enqueue({ ...job, attempt: job.attempt + 1 });
        }, delay);
        return;
      }

      await this.statisticsTracker.recordError();
      chrome.tabs.sendMessage(job.tabId, {
        type: "UPSCALE_FAILED",
        imageId: job.imageId,
        message: error instanceof Error ? error.message : "Unknown upscale error",
      });
    }
  }

  sendComplete(job, result, cacheHit) {
    chrome.tabs.sendMessage(job.tabId, {
      type: "UPSCALE_COMPLETE",
      imageId: job.imageId,
      imageUrl: job.imageUrl,
      imageBase64: this.arrayBufferToBase64(result.buffer),
      contentType: result.contentType,
      cacheKey: result.cacheKey,
      cacheHit,
      detectedMode: result.detectedMode || job.mode,
    });
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";

    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return btoa(binary);
  }
}

const statisticsTracker = new StatisticsTracker(chrome.storage.local);
const cacheProvider = new CompositeCacheProvider(
  new MemoryCacheProvider(AI_MANGA_UPSCALER_CONFIG.cache.memoryMaxEntries),
  new IndexedDBCacheProvider(
    AI_MANGA_UPSCALER_CONFIG.cache.indexedDbName,
    AI_MANGA_UPSCALER_CONFIG.cache.indexedDbStoreName,
    AI_MANGA_UPSCALER_CONFIG.cache.indexedDbMaxEntries,
  ),
);
const upscaleProvider = new BackendUpscaleProvider(
  AI_MANGA_UPSCALER_CONFIG.backend.baseUrl,
  AI_MANGA_UPSCALER_CONFIG.backend.requestTimeoutMs,
);
const scheduler = new QueueScheduler({
  maxConcurrentRequests: AI_MANGA_UPSCALER_CONFIG.queue.maxConcurrentRequests,
  cacheProvider,
  upscaleProvider,
  statisticsTracker,
});

chrome.runtime.onInstalled.addListener(async () => {
  await statisticsTracker.ensureDefaults();
});

chrome.runtime.onStartup.addListener(async () => {
  await statisticsTracker.ensureDefaults();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ENQUEUE_IMAGE") {
    if (!sender.tab?.id) {
      sendResponse({ accepted: false, reason: "Missing sender tab." });
      return false;
    }

    chrome.storage.local.get(DEFAULT_STATE).then((settings) => {
      scheduler.enqueue({
        tabId: sender.tab.id,
        imageId: message.imageId,
        imageUrl: message.imageUrl,
        pageUrl: sender.tab.url,
        imageData: message.imageData || null,
        viewportDistance: message.viewportDistance,
        mode: settings.mode || AI_MANGA_UPSCALER_CONFIG.enhancement.defaultMode,
        enhanceLevel: Number(settings.enhanceLevel ?? AI_MANGA_UPSCALER_CONFIG.enhancement.defaultLevel),
      });
      sendResponse({ accepted: true });
    });
    return true;
  }

  if (message.type === "UPDATE_PRIORITY") {
    scheduler.updatePriority(message.imageId, message.viewportDistance);
    sendResponse({ updated: true });
    return false;
  }

  if (message.type === "CANCEL_IMAGE") {
    scheduler.cancel(message.imageId);
    sendResponse({ canceled: true });
    return false;
  }

  if (message.type === "GET_STATS") {
    statisticsTracker.snapshot(scheduler.snapshot()).then(sendResponse);
    return true;
  }

  if (message.type === "SET_ENABLED") {
    chrome.storage.local.set({ enabled: Boolean(message.enabled) }).then(() => {
      sendResponse({ enabled: Boolean(message.enabled) });
    });
    return true;
  }

  if (message.type === "SET_ENHANCEMENT") {
    const mode = AI_MANGA_UPSCALER_CONFIG.enhancement.modes.includes(message.mode) ? message.mode : "auto";
    const enhanceLevel = Math.min(Math.max(Number(message.enhanceLevel) || 0, 0), 1);
    chrome.storage.local.set({ mode, enhanceLevel }).then(() => sendResponse({ mode, enhanceLevel }));
    return true;
  }

  if (message.type === "SET_PREVIEW_ORIGINAL") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: "SET_PREVIEW_ORIGINAL",
          enabled: Boolean(message.enabled),
        });
      }
      sendResponse({ enabled: Boolean(message.enabled) });
    });
    return true;
  }

  return false;
});

statisticsTracker.ensureDefaults();
