const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyUnreplaced,
  duplicateEnqueueCount,
  duplicateOperationCount,
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
