importScripts("./config.js", "./processing-monitor.js");

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
  imageSliceMaxWidth: AI_MANGA_UPSCALER_CONFIG.images.sliceMaxWidthPx,
  imageSliceMaxHeight: AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx,
  aheadProcessingEnabled: AI_MANGA_UPSCALER_CONFIG.images.aheadProcessingEnabled,
  aheadProcessingImageLimit: AI_MANGA_UPSCALER_CONFIG.images.aheadProcessingImageLimit,
  prefetchMarginPx: AI_MANGA_UPSCALER_CONFIG.images.prefetchMarginPx,
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
  lastModel: null,
  lastProvider: null,
  blacklistRules: [],
});

const STORAGE_SCHEMA_VERSION = 3;
const STORAGE_BOOLEAN_KEYS = new Set([
  "enabled", "minInputWidthEnabled", "minInputHeightEnabled", "maxInputWidthEnabled",
  "maxInputHeightEnabled", "maxOutputWidthEnabled", "maxOutputHeightEnabled",
  "imageSlicingEnabled", "aheadProcessingEnabled", "performanceBoost", "textCleanupEnabled", "textTranslateEnabled",
]);
const STORAGE_NUMERIC_BOUNDS = {
  enhanceLevel: [0, 1],
  maxProcessingSeconds: [5, 300],
  minInputWidth: [1, 16383],
  minInputHeight: [1, 16383],
  maxInputWidth: [1, 32768],
  maxInputHeight: [1, 32768],
  maxOutputWidth: [256, 16383],
  maxOutputHeight: [256, 16383],
  imageSliceMaxWidth: [512, 8192],
  imageSliceMaxHeight: [512, 8192],
  aheadProcessingImageLimit: [1, 50],
  prefetchMarginPx: [0, 12000],
  outputQuality: [50, 100],
  preprocessingConcurrency: [1, 12],
  upscaleConcurrency: [1, 2],
};
const STORAGE_STRING_LIMITS = {
  textSourceLanguage: 16,
  textTargetLanguage: 16,
};

function migratePersistedSettings(rawState = {}) {
  const source = rawState && typeof rawState === "object" && !Array.isArray(rawState) ? rawState : {};
  const migrated = { ...DEFAULT_STATE, storageSchemaVersion: STORAGE_SCHEMA_VERSION };
  for (const key of Object.keys(DEFAULT_STATE)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (STORAGE_BOOLEAN_KEYS.has(key)) {
      if (typeof value === "boolean") migrated[key] = value;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(STORAGE_NUMERIC_BOUNDS, key)) {
      const [minimum, maximum] = STORAGE_NUMERIC_BOUNDS[key];
      const number = Number(value);
      if (Number.isFinite(number)) migrated[key] = Math.min(Math.max(number, minimum), maximum);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(STORAGE_STRING_LIMITS, key)) {
      if (typeof value === "string" && value.length <= STORAGE_STRING_LIMITS[key]) migrated[key] = value;
      continue;
    }
    if (key === "mode") {
      if (AI_MANGA_UPSCALER_CONFIG.enhancement.modes.includes(value)) migrated[key] = value;
      continue;
    }
    if (key === "sizingMode" && ["pixel", "auto", "screen"].includes(value)) migrated[key] = value;
    else if (key === "resolutionPreset" && ["hd", "fhd", "2k", "4k"].includes(value)) migrated[key] = value;
    else if (key === "screenOrientation" && ["auto", "landscape", "portrait"].includes(value)) migrated[key] = value;
    else if (key === "blacklistRules" && Array.isArray(value)) migrated[key] = value.filter((item) => typeof item === "string").slice(0, 100);
    else if (key === "lastQuality" || key === "lastDetectedMode" || key === "lastComparison") {
      if (value === null || typeof value === "string" || typeof value === "object") migrated[key] = value;
    } else if (typeof value === typeof DEFAULT_STATE[key]) {
      migrated[key] = value;
    }
  }
  migrated.maxInputWidth = Math.max(migrated.maxInputWidth, migrated.minInputWidth);
  migrated.maxInputHeight = Math.max(migrated.maxInputHeight, migrated.minInputHeight);
  return migrated;
}

async function loadMigratedSettings(storage = chrome.storage.local) {
  const raw = await storage.get(null);
  const migrated = migratePersistedSettings(raw);
  const comparable = { ...migrated };
  const current = raw && typeof raw === "object" ? raw : {};
  const changed = current.storageSchemaVersion !== STORAGE_SCHEMA_VERSION
    || JSON.stringify(Object.fromEntries(Object.keys(comparable).map((key) => [key, current[key]]))) !== JSON.stringify(comparable);
  if (changed) await storage.set(migrated);
  return migrated;
}

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

function sanitizeTraceValue(key, value, depth = 0) {
  const lower = String(key).toLowerCase();
  if (lower.includes("imagedata") || lower.includes("base64") || lower.includes("authorization")) return undefined;
  if (typeof value === "string") return value.length > 256 ? `${value.slice(0, 253)}...` : value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (depth >= 2) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeTraceValue(key, item, depth + 1)).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") return sanitizeTraceMetadata(value, depth + 1);
  return undefined;
}

function sanitizeTraceMetadata(metadata = {}, depth = 0) {
  const sanitized = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    const safeValue = sanitizeTraceValue(key, value, depth);
    if (safeValue !== undefined) sanitized[key] = safeValue;
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

const UPSCALE_REQUEST_SCHEMA_VERSION = 1;
const UPSCALE_MODES = new Set(["auto", "manga", "artwork", "photo"]);
const UPSCALE_TILE_SIZES = new Set([256, 512, 1024]);

class RequestNormalizationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = "RequestNormalizationError";
    this.errorCode = "REQUEST_NORMALIZATION_FAILED";
    this.validationFields = [{ field, type: "invalid_value", message }];
    this.sanitizedMessage = message;
    this.retryable = false;
  }
}

function normalizeFiniteNumber(field, value, { fallback = null, minimum = null, maximum = null, integer = false } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RequestNormalizationError(field, `${field} must be a finite number.`);
  let normalized = integer ? Math.round(number) : number;
  if (minimum !== null) normalized = Math.max(minimum, normalized);
  if (maximum !== null) normalized = Math.min(maximum, normalized);
  return normalized;
}

function normalizeBoundedString(field, value, maximumLength, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new RequestNormalizationError(field, `${field} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new RequestNormalizationError(field, `${field} must be a string.`);
  if (value.length > maximumLength) {
    throw new RequestNormalizationError(field, `${field} must be at most ${maximumLength} characters.`);
  }
  return value;
}

function normalizeTextProcessing(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new RequestNormalizationError("textProcessing", "textProcessing must be an object.");
  }
  const booleanField = (name, fallback) => {
    if (value[name] === undefined) return fallback;
    if (typeof value[name] !== "boolean") {
      throw new RequestNormalizationError(`textProcessing.${name}`, `textProcessing.${name} must be a boolean.`);
    }
    return value[name];
  };
  const languageField = (name, fallback) => {
    if (value[name] === undefined || value[name] === null || value[name] === "") return fallback;
    if (typeof value[name] !== "string" || value[name].length > 16) {
      throw new RequestNormalizationError(`textProcessing.${name}`, `textProcessing.${name} must be a short language code.`);
    }
    return value[name];
  };
  return {
    enabled: booleanField("enabled", false),
    cleanup: booleanField("cleanup", true),
    translate: booleanField("translate", false),
    sourceLanguage: languageField("sourceLanguage", "auto"),
    targetLanguage: languageField("targetLanguage", "vi"),
    renderText: booleanField("renderText", true),
  };
}

function normalizeUpscaleRequest(input = {}, persistedState = {}) {
  const source = { ...persistedState, ...input };
  const imageData = source.imageData === undefined || source.imageData === null || source.imageData === ""
    ? null
    : normalizeBoundedString("imageData", source.imageData, 64 * 1024 * 1024);
  const imageUrl = normalizeBoundedString("imageUrl", source.imageUrl, 16384, { required: true });
  let parsedUrl;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    throw new RequestNormalizationError("imageUrl", "imageUrl must be an absolute URL.");
  }
  const browserOwnedProtocols = new Set(["blob:", "data:"]);
  if (!["http:", "https:"].includes(parsedUrl.protocol) && !(imageData && browserOwnedProtocols.has(parsedUrl.protocol))) {
    throw new RequestNormalizationError("imageUrl", "imageUrl must use HTTP/HTTPS unless browser-owned imageData is present.");
  }
  const mode = source.mode || AI_MANGA_UPSCALER_CONFIG.enhancement.defaultMode;
  if (!UPSCALE_MODES.has(mode)) {
    throw new RequestNormalizationError("mode", `Unsupported enhancement mode: ${String(mode).slice(0, 32)}.`);
  }
  const tileSize = normalizeFiniteNumber("tileSize", source.tileSize, { fallback: 256, integer: true });
  if (!UPSCALE_TILE_SIZES.has(tileSize)) {
    throw new RequestNormalizationError("tileSize", "tileSize must be one of 256, 512, or 1024.");
  }
  const request = {
    schemaVersion: UPSCALE_REQUEST_SCHEMA_VERSION,
    imageUrl,
    mode,
    enhanceLevel: normalizeFiniteNumber("enhanceLevel", source.enhanceLevel, {
      fallback: AI_MANGA_UPSCALER_CONFIG.enhancement.defaultLevel,
      minimum: 0,
      maximum: 1,
    }),
    imageData,
    jobId: normalizeBoundedString("jobId", source.jobId, 200),
    maxOutputWidth: normalizeFiniteNumber("maxOutputWidth", source.maxOutputWidth, {
      fallback: null, minimum: 256, maximum: 16383, integer: true,
    }),
    maxOutputHeight: normalizeFiniteNumber("maxOutputHeight", source.maxOutputHeight, {
      fallback: null, minimum: 256, maximum: 16383, integer: true,
    }),
    outputQuality: normalizeFiniteNumber("outputQuality", source.outputQuality, {
      fallback: AI_MANGA_UPSCALER_CONFIG.images.outputQuality, minimum: 50, maximum: 100, integer: true,
    }),
    tileSize,
    textProcessing: normalizeTextProcessing(source.textProcessing),
    traceId: normalizeBoundedString("traceId", source.traceId, 200),
    operationId: normalizeBoundedString("operationId", source.operationId, 200),
    queueKey: normalizeBoundedString("queueKey", source.queueKey || source.jobId, 300),
    attempt: normalizeFiniteNumber("attempt", source.attempt, { fallback: 1, minimum: 1, maximum: 100, integer: true }),
    sourceFingerprint: normalizeBoundedString("sourceFingerprint", source.sourceFingerprint, 200),
  };
  if (source.model !== undefined && source.model !== null) {
    request.model = normalizeBoundedString("model", source.model, 100);
  }
  return request;
}

function sanitizeUpscaleRequestMetadata(request) {
  let parsedUrl = null;
  try { parsedUrl = new URL(request.imageUrl); } catch { parsedUrl = null; }
  const imageDataLength = typeof request.imageData === "string" ? request.imageData.length : 0;
  const textProcessing = request.textProcessing && typeof request.textProcessing === "object"
    ? Object.entries(request.textProcessing).map(([key, value]) => `${key}:${typeof value}`).join(",")
    : null;
  return {
    job_id_length: request.jobId?.length || 0,
    operation_id_length: request.operationId?.length || 0,
    image_url_protocol: parsedUrl?.protocol || null,
    image_url_hostname: parsedUrl?.hostname || null,
    image_url_length: request.imageUrl?.length || 0,
    image_url_has_query: Boolean(parsedUrl?.search),
    image_url_has_fragment: Boolean(parsedUrl?.hash),
    image_data_present: imageDataLength > 0,
    image_data_encoded_length: imageDataLength,
    image_data_decoded_length: imageDataLength ? Math.max(0, Math.floor((imageDataLength * 3) / 4) - ((request.imageData.match(/=*$/)?.[0].length) || 0)) : 0,
    mode: request.mode,
    enhance_level: request.enhanceLevel,
    max_output_width: request.maxOutputWidth,
    max_output_height: request.maxOutputHeight,
    output_quality: request.outputQuality,
    tile_size: request.tileSize,
    text_processing_types: textProcessing,
    request_schema_version: request.schemaVersion,
    extension_version: chrome.runtime?.getManifest?.().version || null,
  };
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

  async recordSuccess({ tabId, latencyMs, cacheHit, quality = null, detectedMode = null, comparison = null, model = null, provider = null }) {
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
      lastModel: model || current.lastModel || null,
      lastProvider: provider || current.lastProvider || null,
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
      imageSliceMaxWidth: Number(current.imageSliceMaxWidth ?? AI_MANGA_UPSCALER_CONFIG.images.sliceMaxWidthPx),
      imageSliceMaxHeight: Number(current.imageSliceMaxHeight ?? AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx),
      aheadProcessingEnabled: current.aheadProcessingEnabled !== false,
      aheadProcessingImageLimit: Number(current.aheadProcessingImageLimit ?? AI_MANGA_UPSCALER_CONFIG.images.aheadProcessingImageLimit),
      prefetchMarginPx: Number(current.prefetchMarginPx ?? AI_MANGA_UPSCALER_CONFIG.images.prefetchMarginPx),
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
      lastModel: current.lastModel || null,
      lastProvider: current.lastProvider || null,
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

class BackendRequestError extends Error {
  constructor({ status, errorCode, traceId, validationFields, sanitizedMessage, retryable }) {
    super(sanitizedMessage);
    this.name = "BackendRequestError";
    this.status = status;
    this.errorCode = errorCode;
    this.traceId = traceId;
    this.validationFields = validationFields;
    this.sanitizedMessage = sanitizedMessage;
    this.retryable = retryable;
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
    this.reservedHeaderRuleIds = new Set();
    this.activeHeaderRuleIds = new Set();
    this.headerRuleInitialization = null;
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
      const normalizedRequest = normalizeUpscaleRequest({
        ...options,
        imageUrl,
        imageData,
      }, {});
      const requestStarted = performance.now();
      emitTrace({
        event: "background.backend.request.started",
        traceId: options.traceId,
        status: "running",
        attempt: options.attempt,
        metadata: {
          queue_key_prefix: safeTracePrefix(options.jobId),
          source_fingerprint_prefix: safeTracePrefix(options.sourceFingerprint),
          request_metadata: sanitizeUpscaleRequestMetadata(normalizedRequest),
        },
      });
      const response = await fetch(`${this.baseUrl}/upscale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedRequest),
        signal,
      });
      if (!response.ok) {
        const backendError = await this.readBackendError(response, signal);
        emitTrace({
          event: "background.backend.request.failed",
          traceId: backendError.traceId || options.traceId,
          status: "failed",
          attempt: options.attempt,
          metadata: {
            http_status: response.status,
            error_code: backendError.errorCode,
            duration_ms: Math.max(0, performance.now() - requestStarted),
          },
        });
        throw backendError;
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
        model: metadata.model || null,
        provider: metadata.provider || null,
        outputWidth: metadata.outputWidth || null,
        outputHeight: metadata.outputHeight || null,
        timings: metadata.timings || null,
        queue: metadata.queue || null,
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

  async readBackendError(response, signal) {
    let payload = null;
    try {
      const text = await Promise.race([response.text(), this.rejectOnAbort(signal)]);
      if (text && text.length <= 65536) payload = JSON.parse(text);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
    }
    const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const legacyDetail = root.detail && typeof root.detail === "object" && !Array.isArray(root.detail)
      ? root.detail
      : {};
    const rawFields = Array.isArray(root.detail)
      ? root.detail
      : (Array.isArray(legacyDetail.detail) ? legacyDetail.detail : []);
    const validationFields = rawFields.map((field) => ({
      field: this.sanitizeBackendText(field?.field, "body", 200),
      type: this.sanitizeBackendText(field?.type, "validation_error", 100),
      message: this.sanitizeBackendText(field?.message, "Request validation failed", 300),
    }));
    const status = Number(response.status) || 0;
    const errorCode = this.sanitizeBackendText(
      root.errorCode || legacyDetail.errorCode,
      status === 422 ? "REQUEST_VALIDATION_FAILED" : "BACKEND_REQUEST_FAILED",
      100,
    );
    const traceId = this.sanitizeBackendText(root.traceId || legacyDetail.traceId, "", 200) || null;
    const fallbackMessage = status === 422 ? "Request validation failed" : `Backend returned ${status}`;
    const sanitizedMessage = this.sanitizeBackendText(root.message || legacyDetail.message, fallbackMessage, 300);
    return new BackendRequestError({
      status,
      errorCode,
      traceId,
      validationFields,
      sanitizedMessage,
      retryable: [502, 503, 504].includes(status),
    });
  }

  sanitizeBackendText(value, fallback, maximumLength) {
    let text = typeof value === "string" && value.trim() ? value : fallback;
    text = text.replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]");
    text = text.replace(/(imageData\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted-data]");
    text = text.replace(/\b[A-Za-z0-9+/]{64,}={0,2}\b/g, "[redacted-data]");
    return text.replace(/\s+/g, " ").trim().slice(0, maximumLength);
  }

  async readBrowserImage(imageUrl, pageUrl, signal) {
    const normalizedImageUrl = this.normalizeBrowserReadUrl(imageUrl);
    const previousRead = this.imageReadLocks.get(normalizedImageUrl) || Promise.resolve();
    let releaseRead;
    const currentRead = new Promise((resolve) => { releaseRead = resolve; });
    const readTail = previousRead.catch(() => {}).then(() => currentRead);
    this.imageReadLocks.set(normalizedImageUrl, readTail);

    try {
      const waitForPrevious = previousRead.catch(() => {});
      if (signal) await Promise.race([waitForPrevious, this.rejectOnAbort(signal)]);
      else await waitForPrevious;
      return await this.readBrowserImageWithRule(normalizedImageUrl, pageUrl, signal);
    } finally {
      releaseRead();
      readTail.finally(() => {
        if (this.imageReadLocks.get(normalizedImageUrl) === readTail) this.imageReadLocks.delete(normalizedImageUrl);
      });
    }
  }

  async readBrowserImageWithRule(imageUrl, pageUrl, signal) {
    await this.headerRuleCleanup;
    const normalizedPageUrl = this.normalizeBrowserReadUrl(pageUrl);
    const shouldInstallRule = normalizedPageUrl && this.isHttpUrl(imageUrl);
    const installedRuleIds = [];
    const matchedRuleUrls = new Set();
    const readController = new AbortController();
    const timeout = setTimeout(() => readController.abort(), AI_MANGA_UPSCALER_CONFIG.images.browserReadTimeoutMs);
    const readSignal = this.combineSignals(signal, readController.signal);
    const abortRead = this.rejectOnAbort(readSignal);
    try {
      if (shouldInstallRule) {
        await this.installHeaderRule(imageUrl, normalizedPageUrl, installedRuleIds, matchedRuleUrls);
      }
      let response;
      for (let redirectAttempt = 0; redirectAttempt < 5; redirectAttempt += 1) {
        response = await Promise.race([
          fetch(imageUrl, {
            method: "GET",
            cache: "force-cache",
            credentials: "include",
            signal: readSignal,
          }),
          abortRead,
        ]);
        const responseUrl = this.normalizeBrowserReadUrl(response.url || imageUrl);
        if (!shouldInstallRule || !this.isHttpUrl(responseUrl) || matchedRuleUrls.has(responseUrl)) break;
        await this.installHeaderRule(responseUrl, normalizedPageUrl, installedRuleIds, matchedRuleUrls);
      }
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
      if (installedRuleIds.length) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: installedRuleIds }).catch(() => {});
        for (const ruleId of installedRuleIds) this.activeHeaderRuleIds.delete(ruleId);
      }
    }
  }

  async installHeaderRule(imageUrl, pageUrl, installedRuleIds, matchedRuleUrls) {
    const ruleId = this.allocateHeaderRuleId();
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
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
      installedRuleIds.push(ruleId);
      matchedRuleUrls.add(imageUrl);
    } catch (error) {
      this.activeHeaderRuleIds.delete(ruleId);
      throw error;
    }
  }

  cleanupStaleHeaderRules() {
    if (this.headerRuleInitialization) return this.headerRuleInitialization;
    this.headerRuleInitialization = this.initializeHeaderRules();
    return this.headerRuleInitialization;
  }

  async initializeHeaderRules() {
    try {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      this.reservedHeaderRuleIds = new Set(
        rules.filter((rule) => Number.isInteger(rule.id)).map((rule) => rule.id),
      );
      const removeRuleIds = rules
        .filter((rule) => this.isOwnedHeaderRule(rule))
        .map((rule) => rule.id);
      if (removeRuleIds.length) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
        for (const ruleId of removeRuleIds) this.reservedHeaderRuleIds.delete(ruleId);
      }
    } catch {
      // A read still performs its own exact-rule cleanup when session-rule inspection is unavailable.
    }
  }

  isOwnedHeaderRule(rule) {
    const requestHeaders = rule.action?.requestHeaders;
    const resourceTypes = rule.condition?.resourceTypes;
    return (
      Number.isInteger(rule.id) && rule.id >= 1000 && rule.id < 200000 &&
      rule.priority === 1 && rule.action?.type === "modifyHeaders" &&
      Array.isArray(requestHeaders) && requestHeaders.length === 1 &&
      String(requestHeaders[0]?.header).toLowerCase() === "referer" &&
      requestHeaders[0]?.operation === "set" && typeof requestHeaders[0]?.value === "string" &&
      typeof rule.condition?.regexFilter === "string" && rule.condition.regexFilter.startsWith("^") &&
      rule.condition.regexFilter.endsWith("$") && !rule.condition?.urlFilter &&
      Array.isArray(resourceTypes) && resourceTypes.length === 2 &&
      resourceTypes.includes("xmlhttprequest") && resourceTypes.includes("other")
    );
  }

  allocateHeaderRuleId() {
    for (let attempts = 0; attempts < 199000; attempts += 1) {
      if (this.nextHeaderRuleId >= 200000) this.nextHeaderRuleId = 1000;
      if (!this.reservedHeaderRuleIds.has(this.nextHeaderRuleId) && !this.activeHeaderRuleIds.has(this.nextHeaderRuleId)) {
        const ruleId = this.nextHeaderRuleId++;
        this.activeHeaderRuleIds.add(ruleId);
        return ruleId;
      }
      this.nextHeaderRuleId += 1;
    }
    throw new Error("No temporary Referer rule ID is available");
  }

  normalizeBrowserReadUrl(value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return value;
      const fragmentIndex = value.indexOf("#");
      return fragmentIndex >= 0 ? value.slice(0, fragmentIndex) : value;
    } catch {
      return value;
    }
  }

  isHttpUrl(value) {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
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
  constructor({ maxConcurrentRequests, cacheProvider, upscaleProvider, statisticsTracker, monitorJobEvent = null }) {
    this.maxConcurrentRequests = maxConcurrentRequests;
    this.cacheProvider = cacheProvider;
    this.upscaleProvider = upscaleProvider;
    this.statisticsTracker = statisticsTracker;
    this.monitorJobEvent = typeof monitorJobEvent === "function" ? monitorJobEvent : () => Promise.resolve({ accepted: false });
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
      traceId: existing?.traceId ?? job.traceId,
      attempt: existing?.attempt ?? job.attempt ?? 1,
      queuedAt: existing?.queuedAt ?? performance.now(),
      pageOrder: Number.isFinite(job.pageOrder) ? job.pageOrder : existing?.pageOrder ?? Number.MAX_SAFE_INTEGER,
      viewportDistance: Number.isFinite(job.viewportDistance) ? job.viewportDistance : Number.MAX_SAFE_INTEGER,
    });
    if (!job.deferred) this.preemptDeferredActiveJobs();
    pageImageRegistry.update(job.tabId, job.imageId, { operationId: job.operationId, status: "waiting", pageOrder: job.pageOrder });
    this.monitorJobEvent(job, "QUEUED", {
      queuePosition: this.pending.size,
      cache: "UNKNOWN",
    });
    emitTrace({
      event: existing ? "background.job.reprioritized" : "background.job.enqueued",
      traceId: existing?.traceId ?? job.traceId,
      status: "queued",
      attempt: existing?.attempt ?? job.attempt ?? 1,
      metadata: {
        queue_key_prefix: safeTracePrefix(job.queueKey),
        operation_id_prefix: safeTracePrefix(job.operationId, 48),
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
    this.monitorJobEvent(job, "CANCELLED", {
      metadata: { reason, previewValid: false },
      error: {
        errorCode: "JOB_CANCELLED",
        category: "CANCELLATION",
        message: "The image operation was cancelled.",
        retryable: reason === "explicit",
      },
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
        this.monitorJobEvent(job, "DEFERRED", {
          metadata: { reason: "foreground_job" },
        });
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
        this.monitorJobEvent(job, "RECEIVING_RESULT", {
          cache: "HIT",
          model: cached.model || null,
          provider: cached.provider || null,
          output: {
            byteLength: Number(cached.buffer?.byteLength) || null,
            mime: cached.contentType || null,
          },
        });
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
        if (!this.isCurrentJob(job)) return;
        this.sendComplete(job, cached, true);
        emitTrace({
          event: "background.job.result_received",
          traceId: job.traceId,
          status: "received",
          attempt: job.attempt,
          metadata: { cache_hit: true, duration_ms: Math.max(0, performance.now() - startedAt) },
        });
        pageImageRegistry.update(job.tabId, job.imageId, {
          operationId: job.operationId,
          status: "rendering",
          cacheHit: true,
          originalImageUrl: cached.originalImageUrl || job.imageUrl,
          enhancedImageUrl: cached.enhancedImageUrl,
          quality: cached.quality,
          completionStats: {
            latencyMs: performance.now() - startedAt,
            cacheHit: true,
            quality: cached.quality,
            detectedMode: cached.detectedMode,
            model: cached.model || null,
            provider: cached.provider || null,
          },
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

      this.monitorJobEvent(job, "SENDING_TO_BACKEND", { cache: "MISS" });

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
      this.monitorJobEvent(job, "RECEIVING_RESULT", {
        cache: result.cacheHit ? "HIT" : "MISS",
        model: result.model || null,
        provider: result.provider || null,
        output: {
          width: result.outputWidth || null,
          height: result.outputHeight || null,
          byteLength: Number(result.buffer?.byteLength) || null,
          mime: result.contentType || null,
        },
        metadata: {
          timings: result.timings || null,
          backendQueue: result.queue || null,
          cacheKeyPrefix: safeTracePrefix(result.cacheKey),
        },
      });
      await this.cacheProvider.set(cacheIdentity, result);
      if (!this.isCurrentJob(job)) return;
      if (!this.isCurrentJob(job)) return;
      this.sendComplete(job, result, false);
      emitTrace({
        event: "background.job.result_received",
        traceId: job.traceId || result.traceId,
        status: "received",
        attempt: job.attempt,
        metadata: { cache_hit: false, duration_ms: Math.max(0, performance.now() - startedAt) },
      });
      pageImageRegistry.update(job.tabId, job.imageId, {
        operationId: job.operationId,
        status: "rendering",
        cacheHit: false,
        originalImageUrl: result.originalImageUrl || job.imageUrl,
        enhancedImageUrl: result.enhancedImageUrl,
        quality: result.quality,
        completionStats: {
          latencyMs: performance.now() - startedAt,
          cacheHit: false,
          quality: result.quality,
          detectedMode: result.detectedMode,
          model: result.model || null,
          provider: result.provider || null,
        },
      });
    } catch (error) {
      if (!this.isCurrentJob(job)) {
        return;
      }

      if (error?.code === "PROCESSING_TIMEOUT") {
        await this.failJob(job, error, "timeout");
        return;
      }
      const normalizedError = AI_PROCESSING_MONITOR.normalizeError(error, "SENDING_TO_BACKEND");
      if (normalizedError.retryable && job.attempt < AI_MANGA_UPSCALER_CONFIG.retry.maxAttempts) {
        const delay = AI_MANGA_UPSCALER_CONFIG.retry.baseDelayMs * Math.pow(2, job.attempt - 1);
        emitTrace({
          event: "background.job.retrying",
          traceId: job.traceId,
          status: "retrying",
          attempt: job.attempt + 1,
          metadata: { retry_reason: error?.message || "unknown", delay_ms: delay },
        });
        this.monitorJobEvent(job, "DEFERRED", {
          retryCount: job.attempt,
          metadata: { reason: "retryable_error", delayMs: delay },
          error: AI_PROCESSING_MONITOR.normalizeError(error, "SENDING_TO_BACKEND"),
        });
        this.scheduleRetry(job, delay);
        return;
      }

      await this.failJob(job, error, "error");
    }
  }

  async failJob(job, error, status = "error") {
    const message = error?.sanitizedMessage || (error instanceof Error ? error.message : "Unknown upscale error");
    await this.statisticsTracker.recordError(job.tabId);
    if (!this.isCurrentJob(job)) return false;
    pageImageRegistry.update(job.tabId, job.imageId, {
      operationId: job.operationId,
      status,
      error: message,
      errorCode: error?.errorCode || null,
      errorStatus: Number(error?.status) || null,
      errorTraceId: error?.traceId || job.traceId,
      validationFields: Array.isArray(error?.validationFields) ? error.validationFields : [],
      retryable: error?.retryable !== false,
      failedAt: performance.now(),
      errorModel: AI_PROCESSING_MONITOR.normalizeError(error, status === "timeout" ? "TIMED_OUT" : "FAILED"),
    });
    this.monitorJobEvent(job, status === "timeout" ? "TIMED_OUT" : "FAILED", {
      error,
      metadata: { previewValid: false },
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
      errorCode: error?.errorCode || null,
      errorStatus: Number(error?.status) || null,
      errorTraceId: error?.traceId || job.traceId,
      validationFields: Array.isArray(error?.validationFields) ? error.validationFields : [],
      status,
      permanent: status === "timeout" || error?.retryable === false,
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
const processingMonitor = new AI_PROCESSING_MONITOR.ProcessingMonitorStore();
const PROCESSING_MONITOR_SESSION_KEY = "processingMonitorSessionV1";
const PROCESSING_MONITOR_HISTORY_KEY = "processingMonitorHistoryV1";
let processingMonitorWrite = Promise.resolve();
let processingMonitorEventQueue = Promise.resolve();

async function restoreProcessingMonitor() {
  const sessionArea = chrome.storage.session || chrome.storage.local;
  const [sessionState, localState] = await Promise.all([
    sessionArea.get({ [PROCESSING_MONITOR_SESSION_KEY]: null }),
    chrome.storage.local.get({ [PROCESSING_MONITOR_HISTORY_KEY]: null }),
  ]);
  const snapshot = sessionState[PROCESSING_MONITOR_SESSION_KEY] || localState[PROCESSING_MONITOR_HISTORY_KEY];
  if (snapshot) processingMonitor.restore(snapshot);
  const recovered = processingMonitor.recoverInterrupted("worker_restart");
  processingMonitor.prune();
  if (snapshot || recovered.length) await persistProcessingMonitor();
}

function persistProcessingMonitor() {
  const snapshot = processingMonitor.snapshot();
  const sessionArea = chrome.storage.session || chrome.storage.local;
  processingMonitorWrite = processingMonitorWrite.catch(() => {}).then(() => Promise.all([
    sessionArea.set({ [PROCESSING_MONITOR_SESSION_KEY]: snapshot }),
    chrome.storage.local.set({ [PROCESSING_MONITOR_HISTORY_KEY]: snapshot }),
  ]));
  return processingMonitorWrite;
}

function applyProcessingEvent(input) {
    let event;
    try {
      event = AI_PROCESSING_MONITOR.createEvent(input);
    } catch (error) {
      return { accepted: false, reason: error?.message || "invalid_event" };
    }
    let result = processingMonitor.ingest(event);
    if (!result.accepted && result.reason === "missing_detected_event" && event.stage !== "DETECTED") {
      const detected = AI_PROCESSING_MONITOR.createEvent({
        tabId: event.tabId,
        imageId: event.imageId,
        operationId: event.operationId,
        traceId: event.traceId,
        sourceFingerprint: event.sourceFingerprint,
        sourceUrl: input.sourceUrl,
        stage: "DETECTED",
        timestamp: event.timestamp,
        input: event.input,
        metadata: { recoveredFromStage: event.stage },
      });
      processingMonitor.ingest(detected);
      result = processingMonitor.ingest(event);
    }
    if (result.accepted) {
      processingMonitor.prune();
      persistProcessingMonitor();
    }
    return result;
}

function recordProcessingEvents(inputs) {
  const task = processingMonitorEventQueue.then(() => processingMonitorReady).then(() => inputs.map((input) => applyProcessingEvent(input)));
  processingMonitorEventQueue = task.catch(() => {});
  return task;
}

function recordProcessingEvent(input) {
  return recordProcessingEvents([input]).then(([result]) => result);
}

function monitorJobEvent(job, stage, extra = {}) {
  if (!job) return Promise.resolve({ accepted: false, reason: "missing_job" });
  return recordProcessingEvent({
    tabId: job.tabId,
    imageId: job.imageId,
    operationId: job.operationId,
    jobId: job.queueKey || null,
    traceId: job.traceId,
    sourceFingerprint: job.sourceFingerprint,
    parentJobId: job.parentJobId || null,
    sourceUrl: job.imageUrl,
    stage,
    retryCount: Math.max(0, Number(job.attempt || 1) - 1),
    mode: job.mode,
    input: {
      width: Number(job.displayMetrics?.sourceWidth) || null,
      height: Number(job.displayMetrics?.sourceHeight) || null,
      sourceKind: job.imageData ? "browser-bytes" : "remote-fetch",
    },
    ...extra,
  });
}

const processingMonitorReady = restoreProcessingMonitor().catch((error) => {
  console.warn("[AI Enhancer][monitor] restore failed", error?.message || error);
});
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
  monitorJobEvent,
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
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "AI_ENHANCER_PING" });
        if (response?.ok) return;
      } catch {
        // Worker reactivation can briefly close the message channel while the content script remains valid.
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100));
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

async function maintainRuntime({ ensureContent = true } = {}) {
  const settings = await chrome.storage.local.get({ enabled: true });
  if (!settings.enabled) return;
  await ensureBackendStarted();
  if (ensureContent) await ensureContentScripts();
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
  const settings = await loadMigratedSettings();
  if (settings.enabled) await maintainRuntime();
});

chrome.runtime.onStartup.addListener(async () => {
  await statisticsTracker.ensureDefaults();
  const settings = await loadMigratedSettings();
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
    recordProcessingEvent({
      tabId: sender.tab.id,
      imageId: message.imageId,
      operationId: message.operationId,
      traceId: message.traceId,
      sourceUrl: message.imageUrl,
      stage: "READING_SOURCE",
    }).then((result) => sendResponse(result));
    return true;
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
    recordProcessingEvent({
      tabId: sender.tab.id,
      imageId: message.imageId,
      operationId: message.operationId,
      traceId: message.traceId,
      sourceUrl: message.imageUrl,
      stage: "WAITING_FOR_VIEWPORT",
      metadata: { reason: message.reason || "outside_prefetch" },
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
    recordProcessingEvent({
      tabId: sender.tab.id,
      imageId: message.imageId,
      operationId: message.operationId,
      traceId: message.traceId,
      sourceUrl: message.imageUrl,
      stage: status === "timeout" ? "TIMED_OUT" : (status === "cancelled" ? "CANCELLED" : "FAILED"),
      error: {
        errorCode: status === "timeout" ? "PREPROCESSING_TIMEOUT" : "PREPROCESSING_FAILED",
        category: status === "timeout" ? "TIMEOUT" : (status === "cancelled" ? "CANCELLATION" : "ACQUISITION"),
        message: message.reason || "Preprocessing failed.",
        retryable: status !== "cancelled",
      },
      metadata: { previewValid: false },
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
        recordProcessingEvent({
          tabId,
          imageId: message.imageId,
          operationId: message.operationId,
          traceId: message.traceId,
          sourceUrl: message.imageUrl,
          stage: "DETECTED",
          input: {
            width: Number(message.width) || null,
            height: Number(message.height) || null,
            sourceKind: "dom-image",
          },
          metadata: {
            pageOrder: Number(message.pageOrder),
            page: AI_PROCESSING_MONITOR.sanitizeUrl(sender.tab.url || ""),
          },
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
      recordProcessingEvent({
        tabId,
        imageId: message.imageId,
        operationId: message.operationId,
        traceId: message.traceId,
        sourceFingerprint: message.sourceFingerprint || null,
        parentJobId: message.parentJobId ? `${tabId}:${message.parentJobId}` : null,
        sourceUrl: message.imageUrl,
        stage: "VALIDATING_SOURCE",
        input: {
          width: Number(message.displayMetrics?.sourceWidth) || null,
          height: Number(message.displayMetrics?.sourceHeight) || null,
          byteLength: typeof message.imageData === "string" ? Math.max(0, Math.floor(message.imageData.length * 0.75)) : null,
          sourceKind: message.imageData ? "browser-bytes" : "remote-fetch",
        },
      });
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
        parentJobId: message.parentJobId ? `${tabId}:${message.parentJobId}` : null,
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
        displayMetrics: message.displayMetrics || null,
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
    const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
    if (!Number.isInteger(tabId) || typeof message.imageId !== "string" || !message.imageId || typeof message.operationId !== "string" || !message.operationId) {
      sendResponse({ canceled: false, reason: "Missing operation identity." });
      return false;
    }
    const canceled = scheduler.cancel(tabId, message.imageId, message.operationId);
    pageImageRegistry.removeImage(tabId, message.imageId, message.operationId);
    if (!sender.tab?.id) {
      chrome.tabs.sendMessage(tabId, { type: "CANCEL_IMAGE", imageId: message.imageId, operationId: message.operationId }).catch(() => {});
    }
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

  if (message.type === "RETRY_IMAGE") {
    const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
    if (!Number.isInteger(tabId) || typeof message.imageId !== "string" || !message.imageId || typeof message.operationId !== "string" || !message.operationId) {
      sendResponse({ retried: false, reason: "Missing operation identity." });
      return false;
    }
    processingMonitorReady.then(() => {
      const record = processingMonitor.get(tabId, message.imageId, message.operationId);
      if (!record?.error?.retryable) {
        sendResponse({ retried: false, reason: "Operation is not retryable." });
        return;
      }
      chrome.tabs.sendMessage(tabId, {
        type: "RETRY_IMAGE",
        imageId: message.imageId,
        operationId: message.operationId,
      }).then(async (response) => {
        if (!response?.retried || !response.operationId) {
          sendResponse({ retried: false, reason: "Content image is no longer retryable." });
          return;
        }
        const retry = processingMonitor.createRetry(
          tabId,
          message.imageId,
          message.operationId,
          response.operationId,
        );
        await persistProcessingMonitor();
        sendResponse({
          retried: retry.accepted,
          operationId: response.operationId,
          traceId: response.traceId || null,
          reason: retry.accepted ? null : retry.reason,
        });
      }).catch(() => sendResponse({ retried: false, reason: "Content tab unavailable." }));
    });
    return true;
  }

  if (message.type === "RENDER_STARTED") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ recorded: false, reason: "Missing operation identity." });
      return false;
    }
    const current = pageImageRegistry.page(sender.tab.id).get(message.imageId);
    if (!current || current.operationId !== message.operationId) {
      sendResponse({ recorded: false, stale: true });
      return false;
    }
    const renderInputs = ["PREPARING_RENDER", "RENDERING"].map((stage) => ({
      tabId: sender.tab.id,
      imageId: message.imageId,
      operationId: message.operationId,
      jobId: `${sender.tab.id}:${message.imageId}:${message.operationId}`,
      traceId: message.traceId,
      sourceFingerprint: message.sourceFingerprint,
      sourceUrl: current.imageUrl,
      stage,
      cache: message.cacheHit ? "HIT" : "MISS",
    }));
    recordProcessingEvents(renderInputs).then((results) => sendResponse(results.at(-1)));
    return true;
  }

  if (message.type === "RENDER_COMMITTED") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ recorded: false, reason: "Missing operation identity." });
      return false;
    }
    const current = pageImageRegistry.page(sender.tab.id).get(message.imageId);
    if (!current || current.operationId !== message.operationId) {
      sendResponse({ recorded: false, stale: true });
      return false;
    }
    recordProcessingEvent({
      tabId: sender.tab.id,
      imageId: message.imageId,
      operationId: message.operationId,
      jobId: `${sender.tab.id}:${message.imageId}:${message.operationId}`,
      traceId: message.traceId,
      sourceFingerprint: message.sourceFingerprint,
      sourceUrl: current.imageUrl,
      stage: "COMPLETED",
      cache: message.cacheHit ? "HIT" : "MISS",
      renderCommit: { confirmed: true, outcome: "rendered" },
      metadata: { cleanupStatus: "settled" },
    }).then(async (result) => {
      if (result.accepted) {
        const completionStats = current.completionStats || {};
        pageImageRegistry.update(sender.tab.id, message.imageId, {
          operationId: message.operationId,
          status: message.cacheHit ? "cache" : "fixed",
          renderCommit: true,
          renderedAt: performance.now(),
          completionStats: undefined,
        });
        if (!current.statisticsRecorded) {
          await statisticsTracker.recordSuccess({
            tabId: sender.tab.id,
            latencyMs: Number(completionStats.latencyMs) || 0,
            cacheHit: Boolean(completionStats.cacheHit ?? message.cacheHit),
            quality: completionStats.quality || current.quality || null,
            detectedMode: completionStats.detectedMode || null,
            model: completionStats.model || null,
            provider: completionStats.provider || null,
            comparison: {
              originalImageUrl: current.originalImageUrl || current.imageUrl,
              enhancedImageUrl: current.enhancedImageUrl || null,
              imageUrl: current.imageUrl,
              quality: completionStats.quality || current.quality || null,
              detectedMode: completionStats.detectedMode || null,
            },
          });
          pageImageRegistry.update(sender.tab.id, message.imageId, {
            operationId: message.operationId,
            statisticsRecorded: true,
          });
        }
      }
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "RENDER_FAILED") {
    if (!hasMessageOperationIdentity(message, sender)) {
      sendResponse({ recorded: false, reason: "Missing operation identity." });
      return false;
    }
    pageImageRegistry.update(sender.tab.id, message.imageId, {
      operationId: message.operationId,
      status: message.outcome === "stale" ? "cancelled" : "error",
      error: message.outcome === "stale" ? "Render superseded." : "DOM render failed.",
    });
    recordProcessingEvent({
      tabId: sender.tab.id,
      imageId: message.imageId,
      operationId: message.operationId,
      traceId: message.traceId,
      sourceFingerprint: message.sourceFingerprint,
      sourceUrl: message.imageUrl,
      stage: message.outcome === "stale" ? "CANCELLED" : "FAILED",
      error: {
        errorCode: message.outcome === "stale" ? "RENDER_SUPERSEDED" : "DOM_RENDER_FAILED",
        category: message.outcome === "stale" ? "CANCELLATION" : "RENDERING",
        message: message.outcome === "stale" ? "A newer operation superseded this render." : "The enhanced image could not be committed to the DOM.",
        retryable: message.outcome !== "stale",
      },
      metadata: { previewValid: false },
    }).then((result) => sendResponse(result));
    return true;
  }

  if (message.type === "GET_PROCESSING_MONITOR") {
    processingMonitorReady.then(() => {
      const snapshot = processingMonitor.snapshot();
      if (Number.isInteger(message.tabId)) {
        snapshot.jobs = snapshot.jobs.filter((job) => job.tabId === message.tabId);
      }
      sendResponse(snapshot);
    });
    return true;
  }

  if (message.type === "CLEAR_PROCESSING_HISTORY") {
    processingMonitorReady.then(() => {
      const removed = processingMonitor.clearTerminal(message.stage || null);
      persistProcessingMonitor().then(() => sendResponse({ removed }));
    });
    return true;
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
    const clamp = (value, minimum, maximum, fallback) => {
      const number = Number(value);
      return Math.min(Math.max(Number.isFinite(number) ? number : fallback, minimum), maximum);
    };
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
      imageSliceMaxWidth: clamp(message.imageSliceMaxWidth, 512, 8192, AI_MANGA_UPSCALER_CONFIG.images.sliceMaxWidthPx),
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
    if (Object.prototype.hasOwnProperty.call(message, "aheadProcessingEnabled")) {
      limits.aheadProcessingEnabled = message.aheadProcessingEnabled !== false;
    }
    if (Object.prototype.hasOwnProperty.call(message, "aheadProcessingImageLimit")) {
      limits.aheadProcessingImageLimit = clamp(message.aheadProcessingImageLimit, 1, 50, AI_MANGA_UPSCALER_CONFIG.images.aheadProcessingImageLimit);
    }
    if (Object.prototype.hasOwnProperty.call(message, "prefetchMarginPx")) {
      limits.prefetchMarginPx = clamp(message.prefetchMarginPx, 0, 12000, AI_MANGA_UPSCALER_CONFIG.images.prefetchMarginPx);
    }
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
loadMigratedSettings().then((settings) => {
  scheduler.setMaxConcurrentRequests(settings.upscaleConcurrency);
  scheduler.setPaused(!settings.enabled);
  if (settings.enabled) maintainRuntime({ ensureContent: false });
});
