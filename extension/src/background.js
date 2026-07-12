importScripts("./config.js");

const DEFAULT_STATE = Object.freeze({
  enabled: true,
  mode: AI_MANGA_UPSCALER_CONFIG.enhancement.defaultMode,
  enhanceLevel: AI_MANGA_UPSCALER_CONFIG.enhancement.defaultLevel,
  maxProcessingSeconds: AI_MANGA_UPSCALER_CONFIG.backend.defaultProcessingTimeoutSeconds,
  minInputWidth: AI_MANGA_UPSCALER_CONFIG.images.minWidthPx,
  minInputHeight: AI_MANGA_UPSCALER_CONFIG.images.minHeightPx,
  maxInputWidth: AI_MANGA_UPSCALER_CONFIG.images.maxWidthPx,
  maxInputHeight: AI_MANGA_UPSCALER_CONFIG.images.maxHeightPx,
  maxOutputWidth: AI_MANGA_UPSCALER_CONFIG.images.maxOutputWidthPx,
  maxOutputHeight: AI_MANGA_UPSCALER_CONFIG.images.maxOutputHeightPx,
  outputQuality: AI_MANGA_UPSCALER_CONFIG.images.outputQuality,
  sizingMode: "auto",
  resolutionPreset: "fhd",
  screenOrientation: "auto",
  performanceBoost: true,
  preprocessingConcurrency: AI_MANGA_UPSCALER_CONFIG.queue.preprocessingConcurrency,
  upscaleConcurrency: AI_MANGA_UPSCALER_CONFIG.queue.maxConcurrentRequests,
  seen: 0,
  processed: 0,
  errors: 0,
  cacheHits: 0,
  cacheMisses: 0,
  totalLatencyMs: 0,
  lastQuality: null,
  lastDetectedMode: null,
  lastComparison: null,
  blacklistRules: [],
});

/**
 * Tracks durable counters and computes extension performance metrics.
 */
class StatisticsTracker {
  constructor(storageArea) {
    this.storageArea = storageArea;
    this.tabStats = new Map();
  }

  tab(tabId) {
    if (!this.tabStats.has(tabId)) {
      this.tabStats.set(tabId, { seen: 0, fixed: 0, errors: 0, cache: 0 });
    }
    return this.tabStats.get(tabId);
  }

  async recordSeen(tabId) {
    this.tab(tabId).seen += 1;
    const current = await this.storageArea.get({ seen: 0 });
    await this.storageArea.set({ seen: Number(current.seen ?? 0) + 1 });
  }

  async ensureDefaults() {
    const current = await this.storageArea.get(DEFAULT_STATE);
    await this.storageArea.set({ ...DEFAULT_STATE, ...current });
  }

  async recordSuccess({ tabId, latencyMs, cacheHit, quality = null, detectedMode = null, comparison = null }) {
    const tab = this.tab(tabId);
    tab.fixed += 1;
    tab.cache += cacheHit ? 1 : 0;
    const current = await this.storageArea.get(DEFAULT_STATE);
    await this.storageArea.set({
      processed: Number(current.processed ?? 0) + 1,
      cacheHits: Number(current.cacheHits ?? 0) + (cacheHit ? 1 : 0),
      cacheMisses: Number(current.cacheMisses ?? 0) + (cacheHit ? 0 : 1),
      totalLatencyMs: Number(current.totalLatencyMs ?? 0) + latencyMs,
      lastQuality: quality || current.lastQuality || null,
      lastDetectedMode: detectedMode || current.lastDetectedMode || null,
      lastComparison: comparison || current.lastComparison || null,
    });
  }

  async recordError(tabId) {
    this.tab(tabId).errors += 1;
    const current = await this.storageArea.get(DEFAULT_STATE);
    await this.storageArea.set({
      errors: Number(current.errors ?? 0) + 1,
    });
  }

  async snapshot(queueSnapshot, activeTabId) {
    const current = await this.storageArea.get(DEFAULT_STATE);
    const processed = Number(current.processed ?? 0);
    const cacheHits = Number(current.cacheHits ?? 0);
    const cacheMisses = Number(current.cacheMisses ?? 0);
    const cacheTotal = cacheHits + cacheMisses;

    const currentTab = this.tabStats.get(activeTabId) || { seen: 0, fixed: 0, errors: 0, cache: 0 };
    const openTabs = [...this.tabStats.values()].reduce(
      (sum, item) => ({
        seen: sum.seen + item.seen,
        fixed: sum.fixed + item.fixed,
        errors: sum.errors + item.errors,
        cache: sum.cache + item.cache,
      }),
      { seen: 0, fixed: 0, errors: 0, cache: 0 },
    );
    return {
      enabled: Boolean(current.enabled),
      mode: current.mode || AI_MANGA_UPSCALER_CONFIG.enhancement.defaultMode,
      enhanceLevel: Number(current.enhanceLevel ?? AI_MANGA_UPSCALER_CONFIG.enhancement.defaultLevel),
      maxProcessingSeconds: Number(current.maxProcessingSeconds ?? AI_MANGA_UPSCALER_CONFIG.backend.defaultProcessingTimeoutSeconds),
      minInputWidth: Number(current.minInputWidth), minInputHeight: Number(current.minInputHeight),
      maxInputWidth: Number(current.maxInputWidth), maxInputHeight: Number(current.maxInputHeight),
      maxOutputWidth: Number(current.maxOutputWidth), maxOutputHeight: Number(current.maxOutputHeight),
      outputQuality: Number(current.outputQuality),
      sizingMode: current.sizingMode || "auto",
      resolutionPreset: current.resolutionPreset || "fhd",
      screenOrientation: current.screenOrientation || "auto",
      performanceBoost: Boolean(current.performanceBoost),
      preprocessingConcurrency: Number(current.preprocessingConcurrency),
      upscaleConcurrency: Number(current.upscaleConcurrency),
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
      lastComparison: current.lastComparison || null,
      blacklistRules: current.blacklistRules || [],
      scopes: {
        currentPage: { ...currentTab, processing: queueSnapshot.byTab[activeTabId] ?? 0 },
        openPages: { ...openTabs, processing: queueSnapshot.queueSize },
        lifetime: {
          seen: Number(current.seen ?? 0),
          fixed: processed,
          processing: queueSnapshot.queueSize,
          errors: Number(current.errors ?? 0),
          cache: cacheHits,
        },
      },
    };
  }

  removeTab(tabId) {
    this.tabStats.delete(tabId);
  }
}

class PageImageRegistry {
  constructor() {
    this.pages = new Map();
    this.domainRules = new Map();
    this.nextDomainRuleId = 100000;
  }

  page(tabId) {
    if (!this.pages.has(tabId)) this.pages.set(tabId, new Map());
    return this.pages.get(tabId);
  }

  async seen(tabId, image) {
    const page = this.page(tabId);
    page.set(image.imageId, { ...page.get(image.imageId), ...image, status: page.get(image.imageId)?.status || "seen" });
    await this.ensureDomainAccess(image.imageUrl, image.pageUrl);
  }

  update(tabId, imageId, patch) {
    const page = this.page(tabId);
    page.set(imageId, { ...page.get(imageId), imageId, ...patch });
  }

  list(tabId) {
    return [...(this.pages.get(tabId)?.values() || [])];
  }

  remove(tabId) {
    this.pages.delete(tabId);
  }

  async ensureDomainAccess(imageUrl, pageUrl) {
    if (!imageUrl || !pageUrl) return;
    const hostname = new URL(imageUrl).hostname;
    const key = `${hostname}|${new URL(pageUrl).origin}`;
    if (this.domainRules.has(key)) return;
    const ruleId = this.nextDomainRuleId++;
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id: ruleId,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "Referer", operation: "set", value: pageUrl }] },
        condition: { urlFilter: `||${hostname}^`, resourceTypes: ["image", "xmlhttprequest", "other", "main_frame"] },
      }],
    }).catch(() => {});
    this.domainRules.set(key, ruleId);
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
      originalImageUrl: record.originalImageUrl,
      enhancedImageUrl: record.enhancedImageUrl,
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
      originalImageUrl: value.originalImageUrl,
      enhancedImageUrl: value.enhancedImageUrl,
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
    let timedOut = false;
    const timeoutMs = Math.max(5, Number(options.maxProcessingSeconds) || 60) * 1000;
    const timeoutId = setTimeout(() => { timedOut = true; timeoutController.abort(); }, timeoutMs);
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
          jobId: options.jobId,
          maxOutputWidth: options.maxOutputWidth,
          maxOutputHeight: options.maxOutputHeight,
          outputQuality: options.outputQuality,
          tileSize: options.tileSize,
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
        originalImageUrl: metadata.originalImageUrl,
        enhancedImageUrl: metadata.imageUrl,
      };
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error(`Image exceeded the ${Math.round(timeoutMs / 1000)} second processing limit`);
        timeoutError.code = "PROCESSING_TIMEOUT";
        throw timeoutError;
      }
      throw error;
    } finally {
      if (signal.aborted && options.jobId) {
        await this.cancel(options.jobId);
      }
      clearTimeout(timeoutId);
    }
  }

  async cancel(jobId) {
    try {
      await fetch(`${this.baseUrl}/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    } catch {
      // Backend may already be stopped or the job may have completed.
    }
  }

  async readBrowserImage(imageUrl, pageUrl, signal) {
    const ruleId = this.nextHeaderRuleId++;
    const readController = new AbortController();
    const timeout = setTimeout(() => readController.abort(), AI_MANGA_UPSCALER_CONFIG.images.browserReadTimeoutMs);
    const readSignal = this.combineSignals(signal, readController.signal);
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
        signal: readSignal,
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
      clearTimeout(timeout);
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
    this.tabGenerations = new Map();
  }

  enqueue(job) {
    const generation = this.tabGenerations.get(job.tabId) || 0;
    if (job.generation !== undefined && job.generation !== generation) return;
    job.generation = generation;
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
    pageImageRegistry.update(job.tabId, job.imageId, { status: "waiting" });
    this.drain();
  }

  updatePriority(imageId, viewportDistance) {
    const pendingJob = this.pending.get(imageId);
    if (pendingJob) {
      pendingJob.viewportDistance = viewportDistance;
    }
  }

  setMaxConcurrentRequests(value) {
    this.maxConcurrentRequests = Math.min(Math.max(Number(value) || 1, 1), 8);
    this.drain();
  }

  cancel(imageId) {
    if (this.pending.delete(imageId)) {
      return;
    }

    const activeJob = this.active.get(imageId);
    if (activeJob) {
      activeJob.abortController.abort();
      this.upscaleProvider.cancel(activeJob.imageId);
      this.active.delete(imageId);
      this.drain();
    }
  }

  cancelTab(tabId) {
    this.tabGenerations.set(tabId, (this.tabGenerations.get(tabId) || 0) + 1);
    [...this.pending.values()]
      .filter((job) => job.tabId === tabId)
      .forEach((job) => this.pending.delete(job.imageId));
    [...this.active.values()]
      .filter((job) => job.tabId === tabId)
      .forEach((job) => {
        job.abortController.abort();
        this.upscaleProvider.cancel(job.imageId);
        this.active.delete(job.imageId);
      });
    this.drain();
  }

  snapshot() {
    const byTab = {};
    [...this.pending.values(), ...this.active.values()].forEach((job) => {
      byTab[job.tabId] = (byTab[job.tabId] || 0) + 1;
    });
    return {
      queueSize: this.pending.size + this.active.size,
      processing: this.active.size,
      waiting: this.pending.size,
      byTab,
    };
  }

  drain() {
    while (this.active.size < this.maxConcurrentRequests && this.pending.size > 0) {
      const job = this.nextJob();
      this.pending.delete(job.imageId);
      const abortController = new AbortController();
      this.active.set(job.imageId, { ...job, abortController, startedAt: performance.now() });
      pageImageRegistry.update(job.tabId, job.imageId, { status: "processing" });
      this.process({ ...job, abortController }).finally(() => {
        this.active.delete(job.imageId);
        this.drain();
      });
    }
  }

  nextJob() {
    return [...this.pending.values()].sort((left, right) => {
      if (Boolean(left.deferred) !== Boolean(right.deferred)) return left.deferred ? 1 : -1;
      if (left.viewportDistance !== right.viewportDistance) {
        return left.viewportDistance - right.viewportDistance;
      }
      return left.queuedAt - right.queuedAt;
    })[0];
  }

  async process(job) {
    const startedAt = performance.now();
    try {
      const cacheUrl = this.normalizeCacheUrl(job.imageUrl);
      const cacheIdentity = `${cacheUrl}|${job.mode}|${Number(job.enhanceLevel).toFixed(3)}|${job.maxOutputWidth}x${job.maxOutputHeight}|q${job.outputQuality}|t${job.tileSize}`;
      const cached = await this.cacheProvider.get(cacheIdentity);
      if (job.abortController.signal.aborted) {
        return;
      }
      if (cached) {
        await this.statisticsTracker.recordSuccess({
          tabId: job.tabId,
          latencyMs: performance.now() - startedAt,
          cacheHit: true,
          quality: cached.quality,
          detectedMode: cached.detectedMode,
          comparison: {
            originalImageUrl: cached.originalImageUrl,
            enhancedImageUrl: cached.enhancedImageUrl,
            imageUrl: job.imageUrl,
            quality: cached.quality,
            detectedMode: cached.detectedMode,
          },
        });
        this.sendComplete(job, cached, true);
        pageImageRegistry.update(job.tabId, job.imageId, {
          status: "cache",
          cacheHit: true,
          originalImageUrl: cached.originalImageUrl || job.imageUrl,
          enhancedImageUrl: cached.enhancedImageUrl,
          quality: cached.quality,
        });
        return;
      }

      const result = await this.upscaleProvider.upscale(
        job.imageUrl,
        {
          mode: job.mode,
          enhanceLevel: job.enhanceLevel,
          pageUrl: job.pageUrl,
          imageData: job.imageData,
          jobId: job.imageId,
          maxProcessingSeconds: job.maxProcessingSeconds,
          maxOutputWidth: job.maxOutputWidth,
          maxOutputHeight: job.maxOutputHeight,
          outputQuality: job.outputQuality,
          tileSize: job.tileSize,
        },
        job.abortController.signal,
      );
      if (job.abortController.signal.aborted) {
        return;
      }
      await this.cacheProvider.set(cacheIdentity, result);
      await this.statisticsTracker.recordSuccess({
        tabId: job.tabId,
        latencyMs: performance.now() - startedAt,
        cacheHit: false,
        quality: result.quality,
        detectedMode: result.detectedMode,
        comparison: {
          originalImageUrl: result.originalImageUrl,
          enhancedImageUrl: result.enhancedImageUrl,
          imageUrl: job.imageUrl,
          quality: result.quality,
          detectedMode: result.detectedMode,
        },
      });
      this.sendComplete(job, result, false);
      pageImageRegistry.update(job.tabId, job.imageId, {
        status: "fixed",
        cacheHit: false,
        originalImageUrl: result.originalImageUrl || job.imageUrl,
        enhancedImageUrl: result.enhancedImageUrl,
        quality: result.quality,
      });
    } catch (error) {
      if (job.abortController.signal.aborted) {
        return;
      }

      if (error?.code === "PROCESSING_TIMEOUT") {
        pageImageRegistry.update(job.tabId, job.imageId, { status: "timeout", error: error.message });
      }
      if (job.attempt < AI_MANGA_UPSCALER_CONFIG.retry.maxAttempts) {
        const delay = AI_MANGA_UPSCALER_CONFIG.retry.baseDelayMs * Math.pow(2, job.attempt - 1);
        setTimeout(() => {
          if (job.generation === (this.tabGenerations.get(job.tabId) || 0)) {
            this.enqueue({ ...job, attempt: job.attempt + 1, deferred: true });
          }
        }, delay);
        return;
      }

      await this.statisticsTracker.recordError(job.tabId);
      pageImageRegistry.update(job.tabId, job.imageId, {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown upscale error",
      });
      chrome.tabs.sendMessage(job.tabId, {
        type: "UPSCALE_FAILED",
        imageId: job.imageId,
        message: error instanceof Error ? error.message : "Unknown upscale error",
      });
    }
  }

  normalizeCacheUrl(imageUrl) {
    try {
      const parsed = new URL(imageUrl);
      // CDN signatures and cache-busting query values frequently change while
      // still identifying the same browser-visible image.
      const volatileParameters = new Set([
        "_", "cb", "cache", "cachebust", "cachebuster", "expires", "exp",
        "key", "policy", "signature", "sig", "token", "ts", "timestamp", "v",
      ]);
      for (const name of [...parsed.searchParams.keys()]) {
        if (volatileParameters.has(name.toLowerCase()) || name.toLowerCase().startsWith("x-amz-")) {
          parsed.searchParams.delete(name);
        }
      }
      parsed.hash = "";
      parsed.searchParams.sort();
      return parsed.toString();
    } catch {
      return String(imageUrl).split("#", 1)[0];
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
const pageImageRegistry = new PageImageRegistry();
let lastContentTabId = null;
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

async function backendHealthy() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${AI_MANGA_UPSCALER_CONFIG.backend.baseUrl}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureBackendStarted() {
  if (await backendHealthy()) {
    await chrome.storage.local.set({ backendLaunchStatus: "online", backendLaunchError: null });
    return { ok: true, status: "online" };
  }
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      "com.universal_ai_image_enhancer.launcher",
      { command: "start" },
      async (response) => {
        const runtimeError = chrome.runtime.lastError?.message;
        const error = runtimeError || response?.error || null;
        const ok = Boolean(response?.ok) && !error;
        await chrome.storage.local.set({
          backendLaunchStatus: ok ? response.status || "started" : "error",
          backendLaunchError: error,
        });
        resolve({ ok, status: response?.status, error });
      },
    );
  });
}

function resolveOutputLimits(settings, metrics = {}) {
  const clamp = (value, minimum, maximum) => Math.min(Math.max(Math.round(value), minimum), maximum);
  if (settings.sizingMode === "pixel") {
    return { width: Number(settings.maxOutputWidth), height: Number(settings.maxOutputHeight) };
  }
  const presets = { hd: [1280, 720], fhd: [1920, 1080], "2k": [2560, 1440], "4k": [3840, 2160] };
  if (settings.sizingMode === "screen") {
    let [width, height] = presets[settings.resolutionPreset] || presets.fhd;
    const orientation = settings.screenOrientation === "auto"
      ? ((metrics.screenHeight || 0) > (metrics.screenWidth || 0) ? "portrait" : "landscape")
      : settings.screenOrientation;
    if (orientation === "portrait") [width, height] = [height, width];
    return { width, height };
  }
  const ratio = clamp(Number(metrics.devicePixelRatio) || 1, 1, 3);
  const visibleWidth = Math.min(Number(metrics.renderedWidth) || 512, Number(metrics.viewportWidth) || 1920);
  const visibleHeight = Math.min(Number(metrics.renderedHeight) || 512, Number(metrics.viewportHeight) || 1080);
  const screenWidth = (Number(metrics.screenWidth) || 1920) * ratio;
  const screenHeight = (Number(metrics.screenHeight) || 1080) * ratio;
  const snap = (value, maximum) => clamp(Math.ceil(value / 256) * 256, 256, maximum);
  return {
    width: snap(Math.min(Math.max(visibleWidth * ratio * 1.35, 768), screenWidth), Number(settings.maxOutputWidth)),
    height: snap(Math.min(Math.max(visibleHeight * ratio * 1.35, 768), screenHeight), Number(settings.maxOutputHeight)),
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  await statisticsTracker.ensureDefaults();
  const settings = await chrome.storage.local.get({ enabled: true });
  if (settings.enabled) await ensureBackendStarted();
});

chrome.runtime.onStartup.addListener(async () => {
  await statisticsTracker.ensureDefaults();
  const settings = await chrome.storage.local.get({ enabled: true });
  if (settings.enabled) await ensureBackendStarted();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "IMAGE_SEEN") {
    if (sender.tab?.id) {
      lastContentTabId = sender.tab.id;
      Promise.all([
        statisticsTracker.recordSeen(sender.tab.id),
        pageImageRegistry.seen(sender.tab.id, {
          imageId: message.imageId,
          imageUrl: message.imageUrl,
          pageUrl: sender.tab.url,
          width: message.width,
          height: message.height,
        }),
      ]).then(() => sendResponse({ recorded: true }));
      return true;
    }
    return false;
  }

  if (message.type === "ENQUEUE_IMAGE") {
    if (!sender.tab?.id) {
      sendResponse({ accepted: false, reason: "Missing sender tab." });
      return false;
    }

    chrome.storage.local.get(DEFAULT_STATE).then((settings) => {
      lastContentTabId = sender.tab.id;
      const outputLimits = resolveOutputLimits(settings, message.displayMetrics);
      scheduler.enqueue({
        tabId: sender.tab.id,
        imageId: message.imageId,
        imageUrl: message.imageUrl,
        pageUrl: sender.tab.url,
        imageData: message.imageData || null,
        viewportDistance: message.viewportDistance,
        mode: settings.mode || AI_MANGA_UPSCALER_CONFIG.enhancement.defaultMode,
        enhanceLevel: Number(settings.enhanceLevel ?? AI_MANGA_UPSCALER_CONFIG.enhancement.defaultLevel),
        maxProcessingSeconds: Number(settings.maxProcessingSeconds ?? AI_MANGA_UPSCALER_CONFIG.backend.defaultProcessingTimeoutSeconds),
        maxOutputWidth: outputLimits.width,
        maxOutputHeight: outputLimits.height,
        outputQuality: Number(settings.outputQuality),
        tileSize: settings.performanceBoost && Math.max(
          Number(message.displayMetrics?.sourceWidth) || 0,
          Number(message.displayMetrics?.sourceHeight) || 0,
        ) >= 384 ? 512 : 256,
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
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      const activeTabId = tab?.url?.startsWith(chrome.runtime.getURL("")) ? lastContentTabId : tab?.id;
      statisticsTracker.snapshot(scheduler.snapshot(), activeTabId).then(sendResponse);
    });
    return true;
  }

  if (message.type === "GET_PAGE_IMAGES") {
    sendResponse({ tabId: lastContentTabId, images: pageImageRegistry.list(lastContentTabId) });
    return false;
  }

  if (message.type === "SET_ENABLED") {
    chrome.storage.local.set({ enabled: Boolean(message.enabled) }).then(() => {
      if (message.enabled) {
        ensureBackendStarted().then((launch) => sendResponse({ enabled: true, launch }));
      } else {
        sendResponse({ enabled: false });
      }
    });
    return true;
  }

  if (message.type === "START_BACKEND") {
    ensureBackendStarted().then(sendResponse);
    return true;
  }

  if (message.type === "SET_ENHANCEMENT") {
    const mode = AI_MANGA_UPSCALER_CONFIG.enhancement.modes.includes(message.mode) ? message.mode : "auto";
    const enhanceLevel = Math.min(Math.max(Number(message.enhanceLevel) || 0, 0), 1);
    chrome.storage.local.set({ mode, enhanceLevel }).then(() => sendResponse({ mode, enhanceLevel }));
    return true;
  }

  if (message.type === "SET_PROCESSING_TIMEOUT") {
    const maxProcessingSeconds = Math.min(Math.max(Number(message.seconds) || 60, 5), 300);
    chrome.storage.local.set({ maxProcessingSeconds }).then(() => sendResponse({ maxProcessingSeconds }));
    return true;
  }

  if (message.type === "SET_IMAGE_LIMITS") {
    const clamp = (value, minimum, maximum, fallback) => Math.min(Math.max(Number(value) || fallback, minimum), maximum);
    const limits = {
      minInputWidth: clamp(message.minInputWidth, 1, 16383, 128),
      minInputHeight: clamp(message.minInputHeight, 1, 16383, 128),
      maxInputWidth: clamp(message.maxInputWidth, 1, 32768, 8000),
      maxInputHeight: clamp(message.maxInputHeight, 1, 32768, 12000),
      maxOutputWidth: clamp(message.maxOutputWidth, 256, 16383, 2048),
      maxOutputHeight: clamp(message.maxOutputHeight, 256, 16383, 8192),
      outputQuality: clamp(message.outputQuality, 50, 100, 90),
      sizingMode: ["pixel", "auto", "screen"].includes(message.sizingMode) ? message.sizingMode : "auto",
      resolutionPreset: ["hd", "fhd", "2k", "4k"].includes(message.resolutionPreset) ? message.resolutionPreset : "fhd",
      screenOrientation: ["auto", "landscape", "portrait"].includes(message.screenOrientation) ? message.screenOrientation : "auto",
      performanceBoost: Boolean(message.performanceBoost),
      preprocessingConcurrency: clamp(message.preprocessingConcurrency, 1, 12, AI_MANGA_UPSCALER_CONFIG.queue.preprocessingConcurrency),
      upscaleConcurrency: clamp(message.upscaleConcurrency, 1, 8, AI_MANGA_UPSCALER_CONFIG.queue.maxConcurrentRequests),
    };
    limits.maxInputWidth = Math.max(limits.maxInputWidth, limits.minInputWidth);
    limits.maxInputHeight = Math.max(limits.maxInputHeight, limits.minInputHeight);
    scheduler.setMaxConcurrentRequests(limits.upscaleConcurrency);
    chrome.storage.local.set(limits).then(() => sendResponse(limits));
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

chrome.tabs.onRemoved.addListener((tabId) => {
  scheduler.cancelTab(tabId);
  statisticsTracker.removeTab(tabId);
  pageImageRegistry.remove(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  scheduler.cancelTab(tabId);
  statisticsTracker.removeTab(tabId);
  pageImageRegistry.remove(tabId);
});

statisticsTracker.ensureDefaults();
chrome.storage.local.get(DEFAULT_STATE).then((settings) => {
  scheduler.setMaxConcurrentRequests(settings.upscaleConcurrency);
  if (settings.enabled) ensureBackendStarted();
});
