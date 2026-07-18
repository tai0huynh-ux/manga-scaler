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

  return Object.freeze({
    SCHEMA_VERSION,
    STAGES,
    TERMINAL_STAGES: Object.freeze([...TERMINAL_STAGES]),
    canTransition,
    assertTransition,
    createEvent,
    isTerminal,
    normalizeError,
    sanitizeUrl,
    sanitizeValue,
  });
})();
