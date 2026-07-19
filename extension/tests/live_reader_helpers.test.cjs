const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyUnreplaced,
  duplicateEnqueueCount,
  duplicateIdentities,
  duplicateOperationCount,
  isPromotedState,
  registryStatus,
  selectOverlayDismissal,
  isOverlayProbe,
  isRendererOwnedImage,
  operationIdentity,
  sanitizeUrl,
  stableIdentity,
} = require("./e2e/live_reader_helpers.cjs");

test("stable identity survives DOM reorder and ignores renderer-owned blobs", () => {
  const first = { imageId: "img-1", operationId: "op-1", sourceRevision: "rev-1" };
  const reordered = { dataset: { aiEnhancerImageId: "img-1", aiEnhancerOperationId: "op-1", aiEnhancerKey: "rev-1" } };
  assert.equal(stableIdentity(first), stableIdentity(reordered));
  assert.equal(isRendererOwnedImage({ currentSource: "blob:https://example.test/result" }), true);
  assert.equal(isRendererOwnedImage({ currentSource: "https://cdn.example.test/a.jpg" }), false);
});

test("duplicate count is identity based rather than array-position based", () => {
  assert.equal(duplicateOperationCount([
    { imageId: "img-1", operationId: "op-1", sourceRevision: "rev-1" },
    { imageId: "img-2", operationId: "op-2", sourceRevision: "rev-2" },
    { imageId: "img-1", operationId: "op-1", sourceRevision: "rev-1" },
  ]), 1);
  assert.equal(operationIdentity({ imageId: "img-1", operationId: "op-1", sourceRevision: "rev-1", sourceFingerprint: null }),
    operationIdentity({ imageId: "img-1", operationId: "op-1", sourceRevision: "rev-1", sourceFingerprint: "sha256:new" }));
  assert.equal(duplicateOperationCount([
    { imageId: "img-1", operationId: "op-1", sourceRevision: "rev-1", sourceFingerprint: null },
    { imageId: "img-1", operationId: "op-1", sourceRevision: "rev-1", sourceFingerprint: "sha256:new" },
  ]), 1);
});

test("slices sharing a parent trace are distinct enqueue variants", () => {
  const events = [
    { traceId: "parent", attempt: 1, metadata: { cache_variant: "segment-0" } },
    { traceId: "parent", attempt: 1, metadata: { cache_variant: "segment-1" } },
  ];
  assert.equal(duplicateEnqueueCount(events), 0);
  assert.equal(duplicateEnqueueCount([...events, events[0]]), 1);
});

test("replacement operations sharing a trace are distinct jobs", () => {
  const events = [
    { traceId: "parent", attempt: 1, metadata: { operation_id_prefix: "op-1", cache_variant: "full" } },
    { traceId: "parent", attempt: 1, metadata: { operation_id_prefix: "op-2", cache_variant: "full" } },
  ];
  assert.equal(duplicateEnqueueCount(events), 0);
  assert.equal(duplicateEnqueueCount([...events, events[0]]), 1);
});

test("duplicate identity evidence reports only repeated keys", () => {
  assert.deepEqual(duplicateIdentities([
    { id: "a" }, { id: "b" }, { id: "a" }, { id: "a" },
  ], (entry) => entry.id), [{ identity: "a", count: 3 }]);
});

test("unreplaced entries receive one deterministic primary classification", () => {
  assert.equal(classifyUnreplaced({ detected: false }), "NOT_SCHEDULED");
  assert.equal(classifyUnreplaced({ detected: true, status: "waiting", deferred: true }), "VIEWPORT_DEFERRED");
  assert.equal(classifyUnreplaced({ detected: true, status: "seen", reason: "cancelled-outside-prefetch" }), "VIEWPORT_DEFERRED");
  assert.equal(classifyUnreplaced({ detected: true, errorStatus: 422 }), "HTTP_422");
  assert.equal(classifyUnreplaced({ detected: true, status: "error" }), "BACKEND_FAILURE");
  assert.equal(classifyUnreplaced({ replaced: true }), null);
});

test("URL evidence strips values while preserving shape", () => {
  assert.deepEqual(sanitizeUrl("https://cdn.example.test/a.jpg?token=secret&x=1#frag"), {
    protocol: "https:", hostname: "cdn.example.test", queryKeys: ["token", "x"], hasFragment: true,
  });
});

test("live scrolling waits until a seen image owns preprocessing work", () => {
  assert.equal(isPromotedState({ status: "seen" }), false);
  assert.equal(isPromotedState({ status: "preprocessing_queued" }), false);
  assert.equal(isPromotedState({ status: "preprocessing" }), true);
  assert.equal(isPromotedState({ status: "waiting" }), true);
  assert.equal(isPromotedState({ rendered: true, status: "seen" }), true);
});

test("promotion lookup reads the PageImageRegistry pages map", () => {
  const pages = new Map([[7, new Map([["image-1", { status: "preprocessing" }]])]]);
  assert.equal(registryStatus(pages, "image-1"), "preprocessing");
  assert.equal(registryStatus(pages, "missing"), null);
});

test("overlay dismissal prefers a visible close control over ad content", () => {
  const selected = selectOverlayDismissal([
    { id: "url-overlay", tag: "A", className: "ads-banner", text: "", visible: true },
    { id: "close-overlay", tag: "DIV", className: "", text: "\u00d7", visible: true },
    { id: "hidden-close", className: "popup-icon-close", text: "\u00d7", visible: false },
  ]);
  assert.equal(selected.id, "close-overlay");
});

test("ad images count as overlay probes while reader images do not", () => {
  assert.equal(isOverlayProbe({ tag: "IMG", id: "img-_pop-qqgo-11", className: "ads-banner" }), true);
  assert.equal(isOverlayProbe({ tag: "IMG", id: "ai-image-source", className: "" }), false);
});
