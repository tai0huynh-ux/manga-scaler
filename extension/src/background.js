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
  minInputWidthEnabled: true,
  minInputHeightEnabled: true,
  maxInputWidthEnabled: true,
  maxInputHeightEnabled: true,
  maxOutputWidthEnabled: true,
  maxOutputHeightEnabled: true,
  imageSlicingEnabled: AI_MANGA_UPSCALER_CONFIG.images.slicingEnabled,
  imageSliceMaxHeight: AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx,
  outputQuality: AI_MANGA_UPSCALER_CONFIG.images.outputQuality,
  sizingMode: "auto",
  resolutionPreset: "fhd",
  screenOrientation: "auto",
  performanceBoost: true,
  textCleanupEnabled: AI_MANGA_UPSCALER_CONFIG.text.cleanupEnabled,
  textTranslateEnabled: AI_MANGA_UPSCALER_CONFIG.text.translateEnabled,
  textSourceLanguage: AI_MANGA_UPSCALER_CONFIG.text.sourceLanguage,
  textTargetLanguage: AI_MANGA_UPSCALER_CONFIG.text.targetLanguage,
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

function newTraceId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto?.getRandomValues?.(bytes);
    if (bytes.some((value) => value !== 0)) {
      return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // Test harnesses may not expose the browser crypto API.
  }
  return `trace-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function safeTracePrefix(value, length = 16) {
  if (typeof value !== "string" || !value) return null;
  return value.slice(0, length);
}

function sanitizeTraceMetadata(metadata = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    const lower = key.toLowerCase();
    if (lower.includes("imagedata") || lower.includes("base64") || lower.includes("authorization")) continue;
    if (typeof value === "string") sanitized[key] = value.length > 256 ? `${value.slice(0, 253)}...` : value;
    else if (typeof value === "number" || typeof value === "boolean" || value === null) sanitized[key] = value;
  }
  return sanitized;
}

function emitTrace({ event, traceId, component = "background", stage = "background", status, attempt = null, metadata = {} }) {
  try {
    const payload = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      event,
      traceId: traceId || newTraceId(),
      component,
      stage,
      status,
      attempt,
      metadata: sanitizeTraceMetadata(metadata),
    };
    if (Array.isArray(globalThis.__AI_MANGA_UPSCALER_TRACE_EVENTS__)) {
      globalThis.__AI_MANGA_UPSCALER_TRACE_EVENTS__.push(payload);
    }
    if (globalThis.__AI_MANGA_UPSCALER_DEBUG__ === true) {
      console.debug("[AI Enhancer][trace]", payload);
    }
    return payload;
  } catch {
    return null;
  }
}

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
      minInputWidthEnabled: current.minInputWidthEnabled !== false,
      minInputHeightEnabled: current.minInputHeightEnabled !== false,
      maxInputWidthEnabled: current.maxInputWidthEnabled !== false,
      maxInputHeightEnabled: current.maxInputHeightEnabled !== false,
      maxOutputWidthEnabled: current.maxOutputWidthEnabled !== false,
      maxOutputHeightEnabled: current.maxOutputHeightEnabled !== false,
      imageSlicingEnabled: current.imageSlicingEnabled !== false,
      imageSliceMaxHeight: Number(current.imageSliceMaxHeight ?? AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx),
      outputQuality: Number(current.outputQuality),
      sizingMode: current.sizingMode || "auto",
      resolutionPreset: current.resolutionPreset || "fhd",
      screenOrientation: current.screenOrientation || "auto",
      performanceBoost: Boolean(current.performanceBoost),
      textCleanupEnabled: Boolean(current.textCleanupEnabled),
      textTranslateEnabled: Boolean(current.textTranslateEnabled),
      textSourceLanguage: current.textSourceLanguage || AI_MANGA_UPSCALER_CONFIG.text.sourceLanguage,
      textTargetLanguage: current.textTargetLanguage || AI_MANGA_UPSCALER_CONFIG.text.targetLanguage,
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
    this.sequence = 0;
  }

  page(tabId) {
    if (!this.pages.has(tabId)) this.pages.set(tabId, new Map());
    return this.pages.get(tabId);
  }

  async seen(tabId, image) {
    const page = this.page(tabId);
    const existing = page.get(image.imageId);
    page.set(image.imageId, {
      ...existing,
      ...image,
      tabId,
      status: existing?.operationId === image.operationId ? existing?.status || "seen" : image.status || "seen",
      order: existing?.order ?? (Number.isFinite(image.pageOrder) ? image.pageOrder : this.sequence++),
      seenAt: existing?.seenAt ?? performance.now(),
    });
  }

  update(tabId, imageId, patch) {
    const page = this.page(tabId);
    const existing = page.get(imageId);
    if (existing?.operationId && existing.operationId !== patch.operationId) {
      return false;
    }
    page.set(imageId, {
      ...existing,
      imageId,
      tabId,
      ...patch,
      order: existing?.order ?? (Number.isFinite(patch.pageOrder) ? patch.pageOrder : this.sequence++),
      updatedAt: performance.now(),
    });
    return true;
  }

  list(tabId) {
    return this.exportArray(this.pages.get(tabId)?.values() || []);
  }

  listAll() {
    return this.exportArray([...this.pages.values()]
      .flatMap((page) => [...page.values()])
      .sort((left, right) => {
        const statusRank = { processing: 0, preprocessing: 1, preprocessing_queued: 2, waiting: 3, seen: 4, timeout: 5, error: 6, cancelled: 7, fixed: 8, cache: 9 };
        if ((left.order ?? 0) !== (right.order ?? 0)) return (left.order ?? 0) - (right.order ?? 0);
        const leftRank = statusRank[left.status] ?? 8;
        const rightRank = statusRank[right.status] ?? 8;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return String(left.imageId || "").localeCompare(String(right.imageId || ""));
      }));
  }

  exportArray(values) {
    const result = Array.isArray(values) ? values : [...values];
    try {
      const hostArrayPrototype = globalThis.constructor?.constructor?.("return Array.prototype")();
      if (hostArrayPrototype && Object.getPrototypeOf(result) !== hostArrayPrototype) {
        Object.setPrototypeOf(result, hostArrayPrototype);
      }
    } catch {
      // Extension CSP can reject Function construction; cross-realm arrays only matter in VM tests.
    }
    return result;
  }

  removeImage(tabId, imageId, operationId = null) {
    const page = this.pages.get(tabId);
    const existing = page?.get(imageId);
    if (typeof operationId !== "string" || !operationId || (existing?.operationId && existing.operationId !== operationId)) {
      return false;
    }
    return Boolean(page?.delete(imageId));
  }

  remove(tabId) {
    this.pages.delete(tabId);
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
    this.imageReadLocks = new Map();
    this.headerRuleCleanup = this.cleanupStaleHeaderRules();
  }

  async upscale(imageUrl, options, abortSignal) {
    const launch = await ensureBackendStarted();
    if (!launch.ok) throw new Error(launch.error || "Backend could not be started");
    const timeoutController = new AbortController();
    let timedOut = false;
    const timeoutMs = Math.max(5, Number(options.maxProcessingSeconds) || 60) * 1000;
    const timeoutId = setTimeout(() => { timedOut = true; timeoutController.abort(); }, timeoutMs);
    const signal = this.combineSignals(abortSignal, timeoutController.signal);

    try {
      const imageData = options.imageData || (await this.readBrowserImage(imageUrl, options.pageUrl, signal));
      const requestStarted = performance.now();
      emitTrace({
        event: "background.backend.request.started",
        traceId: options.traceId,
        status: "running",
        attempt: options.attempt,
        metadata: {
          queue_key_prefix: safeTracePrefix(options.jobId),
          source_fingerprint_prefix: safeTracePrefix(options.sourceFingerprint),
        },
      });
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
          textProcessing: options.textProcessing,
          traceId: options.traceId,
          operationId: options.operationId,
          queueKey: options.queueKey || options.jobId,
          attempt: options.attempt,
          sourceFingerprint: options.sourceFingerprint,
        }),
        signal,
      });
      if (!response.ok) {
        let errorPayload = null;
        try {
          errorPayload = await response.json();
        } catch {
          errorPayload = null;
        }
        emitTrace({
          event: "background.backend.request.failed",
          traceId: options.traceId || errorPayload?.detail?.traceId,
          status: "failed",
          attempt: options.attempt,
          metadata: {
            http_status: response.status,
            error_code: errorPayload?.detail?.errorCode || "BACKEND_REQUEST_FAILED",
            duration_ms: Math.max(0, performance.now() - requestStarted),
          },
        });
        throw new Error(`Backend returned ${response.status}`);
      }

      const metadata = await response.json();
      emitTrace({
        event: "background.backend.request.completed",
        traceId: options.traceId || metadata.traceId,
        status: "completed",
        attempt: options.attempt,
        metadata: {
          http_status: response.status,
          duration_ms: Math.max(0, performance.now() - requestStarted),
          backend_cache_hit: Boolean(metadata.cacheHit),
        },
      });
      const outputFetchStarted = performance.now();
      emitTrace({
        event: "background.backend.output_fetch.started",
        traceId: options.traceId || metadata.traceId,
        status: "running",
        attempt: options.attempt,
        metadata: { queue_key_prefix: safeTracePrefix(options.jobId) },
      });
      const imageResponse = await fetch(metadata.imageUrl, { signal });
      if (!imageResponse.ok) {
        emitTrace({
          event: "background.backend.output_fetch.failed",
          traceId: options.traceId || metadata.traceId,
          status: "failed",
          attempt: options.attempt,
          metadata: {
            http_status: imageResponse.status,
            duration_ms: Math.max(0, performance.now() - outputFetchStarted),
          },
        });
        throw new Error(`Image fetch returned ${imageResponse.status}`);
      }

      const buffer = await imageResponse.arrayBuffer();
      emitTrace({
        event: "background.backend.output_fetch.completed",
        traceId: options.traceId || metadata.traceId,
        status: "completed",
        attempt: options.attempt,
        metadata: {
          http_status: imageResponse.status,
          duration_ms: Math.max(0, performance.now() - outputFetchStarted),
        },
      });
      return {
        buffer,
        contentType: metadata.contentType || imageResponse.headers.get("content-type") || "image/png",
        cacheKey: metadata.cacheKey,
        backendCacheHit: Boolean(metadata.cacheHit),
        detectedMode: metadata.detectedMode,
        quality: metadata.quality,
        originalImageUrl: metadata.originalImageUrl,
        enhancedImageUrl: metadata.imageUrl,
        traceId: metadata.traceId || options.traceId,
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
    const previousRead = this.imageReadLocks.get(imageUrl) || Promise.resolve();
    let releaseRead;
    const currentRead = new Promise((resolve) => { releaseRead = resolve; });
    const readTail = previousRead.catch(() => {}).then(() => currentRead);
    this.imageReadLocks.set(imageUrl, readTail);

    try {
      const waitForPrevious = previousRead.catch(() => {});
      if (signal) await Promise.race([waitForPrevious, this.rejectOnAbort(signal)]);
      else await waitForPrevious;
      return await this.readBrowserImageWithRule(imageUrl, pageUrl, signal);
    } finally {
      releaseRead();
      readTail.finally(() => {
        if (this.imageReadLocks.get(imageUrl) === readTail) this.imageReadLocks.delete(imageUrl);
      });
    }
  }

  async readBrowserImageWithRule(imageUrl, pageUrl, signal) {
    await this.headerRuleCleanup;
    const ruleId = this.nextHeaderRuleId++;
    const readController = new AbortController();
    const timeout = setTimeout(() => readController.abort(), AI_MANGA_UPSCALER_CONFIG.images.browserReadTimeoutMs);
    const readSignal = this.combineSignals(signal, readController.signal);
    const abortRead = this.rejectOnAbort(readSignal);
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
      const response = await Promise.race([
        fetch(imageUrl, {
          method: "GET",
          cache: "force-cache",
          credentials: "include",
          signal: readSignal,
        }),
        abortRead,
      ]);
      if (!response.ok) {
        throw new Error(`Browser could not read displayed image (${response.status})`);
      }
      const buffer = await Promise.race([response.arrayBuffer(), abortRead]);
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

  async cleanupStaleHeaderRules() {
    try {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const removeRuleIds = rules
        .filter((rule) => (
          Number.isInteger(rule.id) && rule.id >= 1000 && rule.id < 200000 &&
          rule.action?.requestHeaders?.some((header) => String(header.header).toLowerCase() === "referer")
        ))
        .map((rule) => rule.id);
      if (removeRuleIds.length) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
      }
    } catch {
      // A read still performs its own exact-rule cleanup when session-rule inspection is unavailable.
    }
  }

  readImageFailureReason(error) {
    if (error?.name === "AbortError") return "read-timeout";
    if (/non-image|HTML/i.test(error?.message || "")) return "read-non-image";
    if (/timed out|timeout/i.test(error?.message || "")) return "read-timeout";
    return "read-fetch-error";
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

  rejectOnAbort(signal) {
    return new Promise((_, reject) => {
      const abort = () => {
        const error = new Error("Browser image read was aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
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
    this.retryTimers = new Map();
    this.cancelledQueueKeys = new Set();
    this.tabGenerations = new Map();
    this.paused = false;
  }

  enqueue(job) {
    if (this.paused) return false;
    if (!this.hasOperationIdentity(job.tabId, job.imageId, job.operationId)) return false;
    const generation = this.tabGenerations.get(job.tabId) || 0;
    if (job.generation !== undefined && job.generation !== generation) return false;
    job.generation = generation;
    job.queueKey = this.queueKey(job);
    job.traceId = job.traceId || newTraceId();
    if (this.cancelledQueueKeys.has(job.queueKey)) return false;
    this.clearRetry(job.queueKey);
    if (this.active.has(job.queueKey)) {
      this.updatePriority(job.tabId, job.imageId, job.viewportDistance, job.operationId);
      return true;
    }

    const existing = this.pending.get(job.queueKey);
    this.pending.set(job.queueKey, {
      ...existing,
      ...job,
      attempt: existing?.attempt ?? job.attempt ?? 1,
      queuedAt: existing?.queuedAt ?? performance.now(),
      pageOrder: Number.isFinite(job.pageOrder) ? job.pageOrder : existing?.pageOrder ?? Number.MAX_SAFE_INTEGER,
      viewportDistance: Number.isFinite(job.viewportDistance) ? job.viewportDistance : Number.MAX_SAFE_INTEGER,
    });
    if (!job.deferred) this.preemptDeferredActiveJobs();
    pageImageRegistry.update(job.tabId, job.imageId, { operationId: job.operationId, status: "waiting", pageOrder: job.pageOrder });
    emitTrace({
      event: "background.job.enqueued",
      traceId: job.traceId,
      status: "queued",
      attempt: existing?.attempt ?? job.attempt ?? 1,
      metadata: {
        queue_key_prefix: safeTracePrefix(job.queueKey),
        source_fingerprint_prefix: safeTracePrefix(job.sourceFingerprint),
        cache_variant: job.cacheVariant || "full",
      },
    });
    this.drain();
    return true;
  }

  queueKey(job) {
    if (!this.hasOperationIdentity(job.tabId, job.imageId, job.operationId)) return null;
    return `${job.tabId}:${job.imageId}:${job.operationId}`;
  }

  hasOperationIdentity(tabId, imageId, operationId) {
    return (
      Number.isInteger(tabId) &&
      typeof imageId === "string" && Boolean(imageId) &&
      typeof operationId === "string" && Boolean(operationId)
    );
  }

  updatePriority(tabId, imageId, viewportDistance, operationId) {
    const queueKey = this.queueKey({ tabId, imageId, operationId });
    if (!queueKey || this.cancelledQueueKeys.has(queueKey)) return false;
    const pendingJob = this.pending.get(queueKey);
    if (pendingJob) {
      pendingJob.viewportDistance = viewportDistance;
      return true;
    }
    return false;
  }

  setMaxConcurrentRequests(value) {
    this.maxConcurrentRequests = Math.min(Math.max(Number(value) || 1, 1), 2);
    this.drain();
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) {
      this.cancelAll();
      return;
    }
    this.drain();
  }

  cancel(tabId, imageId, operationId) {
    const queueKey = this.queueKey({ tabId, imageId, operationId });
    if (!queueKey) return false;
    const cancelled = this.cancelQueueKey(queueKey, "explicit");
    if (cancelled) this.drain();
    return true;
  }

  cancelTab(tabId) {
    this.tabGenerations.set(tabId, (this.tabGenerations.get(tabId) || 0) + 1);
    [...this.pending.values()]
      .filter((job) => job.tabId === tabId)
      .forEach((job) => this.cancelQueueKey(job.queueKey, "tab_cleanup"));
    [...this.active.values()]
      .filter((job) => job.tabId === tabId)
      .forEach((job) => this.cancelQueueKey(job.queueKey, "tab_cleanup"));
    [...this.retryTimers.entries()]
      .filter(([, retry]) => retry.job.tabId === tabId)
      .forEach(([queueKey]) => this.invalidateQueueKey(queueKey));
    this.drain();
  }

  cancelAll() {
    [...this.pending.keys()].forEach((queueKey) => this.cancelQueueKey(queueKey, "cancel_all"));
    [...this.active.values()].forEach((job) => this.cancelQueueKey(job.queueKey, "cancel_all"));
    [...this.retryTimers.keys()].forEach((queueKey) => this.invalidateQueueKey(queueKey));
    this.pending.clear();
    this.active.clear();
  }

  clearRetry(queueKey) {
    const retry = this.retryTimers.get(queueKey);
    if (!retry) return false;
    clearTimeout(retry.timerId);
    this.retryTimers.delete(queueKey);
    return true;
  }

  invalidateQueueKey(queueKey) {
    if (!queueKey) return;
    this.cancelledQueueKeys.add(queueKey);
    this.clearRetry(queueKey);
  }

  cancelQueueKey(queueKey, reason) {
    if (!queueKey) return false;
    const pendingJob = this.pending.get(queueKey);
    const activeJob = this.active.get(queueKey);
    const job = pendingJob || activeJob;
    this.invalidateQueueKey(queueKey);
    this.pending.delete(queueKey);
    if (activeJob) {
      activeJob.abortController.abort();
      this.upscaleProvider.cancel(queueKey);
      this.active.delete(queueKey);
    }
    if (!job || job.cancelTraceEmitted) return Boolean(job);
    job.cancelTraceEmitted = true;
    emitTrace({
      event: "background.job.cancelled",
      traceId: job.traceId,
      status: "cancelled",
      attempt: job.attempt,
      metadata: { reason, queue_key_prefix: safeTracePrefix(queueKey) },
    });
    return true;
  }

  scheduleRetry(job, delay) {
    const queueKey = job.queueKey;
    if (!queueKey || this.cancelledQueueKeys.has(queueKey)) return;
    this.clearRetry(queueKey);
    const timerId = setTimeout(() => {
      const retry = this.retryTimers.get(queueKey);
      if (!retry || retry.timerId !== timerId) return;
      this.retryTimers.delete(queueKey);
      if (
        this.cancelledQueueKeys.has(queueKey) ||
        job.generation !== (this.tabGenerations.get(job.tabId) || 0)
      ) {
        return;
      }
      this.enqueue({
        ...job,
        abortController: undefined,
        attempt: job.attempt + 1,
        deferred: true,
      });
    }, delay);
    this.retryTimers.set(queueKey, { timerId, job });
  }

  preemptDeferredActiveJobs() {
    [...this.active.values()]
      .filter((job) => job.deferred)
      .forEach((job) => {
        job.abortController.abort();
        this.upscaleProvider.cancel(job.queueKey);
        this.active.delete(job.queueKey);
        emitTrace({
          event: "background.job.preempted",
          traceId: job.traceId,
          status: "preempted",
          attempt: job.attempt,
          metadata: { reason: "foreground_job", queue_key_prefix: safeTracePrefix(job.queueKey) },
        });
        this.pending.set(job.queueKey, {
          ...job,
          abortController: undefined,
          queuedAt: performance.now(),
          pageOrder: job.pageOrder ?? Number.MAX_SAFE_INTEGER,
          viewportDistance: Number.MAX_SAFE_INTEGER,
          deferred: true,
        });
        emitTrace({
          event: "background.job.requeued",
          traceId: job.traceId,
          status: "queued",
          attempt: job.attempt,
          metadata: { reason: "preempted", queue_key_prefix: safeTracePrefix(job.queueKey) },
        });
        pageImageRegistry.update(job.tabId, job.imageId, { operationId: job.operationId, status: "waiting", deferred: true });
      });
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
    if (this.paused) return;
    while (this.active.size < this.maxConcurrentRequests && this.pending.size > 0) {
      const job = this.nextJob();
      this.pending.delete(job.queueKey);
      const abortController = new AbortController();
      const startedAt = performance.now();
      const activeJob = { ...job, abortController, startedAt };
      this.active.set(job.queueKey, activeJob);
      pageImageRegistry.update(job.tabId, job.imageId, {
        operationId: job.operationId,
        status: "processing",
        startedAt,
        deferred: Boolean(job.deferred),
        pageOrder: job.pageOrder,
      });
      this.process(activeJob).finally(() => {
        if (this.active.get(job.queueKey) === activeJob) {
          this.active.delete(job.queueKey);
        }
        this.drain();
      });
    }
  }

  nextJob() {
    return [...this.pending.values()].sort((left, right) => {
      if (Boolean(left.deferred) !== Boolean(right.deferred)) return left.deferred ? 1 : -1;
      if ((left.pageOrder ?? Number.MAX_SAFE_INTEGER) !== (right.pageOrder ?? Number.MAX_SAFE_INTEGER)) {
        return (left.pageOrder ?? Number.MAX_SAFE_INTEGER) - (right.pageOrder ?? Number.MAX_SAFE_INTEGER);
      }
      return left.queuedAt - right.queuedAt;
    })[0];
  }

  isCurrentJob(job) {
    return Boolean(
      job?.queueKey &&
      !job.abortController?.signal.aborted &&
      !this.cancelledQueueKeys.has(job.queueKey) &&
      this.active.get(job.queueKey) === job
    );
  }

  async process(job) {
    const startedAt = performance.now();
    try {
      const cacheUrl = job.sourceFingerprint ? this.normalizeCacheUrl(job.imageUrl) : this.canonicalCacheUrl(job.imageUrl);
      const contentIdentity = job.sourceFingerprint || `url:${cacheUrl}`;
      const cacheVariant = job.cacheVariant || "full";
      const parentContentIdentity = cacheVariant.startsWith("segment-")
        ? `|parent:${job.parentSourceFingerprint || `url:${this.canonicalCacheUrl(job.imageUrl)}`}`
        : "";
      const textVariant = job.textProcessing?.enabled
        ? `text:${job.textProcessing.cleanup ? "c1" : "c0"}:${job.textProcessing.translate ? "tr1" : "tr0"}:${job.textProcessing.sourceLanguage || "auto"}>${job.textProcessing.targetLanguage || "vi"}`
        : "text:off";
      const cacheIdentity = `${contentIdentity}${parentContentIdentity}|${cacheVariant}|${job.mode}|${Number(job.enhanceLevel).toFixed(3)}|${job.maxOutputWidth}x${job.maxOutputHeight}|q${job.outputQuality}|t${job.tileSize}|${textVariant}`;
      const cached = await this.cacheProvider.get(cacheIdentity);
      if (!this.isCurrentJob(job)) {
        return;
      }
      if (cached) {
        emitTrace({
          event: "background.cache.hit",
          traceId: job.traceId,
          status: "cache_hit",
          attempt: job.attempt,
          metadata: {
            cache_key_prefix: safeTracePrefix(cacheIdentity),
            source_fingerprint_prefix: safeTracePrefix(job.sourceFingerprint),
            variant: cacheVariant,
          },
        });
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
        if (!this.isCurrentJob(job)) return;
        this.sendComplete(job, cached, true);
        emitTrace({
          event: "background.job.completed",
          traceId: job.traceId,
          status: "completed",
          attempt: job.attempt,
          metadata: { cache_hit: true, duration_ms: Math.max(0, performance.now() - startedAt) },
        });
        pageImageRegistry.update(job.tabId, job.imageId, {
          operationId: job.operationId,
          status: "cache",
          cacheHit: true,
          originalImageUrl: cached.originalImageUrl || job.imageUrl,
          enhancedImageUrl: cached.enhancedImageUrl,
          quality: cached.quality,
        });
        return;
      }
      emitTrace({
        event: "background.cache.miss",
        traceId: job.traceId,
        status: "cache_miss",
        attempt: job.attempt,
        metadata: {
          cache_key_prefix: safeTracePrefix(cacheIdentity),
          source_fingerprint_prefix: safeTracePrefix(job.sourceFingerprint),
          variant: cacheVariant,
        },
      });

      const result = await this.upscaleProvider.upscale(
        job.imageUrl,
        {
          mode: job.mode,
          enhanceLevel: job.enhanceLevel,
          pageUrl: job.pageUrl,
          imageData: job.imageData,
          jobId: job.queueKey,
          queueKey: job.queueKey,
          traceId: job.traceId,
          operationId: job.operationId,
          attempt: job.attempt,
          sourceFingerprint: job.sourceFingerprint,
          maxProcessingSeconds: job.maxProcessingSeconds,
          maxOutputWidth: job.maxOutputWidth,
          maxOutputHeight: job.maxOutputHeight,
          outputQuality: job.outputQuality,
          tileSize: job.tileSize,
          textProcessing: job.textProcessing,
        },
        job.abortController.signal,
      );
      if (!this.isCurrentJob(job)) {
        return;
      }
      await this.cacheProvider.set(cacheIdentity, result);
      if (!this.isCurrentJob(job)) return;
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
      if (!this.isCurrentJob(job)) return;
      this.sendComplete(job, result, false);
      emitTrace({
        event: "background.job.completed",
        traceId: job.traceId || result.traceId,
        status: "completed",
        attempt: job.attempt,
        metadata: { cache_hit: false, duration_ms: Math.max(0, performance.now() - startedAt) },
      });
      pageImageRegistry.update(job.tabId, job.imageId, {
        operationId: job.operationId,
        status: "fixed",
        cacheHit: false,
        originalImageUrl: result.originalImageUrl || job.imageUrl,
        enhancedImageUrl: result.enhancedImageUrl,
        quality: result.quality,
      });
    } catch (error) {
      if (!this.isCurrentJob(job)) {
        return;
      }

      if (error?.code === "PROCESSING_TIMEOUT") {
        await this.failJob(job, error, "timeout");
        return;
      }
      if (job.attempt < AI_MANGA_UPSCALER_CONFIG.retry.maxAttempts) {
        const delay = AI_MANGA_UPSCALER_CONFIG.retry.baseDelayMs * Math.pow(2, job.attempt - 1);
        emitTrace({
          event: "background.job.retrying",
          traceId: job.traceId,
          status: "retrying",
          attempt: job.attempt + 1,
          metadata: { retry_reason: error?.message || "unknown", delay_ms: delay },
        });
        this.scheduleRetry(job, delay);
        return;
      }

      await this.failJob(job, error, "error");
    }
  }

  async failJob(job, error, status = "error") {
    const message = error instanceof Error ? error.message : "Unknown upscale error";
    await this.statisticsTracker.recordError(job.tabId);
    if (!this.isCurrentJob(job)) return false;
    pageImageRegistry.update(job.tabId, job.imageId, {
      operationId: job.operationId,
      status,
      error: message,
      failedAt: performance.now(),
    });
    emitTrace({
      event: "background.job.failed",
      traceId: job.traceId,
      status,
      attempt: job.attempt,
      metadata: { message, queue_key_prefix: safeTracePrefix(job.queueKey) },
    });
    chrome.tabs.sendMessage(job.tabId, {
      type: "UPSCALE_FAILED",
      imageId: job.imageId,
      operationId: job.operationId,
      sourceRevision: job.sourceRevision,
      traceId: job.traceId,
      message,
      status,
      permanent: status === "timeout",
    }).catch(() => {});
    return true;
  }

  normalizeCacheUrl(imageUrl) {
    try {
      const parsed = new URL(imageUrl);
      // CDN signatures and cache-busting query values frequently change while
      // still identifying the same browser-visible image.
      const volatileParameters = new Set([
        "_", "cb", "cache", "cachebust", "cachebuster", "expires", "exp",
        "key", "policy", "signature", "sig", "token", "ts", "timestamp",
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

  canonicalCacheUrl(imageUrl) {
    try {
      const parsed = new URL(imageUrl);
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
      operationId: job.operationId,
      sourceRevision: job.sourceRevision,
      sourceFingerprint: job.sourceFingerprint || null,
      traceId: job.traceId,
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

let backendLaunchPromise = null;

async function startBackendIfNeeded() {
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

function ensureBackendStarted() {
  if (!backendLaunchPromise) {
    backendLaunchPromise = startBackendIfNeeded().finally(() => { backendLaunchPromise = null; });
  }
  return backendLaunchPromise;
}

async function ensureContentScripts() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.allSettled(tabs.map(async (tab) => {
    if (!tab.id) return;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "AI_ENHANCER_PING" });
      if (response?.ok) return;
    } catch {
      // The tab predates the current extension service worker or has no content script.
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        document.querySelectorAll("img[data-ai-manga-upscaler-observed]").forEach((image) => {
          delete image.dataset.aiMangaUpscalerObserved;
          delete image.dataset.aiEnhancerSeen;
        });
      },
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/config.js", "src/content.js"],
    });
  }));
}

async function maintainRuntime() {
  const settings = await chrome.storage.local.get({ enabled: true });
  if (!settings.enabled) return;
  await ensureBackendStarted();
  await ensureContentScripts();
}

async function notifyContentEnabled(enabled) {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.allSettled(tabs.map((tab) => (
    tab.id ? chrome.tabs.sendMessage(tab.id, { type: "SET_ENABLED", enabled }).catch(() => {}) : Promise.resolve()
  )));
}

function resolveOutputLimits(settings, metrics = {}) {
  const clamp = (value, minimum, maximum) => Math.min(Math.max(Math.round(value), minimum), maximum);
  const outputWidthEnabled = settings.maxOutputWidthEnabled !== false;
  const outputHeightEnabled = settings.maxOutputHeightEnabled !== false;
  const configuredMaxWidth = outputWidthEnabled ? Number(settings.maxOutputWidth) : 16383;
  const configuredMaxHeight = outputHeightEnabled ? Number(settings.maxOutputHeight) : 16383;
  const isSegment = typeof metrics.cacheVariant === "string" && metrics.cacheVariant.startsWith("segment-");
  if (settings.sizingMode === "pixel") {
    return {
      width: outputWidthEnabled ? Number(settings.maxOutputWidth) : null,
      height: outputHeightEnabled ? Number(settings.maxOutputHeight) : null,
    };
  }
  if (settings.sizingMode === "auto" && isSegment) {
    return {
      width: outputWidthEnabled ? configuredMaxWidth : null,
      height: outputHeightEnabled ? configuredMaxHeight : null,
    };
  }
  const presets = { hd: [1280, 720], fhd: [1920, 1080], "2k": [2560, 1440], "4k": [3840, 2160] };
  if (settings.sizingMode === "screen") {
    let [width, height] = presets[settings.resolutionPreset] || presets.fhd;
    const orientation = settings.screenOrientation === "auto"
      ? ((metrics.screenHeight || 0) > (metrics.screenWidth || 0) ? "portrait" : "landscape")
      : settings.screenOrientation;
    if (orientation === "portrait") [width, height] = [height, width];
    return {
      width: outputWidthEnabled ? Math.min(width, configuredMaxWidth) : null,
      height: outputHeightEnabled ? Math.min(height, configuredMaxHeight) : null,
    };
  }
  const ratio = clamp(Number(metrics.devicePixelRatio) || 1, 1, 3);
  const visibleWidth = Math.min(Number(metrics.renderedWidth) || 512, Number(metrics.viewportWidth) || 1920);
  const visibleHeight = Math.min(Number(metrics.renderedHeight) || 512, Number(metrics.viewportHeight) || 1080);
  const screenWidth = (Number(metrics.screenWidth) || 1920) * ratio;
  const screenHeight = (Number(metrics.screenHeight) || 1080) * ratio;
  const snap = (value, maximum) => clamp(Math.ceil(value / 256) * 256, 256, maximum);
  return {
    width: outputWidthEnabled ? snap(Math.min(Math.max(visibleWidth * ratio * 1.35, 768), screenWidth), configuredMaxWidth) : null,
    height: outputHeightEnabled ? snap(Math.min(Math.max(visibleHeight * ratio * 1.35, 768), screenHeight), configuredMaxHeight) : null,
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  await statisticsTracker.ensureDefaults();
  const settings = await chrome.storage.local.get({ enabled: true });
  if (settings.enabled) await maintainRuntime();
});

chrome.runtime.onStartup.addListener(async () => {
  await statisticsTracker.ensureDefaults();
  const settings = await chrome.storage.local.get({ enabled: true });
  if (settings.enabled) await maintainRuntime();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "ai-enhancer-watchdog") maintainRuntime();
});
chrome.alarms.create("ai-enhancer-watchdog", { periodInMinutes: 0.5 });

function hasMessageOperationIdentity(message, sender) {
  return Boolean(
    Number.isInteger(sender.tab?.id) &&
    typeof message.imageId === "string" && message.imageId &&
    typeof message.operationId === "string" && message.operationId
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PREPROCESSING_QUEUED") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ recorded: false, reason: "Missing operation identity." });
      return false;
    }
    pageImageRegistry.update(sender.tab.id, message.imageId, {
      operationId: message.operationId,
      sourceRevision: message.sourceRevision,
      status: "preprocessing_queued",
      pageOrder: Number(message.pageOrder),
      viewportDistance: Number(message.viewportDistance),
      queuedAt: performance.now(),
    });
    sendResponse({ recorded: true });
    return false;
  }

  if (message.type === "PREPROCESSING_STARTED") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ recorded: false, reason: "Missing operation identity." });
      return false;
    }
    pageImageRegistry.update(sender.tab.id, message.imageId, {
      operationId: message.operationId,
      sourceRevision: message.sourceRevision,
      status: "preprocessing",
      pageOrder: Number(message.pageOrder),
      viewportDistance: Number(message.viewportDistance),
      preprocessingStartedAt: performance.now(),
    });
    sendResponse({ recorded: true });
    return false;
  }

  if (message.type === "PREPROCESSING_DEFERRED") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ recorded: false, reason: "Missing operation identity." });
      return false;
    }
    pageImageRegistry.update(sender.tab.id, message.imageId, {
      operationId: message.operationId,
      sourceRevision: message.sourceRevision,
      status: "seen",
      reason: message.reason || "cancelled-outside-prefetch",
      pageOrder: Number(message.pageOrder),
      viewportDistance: Number(message.viewportDistance),
    });
    sendResponse({ recorded: true });
    return false;
  }

  if (message.type === "PREPROCESSING_FAILED") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ recorded: false, reason: "Missing operation identity." });
      return false;
    }
    const status = ["error", "timeout", "cancelled"].includes(message.reason === "cancelled" ? "cancelled" : message.status)
      ? (message.reason === "cancelled" ? "cancelled" : message.status)
      : (String(message.reason || "").includes("timeout") ? "timeout" : "error");
    pageImageRegistry.update(sender.tab.id, message.imageId, {
      operationId: message.operationId,
      sourceRevision: message.sourceRevision,
      status,
      error: message.reason || "Preprocessing failed.",
      failedAt: performance.now(),
    });
    sendResponse({ recorded: true });
    return false;
  }

  if (message.type === "READ_IMAGE_FOR_SLICING") {
    const imageUrl = String(message.imageUrl || "");
    let parsedUrl;
    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      sendResponse({ ok: false, reason: "read-invalid-url", message: "Invalid image URL." });
      return false;
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      sendResponse({ ok: false, reason: "read-invalid-url", message: "Only http and https image URLs are supported." });
      return false;
    }
    if (!Number.isInteger(sender.tab?.id)) {
      sendResponse({ ok: false, reason: "read-fetch-error", message: "Missing sender tab." });
      return false;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_MANGA_UPSCALER_CONFIG.images.browserReadTimeoutMs);
    upscaleProvider.readBrowserImage(parsedUrl.href, sender.tab.url || "", controller.signal).then(
      (imageData) => sendResponse({ ok: true, imageData }),
      (error) => sendResponse({
        ok: false,
        reason: upscaleProvider.readImageFailureReason(error),
        message: error?.message || "Unable to read image for slicing.",
      }),
    ).finally(() => clearTimeout(timeout));
    return true;
  }

  if (message.type === "PREPROCESSING_FALLBACK") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ recorded: false, reason: "Missing operation identity." });
      return false;
    }
    pageImageRegistry.update(sender.tab.id, message.imageId, {
      operationId: message.operationId,
      sourceRevision: message.sourceRevision,
      status: "preprocessing",
      phase: "fallback",
      fallbackReason: message.reason,
      pageOrder: Number(message.pageOrder),
    });
    sendResponse({ recorded: true });
    return false;
  }

  if (message.type === "IMAGE_SEEN") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ recorded: false, reason: "Missing operation identity." });
      return false;
    }
    const tabId = sender.tab.id;
    const generation = scheduler.tabGenerations.get(tabId) || 0;
    chrome.storage.local.get({ enabled: true }).then((settings) => {
      if (generation !== (scheduler.tabGenerations.get(tabId) || 0)) {
        sendResponse({ recorded: false, stale: true, reason: "Stale tab generation." });
        return;
      }
      if (!settings.enabled) {
        sendResponse({ recorded: false, disabled: true });
        return;
      }
      lastContentTabId = tabId;
      Promise.all([
        statisticsTracker.recordSeen(tabId),
        pageImageRegistry.seen(tabId, {
          imageId: message.imageId,
          operationId: message.operationId,
          sourceRevision: message.sourceRevision,
          imageUrl: message.imageUrl,
          pageUrl: sender.tab.url,
          width: message.width,
          height: message.height,
          traceId: message.traceId,
          pageOrder: Number(message.pageOrder),
        }),
      ]).then(() => sendResponse({ recorded: true }));
    });
    return true;
  }

  if (message.type === "ENQUEUE_IMAGE") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ accepted: false, reason: "Missing operation identity." });
      return false;
    }

    const tabId = sender.tab.id;
    const generation = scheduler.tabGenerations.get(tabId) || 0;
    chrome.storage.local.get(DEFAULT_STATE).then((settings) => {
      if (generation !== (scheduler.tabGenerations.get(tabId) || 0)) {
        emitTrace({ event: "background.job.rejected", traceId: message.traceId, status: "rejected", metadata: { reason: "stale_generation" } });
        sendResponse({ accepted: false, stale: true, reason: "Stale tab generation." });
        return;
      }
      if (!settings.enabled) {
        emitTrace({ event: "background.job.rejected", traceId: message.traceId, status: "rejected", metadata: { reason: "disabled" } });
        sendResponse({ accepted: false, reason: "Extension disabled." });
        return;
      }
      lastContentTabId = tabId;
      const outputLimits = resolveOutputLimits(settings, {
        ...(message.displayMetrics || {}),
        cacheVariant: message.cacheVariant || "full",
      });
      const accepted = scheduler.enqueue({
        tabId,
        generation,
        imageId: message.imageId,
        operationId: message.operationId,
        sourceRevision: message.sourceRevision,
        traceId: message.traceId,
        sourceFingerprint: message.sourceFingerprint || null,
        parentSourceFingerprint: message.parentSourceFingerprint || null,
        imageUrl: message.imageUrl,
        pageUrl: sender.tab.url,
        imageData: message.imageData || null,
        cacheVariant: message.cacheVariant || "full",
        pageOrder: Number(message.pageOrder),
        viewportDistance: message.viewportDistance,
        mode: settings.mode || AI_MANGA_UPSCALER_CONFIG.enhancement.defaultMode,
        enhanceLevel: Number(settings.enhanceLevel ?? AI_MANGA_UPSCALER_CONFIG.enhancement.defaultLevel),
        maxProcessingSeconds: Number(settings.maxProcessingSeconds ?? AI_MANGA_UPSCALER_CONFIG.backend.defaultProcessingTimeoutSeconds),
        maxOutputWidth: outputLimits.width,
        maxOutputHeight: outputLimits.height,
        outputQuality: Number(settings.outputQuality),
        textProcessing: {
          enabled: Boolean(settings.textCleanupEnabled || settings.textTranslateEnabled),
          cleanup: Boolean(settings.textCleanupEnabled || settings.textTranslateEnabled),
          translate: Boolean(settings.textTranslateEnabled),
          sourceLanguage: settings.textSourceLanguage || AI_MANGA_UPSCALER_CONFIG.text.sourceLanguage,
          targetLanguage: settings.textTargetLanguage || AI_MANGA_UPSCALER_CONFIG.text.targetLanguage,
          renderText: true,
        },
        tileSize: settings.performanceBoost && Math.max(
          Number(message.displayMetrics?.sourceWidth) || 0,
          Number(message.displayMetrics?.sourceHeight) || 0,
        ) >= 384 ? 512 : 256,
      });
      if (!accepted) {
        emitTrace({ event: "background.job.rejected", traceId: message.traceId, status: "rejected", metadata: { reason: "scheduler_rejected" } });
      }
      sendResponse({ accepted });
    });
    return true;
  }

  if (message.type === "UPDATE_PRIORITY") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ updated: false, reason: "Missing operation identity." });
      return false;
    }
    const updated = scheduler.updatePriority(
      sender.tab.id,
      message.imageId,
      message.viewportDistance,
      message.operationId,
    );
    sendResponse({ updated });
    return false;
  }

  if (message.type === "CANCEL_IMAGE") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ canceled: false, reason: "Missing operation identity." });
      return false;
    }
    const canceled = scheduler.cancel(sender.tab.id, message.imageId, message.operationId);
    pageImageRegistry.removeImage(sender.tab.id, message.imageId, message.operationId);
    sendResponse({ canceled });
    return false;
  }

  if (message.type === "REMOVE_IMAGE") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ removed: false, reason: "Missing operation identity." });
      return false;
    }
    pageImageRegistry.removeImage(sender.tab.id, message.imageId, message.operationId);
    const removed = scheduler.cancel(sender.tab.id, message.imageId, message.operationId);
    sendResponse({ removed });
    return false;
  }

  if (message.type === "GET_STATS") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      const requestedTabId = Number.isInteger(message.tabId) ? message.tabId : null;
      const activeTabId = requestedTabId ?? (tab?.url?.startsWith(chrome.runtime.getURL("")) ? lastContentTabId : tab?.id);
      statisticsTracker.snapshot(scheduler.snapshot(), activeTabId).then(sendResponse);
    });
    return true;
  }

  if (message.type === "GET_PAGE_IMAGES") {
    const tabId = Number.isInteger(message.tabId) ? message.tabId : lastContentTabId;
    sendResponse({ tabId, images: Number.isInteger(tabId) ? pageImageRegistry.list(tabId) : [] });
    return false;
  }

  if (message.type === "SET_ENABLED") {
    chrome.storage.local.set({ enabled: Boolean(message.enabled) }).then(() => {
      if (message.enabled) {
        scheduler.setPaused(false);
        maintainRuntime().then(() => ensureBackendStarted()).then((launch) => {
          notifyContentEnabled(true);
          sendResponse({ enabled: true, launch });
        });
      } else {
        scheduler.setPaused(true);
        notifyContentEnabled(false);
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
      minInputWidth: clamp(message.minInputWidth, 1, 16383, AI_MANGA_UPSCALER_CONFIG.images.minWidthPx),
      minInputHeight: clamp(message.minInputHeight, 1, 16383, AI_MANGA_UPSCALER_CONFIG.images.minHeightPx),
      maxInputWidth: clamp(message.maxInputWidth, 1, 32768, 8000),
      maxInputHeight: clamp(message.maxInputHeight, 1, 32768, 12000),
      maxOutputWidth: clamp(message.maxOutputWidth, 256, 16383, 2048),
      maxOutputHeight: clamp(message.maxOutputHeight, 256, 16383, 8192),
      minInputWidthEnabled: message.minInputWidthEnabled !== false,
      minInputHeightEnabled: message.minInputHeightEnabled !== false,
      maxInputWidthEnabled: message.maxInputWidthEnabled !== false,
      maxInputHeightEnabled: message.maxInputHeightEnabled !== false,
      maxOutputWidthEnabled: message.maxOutputWidthEnabled !== false,
      maxOutputHeightEnabled: message.maxOutputHeightEnabled !== false,
      imageSlicingEnabled: message.imageSlicingEnabled !== false,
      imageSliceMaxHeight: clamp(message.imageSliceMaxHeight, 512, 8192, AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx),
      outputQuality: clamp(message.outputQuality, 50, 100, 90),
      sizingMode: ["pixel", "auto", "screen"].includes(message.sizingMode) ? message.sizingMode : "auto",
      resolutionPreset: ["hd", "fhd", "2k", "4k"].includes(message.resolutionPreset) ? message.resolutionPreset : "fhd",
      screenOrientation: ["auto", "landscape", "portrait"].includes(message.screenOrientation) ? message.screenOrientation : "auto",
      performanceBoost: Boolean(message.performanceBoost),
      preprocessingConcurrency: clamp(message.preprocessingConcurrency, 1, 12, AI_MANGA_UPSCALER_CONFIG.queue.preprocessingConcurrency),
      upscaleConcurrency: clamp(message.upscaleConcurrency, 1, 2, AI_MANGA_UPSCALER_CONFIG.queue.maxConcurrentRequests),
      textCleanupEnabled: Boolean(message.textCleanupEnabled),
      textTranslateEnabled: Boolean(message.textTranslateEnabled),
      textSourceLanguage: String(message.textSourceLanguage || AI_MANGA_UPSCALER_CONFIG.text.sourceLanguage).slice(0, 16),
      textTargetLanguage: String(message.textTargetLanguage || AI_MANGA_UPSCALER_CONFIG.text.targetLanguage).slice(0, 16),
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
  scheduler.setPaused(!settings.enabled);
  if (settings.enabled) maintainRuntime();
});
