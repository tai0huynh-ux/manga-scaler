const FAILURE_CLASSIFICATIONS = Object.freeze([
  "NOT_SCHEDULED", "VIEWPORT_DEFERRED", "SOURCE_CHANGED", "FETCH_403",
  "REFERER_FAILURE", "COOKIE_FAILURE", "REDIRECT_FAILURE", "MIME_FAILURE",
  "BODY_TIMEOUT", "HTTP_422", "BACKEND_FAILURE", "RESULT_FAILURE",
  "RENDER_PREPARE_FAILURE", "RENDER_COMMIT_FAILURE", "DOM_ELEMENT_REMOVED",
  "ROLLBACK",
]);

function stableIdentity(image) {
  const imageId = image?.imageId || image?.dataset?.aiEnhancerImageId || null;
  const operationId = image?.operationId || image?.dataset?.aiEnhancerOperationId || null;
  const sourceRevision = image?.sourceRevision || image?.dataset?.aiEnhancerKey || null;
  const sourceFingerprint = image?.sourceFingerprint || null;
  if (!imageId || !operationId) return null;
  return [imageId, operationId, sourceRevision || "", sourceFingerprint || ""].join("|");
}

function operationIdentity(image) {
  const imageId = image?.imageId || image?.dataset?.aiEnhancerImageId || null;
  const operationId = image?.operationId || image?.dataset?.aiEnhancerOperationId || null;
  const sourceRevision = image?.sourceRevision || image?.dataset?.aiEnhancerKey || null;
  if (!imageId || !operationId) return null;
  return [imageId, operationId, sourceRevision || ""].join("|");
}

function isRendererOwnedImage(image) {
  const source = String(image?.currentSource || image?.src || "");
  return image?.rawSlice === true || image?.dataset?.aiEnhancerRawSlice === "true"
    || source.startsWith("blob:");
}

function classifyUnreplaced(entry = {}) {
  if (entry.replaced) return null;
  if (!entry.detected) return "NOT_SCHEDULED";
  if ((entry.status === "waiting" || entry.status === "seen") && (entry.deferred || entry.reason === "cancelled-outside-prefetch")) return "VIEWPORT_DEFERRED";
  if (entry.status === "timeout" || entry.errorCode === "PROCESSING_TIMEOUT") return "BODY_TIMEOUT";
  if (entry.errorStatus === 422 || entry.errorCode === "REQUEST_NORMALIZATION_FAILED") return "HTTP_422";
  if (entry.errorCode === "FETCH_403" || entry.errorStatus === 403) return "FETCH_403";
  if (entry.errorCode === "MIME_FAILURE") return "MIME_FAILURE";
  if (entry.status === "error" || entry.status === "cancelled") return "BACKEND_FAILURE";
  if (entry.removed) return "DOM_ELEMENT_REMOVED";
  return "RESULT_FAILURE";
}

function duplicateOperationCount(entries = []) {
  const seen = new Set();
  let duplicates = 0;
  for (const entry of entries) {
    const identity = operationIdentity(entry);
    if (!identity) continue;
    if (seen.has(identity)) duplicates += 1;
    else seen.add(identity);
  }
  return duplicates;
}

function duplicateEnqueueCount(events = []) {
  const seen = new Set();
  let duplicates = 0;
  for (const event of events) {
    const identity = [event?.traceId || "", event?.attempt || 1, event?.metadata?.cache_variant || "full"].join("|");
    if (seen.has(identity)) duplicates += 1;
    else seen.add(identity);
  }
  return duplicates;
}

function isPromotedState({ rendered = false, status = null } = {}) {
  return rendered || ["preprocessing", "waiting", "processing", "fixed", "cache", "sliced"].includes(status);
}

function registryStatus(pages, imageId) {
  if (!pages || typeof pages.values !== "function" || !imageId) return null;
  for (const entries of pages.values()) {
    const entry = entries?.get?.(imageId);
    if (entry) return entry.status || null;
  }
  return null;
}

function selectOverlayDismissal(candidates = []) {
  const ranked = candidates
    .filter((candidate) => candidate?.visible !== false && candidate?.disabled !== true)
    .map((candidate, index) => {
      const signal = [candidate.id, candidate.className, candidate.ariaLabel,
        candidate.title, candidate.text].filter(Boolean).join(" ").toLowerCase();
      let score = 0;
      if (/close|dismiss|cancel|popup-icon/.test(signal)) score += 100;
      if (/^[x\u00d7]$/.test(String(candidate.text || "").trim())) score += 30;
      if (candidate.tag === "BUTTON" || candidate.role === "button") score += 10;
      return { candidate, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked[0]?.candidate || null;
}

function sanitizeUrl(value) {
  try {
    const url = new URL(String(value));
    return {
      protocol: url.protocol,
      hostname: url.hostname,
      queryKeys: [...url.searchParams.keys()].sort(),
      hasFragment: Boolean(url.hash),
    };
  } catch {
    return { protocol: null, hostname: null, queryKeys: [], hasFragment: false };
  }
}

module.exports = {
  FAILURE_CLASSIFICATIONS,
  stableIdentity,
  operationIdentity,
  isRendererOwnedImage,
  classifyUnreplaced,
  duplicateOperationCount,
  duplicateEnqueueCount,
  isPromotedState,
  registryStatus,
  selectOverlayDismissal,
  sanitizeUrl,
};
