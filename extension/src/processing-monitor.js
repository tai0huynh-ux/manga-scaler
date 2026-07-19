var AI_PROCESSING_MONITOR = (() => {
  "use strict";

  const SCHEMA_VERSION = 1;
  const STAGES = Object.freeze([
    "DETECTED",
    "WAITING_FOR_VIEWPORT",
    "READING_SOURCE",
    "VALIDATING_SOURCE",
    "QUEUED",
    "DEFERRED",
    "SENDING_TO_BACKEND",
    "DOWNLOADING",
    "DECODING",
    "CLASSIFYING",
    "LOADING_MODEL",
    "UPSCALING",
    "OCR",
    "REMOVING_TEXT",
    "INPAINTING",
    "TYPESETTING",
    "ENCODING",
    "RECEIVING_RESULT",
    "PREPARING_RENDER",
    "RENDERING",
    "COMPLETED",
    "SKIPPED",
    "CANCELLED",
    "FAILED",
    "TIMED_OUT",
    "REMOVED",
  ]);
  const TERMINAL_STAGES = new Set([
    "COMPLETED", "SKIPPED", "CANCELLED", "FAILED", "TIMED_OUT", "REMOVED",
  ]);
  const ERROR_CATEGORIES = new Set([
    "DISCOVERY", "ACQUISITION", "VALIDATION", "QUEUE", "NETWORK",
    "BACKEND_CONTRACT", "MODEL", "GPU", "OCR", "INPAINT", "TYPESETTING",
    "ENCODING", "RENDERING", "CANCELLATION", "TIMEOUT", "SECURITY", "UNKNOWN",
  ]);
  const FORBIDDEN_KEY_PARTS = [
    "authorization", "cookie", "imagedata", "base64", "requestbody", "responsebody",
    "rawrequest", "rawresponse", "browserprofile", "personalpath", "imagebytes",
  ];

  const SUCCESSORS = Object.freeze({
    DETECTED: ["WAITING_FOR_VIEWPORT", "READING_SOURCE"],
    WAITING_FOR_VIEWPORT: ["READING_SOURCE"],
    READING_SOURCE: ["VALIDATING_SOURCE"],
    VALIDATING_SOURCE: ["QUEUED"],
    QUEUED: ["DEFERRED", "SENDING_TO_BACKEND", "RECEIVING_RESULT"],
    DEFERRED: ["QUEUED", "SENDING_TO_BACKEND"],
    SENDING_TO_BACKEND: ["DOWNLOADING", "DECODING", "RECEIVING_RESULT"],
    DOWNLOADING: ["DECODING"],
    DECODING: ["CLASSIFYING", "LOADING_MODEL", "UPSCALING"],
    CLASSIFYING: ["LOADING_MODEL", "UPSCALING"],
    LOADING_MODEL: ["UPSCALING"],
    UPSCALING: ["OCR", "REMOVING_TEXT", "INPAINTING", "TYPESETTING", "ENCODING", "RECEIVING_RESULT"],
    OCR: ["REMOVING_TEXT", "INPAINTING", "TYPESETTING", "ENCODING"],
    REMOVING_TEXT: ["INPAINTING", "TYPESETTING", "ENCODING"],
    INPAINTING: ["TYPESETTING", "ENCODING"],
    TYPESETTING: ["ENCODING"],
    ENCODING: ["RECEIVING_RESULT"],
    RECEIVING_RESULT: ["PREPARING_RENDER"],
    PREPARING_RENDER: ["RENDERING"],
    RENDERING: ["COMPLETED"],
  });

  function isTerminal(stage) {
    return TERMINAL_STAGES.has(stage);
  }

  function canTransition(fromStage, toStage) {
    if (!STAGES.includes(fromStage) || !STAGES.includes(toStage)) return false;
    if (fromStage === toStage) return !isTerminal(fromStage);
    if (isTerminal(fromStage)) return false;
    if (toStage === "DEFERRED") {
      return !["PREPARING_RENDER", "RENDERING"].includes(fromStage);
    }
    if (["CANCELLED", "FAILED", "TIMED_OUT", "REMOVED"].includes(toStage)) return true;
    if (toStage === "SKIPPED") {
      return ["DETECTED", "WAITING_FOR_VIEWPORT", "READING_SOURCE", "VALIDATING_SOURCE"].includes(fromStage);
    }
    return Boolean(SUCCESSORS[fromStage]?.includes(toStage));
  }

  function assertTransition(fromStage, toStage) {
    if (!canTransition(fromStage, toStage)) {
      throw new Error(`Invalid processing transition: ${fromStage} -> ${toStage}`);
    }
    return true;
  }

  function isForbiddenKey(key) {
    const normalized = String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    return FORBIDDEN_KEY_PARTS.some((part) => normalized.includes(part));
  }

  function truncate(value, maxLength = 500) {
    const text = String(value ?? "");
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
  }

  function sanitizeValue(value, depth = 0) {
    if (depth > 5 || value === undefined) return undefined;
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return truncate(value);
    if (Array.isArray(value)) {
      return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined);
    }
    if (typeof value !== "object") return undefined;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (isForbiddenKey(key)) continue;
      const sanitized = sanitizeValue(item, depth + 1);
      if (sanitized !== undefined) result[key] = sanitized;
    }
    return result;
  }

  function sanitizeUrl(source) {
    if (typeof source !== "string" || !source) return null;
    try {
      const url = new URL(source);
      const scheme = url.protocol.replace(/:$/, "").toLowerCase();
      const hostname = url.hostname.toLowerCase();
      const path = truncate(url.pathname || "/", 160);
      const queryKeys = [...new Set([...url.searchParams.keys()])].slice(0, 32).sort();
      return { scheme, hostname, path, queryKeys };
    } catch {
      return { scheme: "unknown", hostname: "", path: "unavailable", queryKeys: [] };
    }
  }

  function inferErrorCategory(errorCode, status, stage) {
    if (status === 422 || /VALIDATION|CONTRACT/.test(errorCode)) return "BACKEND_CONTRACT";
    if (/CANCEL/.test(errorCode)) return "CANCELLATION";
    if (/TIMEOUT/.test(errorCode) || status === 408 || status === 504) return "TIMEOUT";
    if (/MODEL/.test(errorCode)) return "MODEL";
    if (/GPU|DIRECTML|CUDA/.test(errorCode)) return "GPU";
    if (/OCR/.test(errorCode)) return "OCR";
    if (/INPAINT/.test(errorCode)) return "INPAINT";
    if (/TYPESET/.test(errorCode)) return "TYPESETTING";
    if (/ENCOD/.test(errorCode)) return "ENCODING";
    if (/SECURITY|AUTH|FORBIDDEN/.test(errorCode) || status === 401 || status === 403) return "SECURITY";
    if (["READING_SOURCE", "DOWNLOADING"].includes(stage)) return status ? "NETWORK" : "ACQUISITION";
    if (["PREPARING_RENDER", "RENDERING"].includes(stage)) return "RENDERING";
    if (["QUEUED", "DEFERRED"].includes(stage)) return "QUEUE";
    if (stage === "VALIDATING_SOURCE") return "VALIDATION";
    return status >= 500 ? "NETWORK" : "UNKNOWN";
  }

  function normalizeError(error, stage = "FAILED") {
    const detail = error?.detail && typeof error.detail === "object" ? error.detail : error || {};
    const status = Number(detail.status ?? error?.status ?? 0) || null;
    const errorCode = truncate(detail.errorCode || error?.errorCode || "UNKNOWN_ERROR", 100);
    const requestedCategory = detail.category || error?.category;
    const category = ERROR_CATEGORIES.has(requestedCategory)
      ? requestedCategory
      : inferErrorCategory(errorCode, status, stage);
    const retryable = typeof detail.retryable === "boolean"
      ? detail.retryable
      : !(status && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status));
    return {
      errorCode,
      category,
      message: truncate(detail.message || error?.message || "Processing failed."),
      status,
      field: detail.field ? truncate(detail.field, 120) : null,
      traceId: detail.traceId ? truncate(detail.traceId, 200) : null,
      retryable,
      stage,
    };
  }

  function newEventId() {
    try {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    } catch {
      // Some extension test contexts do not expose crypto.
    }
    return `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function createEvent(input = {}) {
    const stage = STAGES.includes(input.stage) ? input.stage : "DETECTED";
    if (stage === "COMPLETED" && input.renderCommit?.confirmed !== true) {
      throw new Error("COMPLETED requires a confirmed renderer commit.");
    }
    const measuredProgress = input.progressMeasured === true && Number.isFinite(input.progress)
      ? Math.min(Math.max(Number(input.progress), 0), 1)
      : null;
    const event = {
      schemaVersion: SCHEMA_VERSION,
      eventId: truncate(input.eventId || newEventId(), 200),
      jobId: input.jobId ? truncate(input.jobId, 200) : null,
      operationId: input.operationId ? truncate(input.operationId, 200) : null,
      traceId: input.traceId ? truncate(input.traceId, 200) : null,
      imageId: input.imageId ? truncate(input.imageId, 200) : null,
      tabId: Number.isInteger(input.tabId) ? input.tabId : null,
      sourceFingerprint: input.sourceFingerprint ? String(input.sourceFingerprint).slice(0, 16) : null,
      parentJobId: input.parentJobId ? truncate(input.parentJobId, 200) : null,
      segmentIndex: Number.isInteger(input.segmentIndex) ? input.segmentIndex : null,
      segmentCount: Number.isInteger(input.segmentCount) ? input.segmentCount : null,
      stage,
      status: isTerminal(stage) ? "TERMINAL" : "ACTIVE",
      progress: measuredProgress,
      timestamp: input.timestamp || new Date().toISOString(),
      durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Number(input.durationMs)) : null,
      queuePosition: Number.isInteger(input.queuePosition) ? Math.max(0, input.queuePosition) : null,
      retryCount: Number.isInteger(input.retryCount) ? Math.max(0, input.retryCount) : 0,
      cache: ["HIT", "MISS", "UNKNOWN"].includes(input.cache) ? input.cache : "UNKNOWN",
      mode: input.mode ? truncate(input.mode, 50) : "auto",
      model: input.model ? truncate(input.model, 120) : null,
      provider: input.provider ? truncate(input.provider, 120) : null,
      source: sanitizeUrl(input.sourceUrl),
      input: sanitizeValue(input.input || null),
      output: sanitizeValue(input.output || null),
      renderCommit: sanitizeValue(input.renderCommit || null),
      metadata: sanitizeValue(input.metadata || {}),
      error: input.error ? normalizeError(input.error, stage) : null,
    };
    return event;
  }

  class ProcessingMonitorStore {
    constructor(options = {}) {
      this.maxActiveHistory = Number(options.maxActiveHistory) || 500;
      this.maxCompletedHistory = Number(options.maxCompletedHistory) || 200;
      this.maxErrorHistory = Number(options.maxErrorHistory) || 200;
      this.retentionHours = Number(options.retentionHours) || 24;
      this.records = new Map();
      this.currentOperations = new Map();
      this.eventIds = new Set();
    }

    logicalKey(tabId, imageId) {
      return `${tabId}:${imageId}`;
    }

    key(tabId, imageId, operationId) {
      return `${tabId}:${imageId}:${operationId}`;
    }

    currentOperation(tabId, imageId) {
      return this.currentOperations.get(this.logicalKey(tabId, imageId)) || null;
    }

    get(tabId, imageId, operationId) {
      return this.clone(this.records.get(this.key(tabId, imageId, operationId)) || null);
    }

    ingest(event) {
      if (!event || event.schemaVersion !== SCHEMA_VERSION || !STAGES.includes(event.stage)) {
        return { accepted: false, reason: "invalid_event" };
      }
      if (!Number.isInteger(event.tabId) || !event.imageId || !event.operationId) {
        return { accepted: false, reason: "missing_identity" };
      }
      if (this.eventIds.has(event.eventId)) {
        return { accepted: false, reason: "duplicate_event" };
      }

      const logicalKey = this.logicalKey(event.tabId, event.imageId);
      const currentOperation = this.currentOperations.get(logicalKey);
      if (currentOperation && currentOperation !== event.operationId) {
        if (event.stage !== "DETECTED") {
          return { accepted: false, reason: "stale_operation" };
        }
        const previous = this.records.get(this.key(event.tabId, event.imageId, currentOperation));
        if (previous && !isTerminal(previous.stage)) {
          const superseded = createEvent({
            tabId: previous.tabId,
            imageId: previous.imageId,
            operationId: previous.operationId,
            traceId: previous.traceId,
            sourceFingerprint: previous.sourceFingerprint,
            sourceUrl: previous.source ? this.sourceToUrl(previous.source) : null,
            stage: "CANCELLED",
            timestamp: event.timestamp,
            retryCount: previous.retryCount,
            metadata: { ...previous.metadata, reason: "superseded", previewValid: false },
            error: {
              errorCode: "OPERATION_SUPERSEDED",
              category: "CANCELLATION",
              message: "A newer image operation replaced this attempt.",
              retryable: false,
            },
          });
          this.append(previous, superseded);
        }
      }

      const recordKey = this.key(event.tabId, event.imageId, event.operationId);
      const existing = this.records.get(recordKey);
      if (existing && !canTransition(existing.stage, event.stage)) {
        return { accepted: false, reason: "invalid_transition", record: this.clone(existing) };
      }
      if (!existing && event.stage !== "DETECTED") {
        return { accepted: false, reason: "missing_detected_event" };
      }

      const record = existing || {
        key: recordKey,
        tabId: event.tabId,
        imageId: event.imageId,
        operationId: event.operationId,
        createdAt: event.timestamp,
        timeline: [],
      };
      this.append(record, event);
      this.records.set(recordKey, record);
      this.currentOperations.set(logicalKey, event.operationId);
      this.eventIds.add(event.eventId);
      return { accepted: true, record: this.clone(record) };
    }

    append(record, event) {
      record.timeline.push(event);
      record.stage = event.stage;
      record.status = event.status;
      record.updatedAt = event.timestamp;
      record.updatedAtMs = Date.parse(event.timestamp) || Date.now();
      record.jobId = event.jobId || record.jobId || null;
      record.parentJobId = event.parentJobId || record.parentJobId || null;
      record.traceId = event.traceId || record.traceId || null;
      record.sourceFingerprint = event.sourceFingerprint || record.sourceFingerprint || null;
      record.source = event.source || record.source || null;
      record.segmentIndex = event.segmentIndex ?? record.segmentIndex ?? null;
      record.segmentCount = event.segmentCount ?? record.segmentCount ?? null;
      record.progress = event.progress;
      record.queuePosition = event.queuePosition;
      record.retryCount = event.retryCount;
      record.cache = event.cache;
      record.mode = event.mode;
      record.model = event.model || record.model || null;
      record.provider = event.provider || record.provider || null;
      record.input = event.input || record.input || null;
      record.output = event.output || record.output || null;
      record.renderCommit = event.renderCommit || record.renderCommit || null;
      record.metadata = { ...(record.metadata || {}), ...(event.metadata || {}) };
      record.error = event.error || null;
      return record;
    }

    createRetry(tabId, imageId, operationId, newOperationId, eventId = null) {
      if (!newOperationId || newOperationId === operationId) {
        throw new Error("Retry requires a new operation identity.");
      }
      const original = this.records.get(this.key(tabId, imageId, operationId));
      if (!original || !isTerminal(original.stage)) {
        return { accepted: false, reason: "retry_source_not_terminal" };
      }
      if (original.error?.retryable === false) {
        return { accepted: false, reason: "not_retryable" };
      }
      return this.ingest(createEvent({
        eventId: eventId || undefined,
        tabId,
        imageId,
        operationId: newOperationId,
        parentJobId: original.key,
        traceId: original.traceId,
        sourceFingerprint: original.sourceFingerprint,
        sourceUrl: original.source ? this.sourceToUrl(original.source) : null,
        stage: "DETECTED",
        retryCount: Number(original.retryCount || 0) + 1,
        mode: original.mode,
        input: original.input,
        metadata: { retryOf: original.key, previewValid: false },
      }));
    }

    recoverInterrupted(reason = "worker_restart", timestamp = new Date().toISOString()) {
      const recovered = [];
      for (const record of this.records.values()) {
        if (isTerminal(record.stage)) continue;
        const event = createEvent({
          tabId: record.tabId,
          imageId: record.imageId,
          operationId: record.operationId,
          traceId: record.traceId,
          sourceFingerprint: record.sourceFingerprint,
          sourceUrl: record.source ? this.sourceToUrl(record.source) : null,
          stage: "CANCELLED",
          timestamp,
          retryCount: record.retryCount,
          metadata: { ...record.metadata, reason, previewValid: false },
          error: {
            errorCode: "WORKER_INTERRUPTED",
            category: "CANCELLATION",
            message: "Processing was interrupted by an extension worker restart.",
            retryable: true,
          },
        });
        this.append(record, event);
        this.eventIds.add(event.eventId);
        recovered.push(record.key);
      }
      return recovered;
    }

    restore(snapshot) {
      if (!snapshot || snapshot.schemaVersion !== SCHEMA_VERSION || !Array.isArray(snapshot.jobs)) {
        return { restored: 0, rejected: 0 };
      }
      this.records.clear();
      this.currentOperations.clear();
      this.eventIds.clear();
      const events = snapshot.jobs
        .flatMap((job) => Array.isArray(job.timeline) ? job.timeline : [])
        .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
      let restored = 0;
      let rejected = 0;
      for (const event of events) {
        const result = this.ingest(event);
        if (result.accepted) restored += 1;
        else rejected += 1;
      }
      this.prune();
      return { restored: this.records.size, events: restored, rejected };
    }

    summary() {
      const summary = {
        active: 0,
        queued: 0,
        deferred: 0,
        completed: 0,
        failed: 0,
        timedOut: 0,
        cancelled: 0,
        skipped: 0,
        cacheHits: 0,
        averageDurationMs: null,
      };
      const durations = [];
      for (const record of this.records.values()) {
        if (!isTerminal(record.stage)) summary.active += 1;
        if (record.stage === "QUEUED") summary.queued += 1;
        if (record.stage === "DEFERRED") summary.deferred += 1;
        if (record.stage === "COMPLETED") summary.completed += 1;
        if (record.stage === "FAILED") summary.failed += 1;
        if (record.stage === "TIMED_OUT") summary.timedOut += 1;
        if (record.stage === "CANCELLED") summary.cancelled += 1;
        if (record.stage === "SKIPPED") summary.skipped += 1;
        if (record.cache === "HIT") summary.cacheHits += 1;
        if (isTerminal(record.stage)) {
          const duration = record.updatedAtMs - (Date.parse(record.createdAt) || record.updatedAtMs);
          if (Number.isFinite(duration) && duration >= 0) durations.push(duration);
        }
      }
      if (durations.length) {
        summary.averageDurationMs = Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
      }
      return summary;
    }

    clearTerminal(stage = null) {
      let removed = 0;
      for (const record of [...this.records.values()]) {
        if (!isTerminal(record.stage) || (stage && record.stage !== stage)) continue;
        this.deleteRecord(record);
        removed += 1;
      }
      return removed;
    }

    segmentSummary(parentJobId) {
      const segments = [...this.records.values()].filter((record) => record.parentJobId === parentJobId);
      return {
        segmentCount: segments.length ? Math.max(...segments.map((record) => Number(record.segmentCount) || 0), segments.length) : 0,
        completed: segments.filter((record) => record.stage === "COMPLETED").length,
        failed: segments.filter((record) => record.stage === "FAILED" || record.stage === "TIMED_OUT").length,
        cancelled: segments.filter((record) => record.stage === "CANCELLED" || record.stage === "REMOVED").length,
        active: segments.filter((record) => !isTerminal(record.stage)).length,
        progress: segments.length && segments.every((record) => Number.isFinite(record.progress))
          ? segments.reduce((sum, record) => sum + record.progress, 0) / segments.length
          : null,
      };
    }

    prune(nowMs = Date.now()) {
      const cutoff = nowMs - (this.retentionHours * 60 * 60 * 1000);
      const active = [];
      const completed = [];
      const errors = [];
      for (const record of this.records.values()) {
        if (!isTerminal(record.stage)) {
          active.push(record);
          continue;
        }
        if (record.updatedAtMs < cutoff) {
          this.deleteRecord(record);
          continue;
        }
        if (["COMPLETED", "SKIPPED"].includes(record.stage)) completed.push(record);
        else errors.push(record);
      }
      this.pruneCategory(active, this.maxActiveHistory);
      this.pruneCategory(completed, this.maxCompletedHistory);
      this.pruneCategory(errors, this.maxErrorHistory);
      return this.records.size;
    }

    pruneCategory(records, limit) {
      records.sort((left, right) => left.updatedAtMs - right.updatedAtMs || left.key.localeCompare(right.key));
      while (records.length > limit) this.deleteRecord(records.shift());
    }

    deleteRecord(record) {
      if (!record) return;
      this.records.delete(record.key);
      const logicalKey = this.logicalKey(record.tabId, record.imageId);
      if (this.currentOperations.get(logicalKey) === record.operationId) {
        this.currentOperations.delete(logicalKey);
      }
      for (const event of record.timeline) this.eventIds.delete(event.eventId);
    }

    snapshot() {
      const jobs = [...this.records.values()]
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.key.localeCompare(right.key))
        .map((record) => this.clone(record));
      return {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        limits: {
          maxActiveHistory: this.maxActiveHistory,
          maxCompletedHistory: this.maxCompletedHistory,
          maxErrorHistory: this.maxErrorHistory,
          retentionHours: this.retentionHours,
        },
        summary: this.summary(),
        jobs,
      };
    }

    sourceToUrl(source) {
      if (!source?.scheme || !source?.hostname) return null;
      return `${source.scheme}://${source.hostname}${source.path || "/"}`;
    }

    clone(value) {
      return value === null ? null : JSON.parse(JSON.stringify(value));
    }
  }

  return Object.freeze({
    SCHEMA_VERSION,
    STAGES,
    TERMINAL_STAGES: Object.freeze([...TERMINAL_STAGES]),
    canTransition,
    assertTransition,
    createEvent,
    isTerminal,
    normalizeError,
    ProcessingMonitorStore,
    sanitizeUrl,
    sanitizeValue,
  });
})();
