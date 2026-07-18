const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadMonitor() {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "processing-monitor.js"),
    "utf8",
  );
  const context = vm.createContext({
    URL,
    Date,
    Math,
    crypto: { randomUUID: () => "event-test" },
  });
  vm.runInContext(source, context);
  return context.AI_PROCESSING_MONITOR;
}

test("MON-003 accepts the real success lifecycle in order", () => {
  const monitor = loadMonitor();
  const stages = [
    "DETECTED",
    "WAITING_FOR_VIEWPORT",
    "READING_SOURCE",
    "VALIDATING_SOURCE",
    "QUEUED",
    "SENDING_TO_BACKEND",
    "RECEIVING_RESULT",
    "PREPARING_RENDER",
    "RENDERING",
    "COMPLETED",
  ];

  for (let index = 1; index < stages.length; index += 1) {
    assert.equal(monitor.canTransition(stages[index - 1], stages[index]), true);
  }
});

test("MON-004 and MON-008 reject invalid terminal transitions", () => {
  const monitor = loadMonitor();
  assert.equal(monitor.canTransition("FAILED", "COMPLETED"), false);
  assert.equal(monitor.canTransition("CANCELLED", "COMPLETED"), false);
  assert.equal(monitor.canTransition("COMPLETED", "SENDING_TO_BACKEND"), false);
  assert.throws(
    () => monitor.assertTransition("FAILED", "COMPLETED"),
    /Invalid processing transition/,
  );
});

test("MON-009 completed requires a confirmed renderer commit", () => {
  const monitor = loadMonitor();
  assert.throws(
    () => monitor.createEvent({
      imageId: "image-1",
      operationId: "operation-1",
      stage: "COMPLETED",
      renderCommit: { confirmed: false },
    }),
    /renderer commit/i,
  );

  const event = monitor.createEvent({
    imageId: "image-1",
    operationId: "operation-1",
    stage: "COMPLETED",
    renderCommit: { confirmed: true, outcome: "rendered" },
  });
  assert.equal(event.stage, "COMPLETED");
  assert.equal(event.status, "TERMINAL");
});

test("MON-011 normalizes 422 as a non-retryable contract error", () => {
  const monitor = loadMonitor();
  const error = monitor.normalizeError({
    detail: {
      errorCode: "REQUEST_VALIDATION_FAILED",
      message: "Output width is below backend minimum",
      status: 422,
      field: "maxOutputWidth",
      traceId: "trace-1234567890",
    },
  }, "SENDING_TO_BACKEND");

  assert.deepEqual(JSON.parse(JSON.stringify(error)), {
    errorCode: "REQUEST_VALIDATION_FAILED",
    category: "BACKEND_CONTRACT",
    message: "Output width is below backend minimum",
    status: 422,
    field: "maxOutputWidth",
    traceId: "trace-1234567890",
    retryable: false,
    stage: "SENDING_TO_BACKEND",
  });
});

test("MON-015 and MON-016 redact URLs and exclude sensitive payloads", () => {
  const monitor = loadMonitor();
  const event = monitor.createEvent({
    imageId: "image-1",
    operationId: "operation-1",
    traceId: "trace-abcdefghijklmnopqrstuvwxyz",
    sourceFingerprint: "0123456789abcdef0123456789abcdef",
    stage: "READING_SOURCE",
    sourceUrl: "https://cdn.example/private/chapter/page.jpg?token=secret&width=1200#reader",
    imageData: "data:image/png;base64,SECRET",
    metadata: {
      Authorization: "Bearer secret",
      cookie: "session=secret",
      rawResponseBody: { imageData: "SECRET" },
      safe: true,
    },
  });

  assert.equal(event.sourceFingerprint, "0123456789abcdef");
  assert.deepEqual(JSON.parse(JSON.stringify(event.source)), {
    scheme: "https",
    hostname: "cdn.example",
    path: "/private/chapter/page.jpg",
    queryKeys: ["token", "width"],
  });
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes("SECRET"), false);
  assert.equal(serialized.includes("Bearer secret"), false);
  assert.equal(serialized.includes("session=secret"), false);
  assert.equal(serialized.includes("token=secret"), false);
});

test("progress remains indeterminate unless an explicit measured value is supplied", () => {
  const monitor = loadMonitor();
  assert.equal(monitor.createEvent({ stage: "UPSCALING" }).progress, null);
  assert.equal(monitor.createEvent({ stage: "UPSCALING", progress: 0.4, progressMeasured: false }).progress, null);
  assert.equal(monitor.createEvent({ stage: "UPSCALING", progress: 0.4, progressMeasured: true }).progress, 0.4);
});

function storeEvent(monitor, overrides = {}) {
  return monitor.createEvent({
    tabId: 7,
    imageId: "image-1",
    operationId: "operation-1",
    sourceFingerprint: "fingerprint-111111111111",
    stage: "DETECTED",
    timestamp: "2026-07-19T00:00:00.000Z",
    ...overrides,
  });
}

test("MON-001 records a detected job with one timeline event", () => {
  const monitor = loadMonitor();
  const store = new monitor.ProcessingMonitorStore();
  const result = store.ingest(storeEvent(monitor));

  assert.equal(result.accepted, true);
  assert.equal(store.snapshot().jobs.length, 1);
  assert.equal(store.snapshot().jobs[0].stage, "DETECTED");
  assert.equal(store.snapshot().jobs[0].timeline.length, 1);
});

test("MON-005 ignores stale operation events after a replacement begins", () => {
  const monitor = loadMonitor();
  const store = new monitor.ProcessingMonitorStore();
  store.ingest(storeEvent(monitor));
  store.ingest(storeEvent(monitor, { operationId: "operation-2", eventId: "event-2" }));

  const stale = store.ingest(storeEvent(monitor, {
    eventId: "event-stale",
    stage: "READING_SOURCE",
  }));
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, "stale_operation");
  assert.equal(store.currentOperation(7, "image-1"), "operation-2");
});

test("MON-006 and MON-007 keep cancel and timeout terminal", () => {
  const monitor = loadMonitor();
  const store = new monitor.ProcessingMonitorStore();
  store.ingest(storeEvent(monitor));
  store.ingest(storeEvent(monitor, { eventId: "cancel", stage: "CANCELLED" }));
  assert.equal(store.ingest(storeEvent(monitor, { eventId: "late", stage: "COMPLETED", renderCommit: { confirmed: true } })).accepted, false);

  store.ingest(storeEvent(monitor, { imageId: "image-2", operationId: "operation-2", eventId: "detected-2" }));
  store.ingest(storeEvent(monitor, { imageId: "image-2", operationId: "operation-2", eventId: "timeout", stage: "TIMED_OUT" }));
  assert.equal(store.get(7, "image-2", "operation-2").stage, "TIMED_OUT");
});

test("MON-010 retry creates a linked operation and never reuses the stale attempt", () => {
  const monitor = loadMonitor();
  const store = new monitor.ProcessingMonitorStore();
  store.ingest(storeEvent(monitor));
  store.ingest(storeEvent(monitor, { eventId: "failed", stage: "FAILED", error: { status: 503 } }));

  const retry = store.createRetry(7, "image-1", "operation-1", "operation-2", "event-retry");
  assert.equal(retry.accepted, true);
  assert.equal(retry.record.operationId, "operation-2");
  assert.equal(retry.record.retryCount, 1);
  assert.equal(retry.record.parentJobId, store.key(7, "image-1", "operation-1"));
  assert.throws(() => store.createRetry(7, "image-1", "operation-1", "operation-1"), /new operation/i);
});

test("MON-014 prunes completed and failed history deterministically", () => {
  const monitor = loadMonitor();
  const store = new monitor.ProcessingMonitorStore({
    maxCompletedHistory: 1,
    maxErrorHistory: 1,
    retentionHours: 1000,
  });
  for (let index = 0; index < 3; index += 1) {
    const base = { imageId: `image-${index}`, operationId: `operation-${index}`, eventId: `detected-${index}`, timestamp: `2026-07-19T00:00:0${index}.000Z` };
    store.ingest(storeEvent(monitor, base));
    const terminal = index === 2 ? "FAILED" : "COMPLETED";
    if (terminal === "COMPLETED") {
      [
        "WAITING_FOR_VIEWPORT", "READING_SOURCE", "VALIDATING_SOURCE", "QUEUED",
        "SENDING_TO_BACKEND", "RECEIVING_RESULT", "PREPARING_RENDER", "RENDERING",
      ].forEach((stage, stageIndex) => store.ingest(storeEvent(monitor, {
        ...base,
        eventId: `${stage}-${index}`,
        stage,
        timestamp: `2026-07-19T00:00:${10 + stageIndex}.000Z`,
      })));
    }
    store.ingest(storeEvent(monitor, {
      ...base,
      eventId: `terminal-${index}`,
      stage: terminal,
      timestamp: `2026-07-19T00:01:0${index}.000Z`,
      renderCommit: terminal === "COMPLETED" ? { confirmed: true } : null,
    }));
  }
  store.prune(Date.parse("2026-07-19T01:00:00.000Z"));
  const jobs = store.snapshot().jobs;
  assert.equal(jobs.filter((job) => job.stage === "COMPLETED").length, 1);
  assert.equal(jobs.filter((job) => job.stage === "FAILED").length, 1);
});

test("MON-017 worker restart converts active jobs to interrupted cancellation", () => {
  const monitor = loadMonitor();
  const store = new monitor.ProcessingMonitorStore();
  store.ingest(storeEvent(monitor));
  store.ingest(storeEvent(monitor, { eventId: "reading", stage: "READING_SOURCE" }));
  store.recoverInterrupted("worker_restart", "2026-07-19T00:02:00.000Z");

  const record = store.get(7, "image-1", "operation-1");
  assert.equal(record.stage, "CANCELLED");
  assert.equal(record.error.category, "CANCELLATION");
  assert.equal(record.metadata.previewValid, false);
});

test("MON-019 and MON-020 isolate tabs and byte fingerprints", () => {
  const monitor = loadMonitor();
  const store = new monitor.ProcessingMonitorStore();
  store.ingest(storeEvent(monitor));
  store.ingest(storeEvent(monitor, { tabId: 8, eventId: "tab-8", sourceFingerprint: "fingerprint-222222222222" }));
  store.ingest(storeEvent(monitor, { imageId: "image-2", operationId: "operation-2", eventId: "bytes-2", sourceFingerprint: "fingerprint-333333333333", sourceUrl: "https://same.example/page.jpg" }));

  const jobs = store.snapshot().jobs;
  assert.equal(jobs.length, 3);
  assert.deepEqual(new Set(jobs.map((job) => `${job.tabId}:${job.sourceFingerprint}`)), new Set([
    "7:fingerprint-1111",
    "8:fingerprint-2222",
    "7:fingerprint-3333",
  ]));
});

test("MON-018 restores a sanitized dashboard snapshot after reload", () => {
  const monitor = loadMonitor();
  const first = new monitor.ProcessingMonitorStore();
  first.ingest(storeEvent(monitor));
  first.ingest(storeEvent(monitor, { eventId: "reading", stage: "READING_SOURCE" }));

  const restored = new monitor.ProcessingMonitorStore();
  const result = restored.restore(first.snapshot());
  assert.equal(result.restored, 1);
  assert.equal(restored.get(7, "image-1", "operation-1").stage, "READING_SOURCE");
  assert.equal(JSON.stringify(restored.snapshot()).includes("imageData"), false);
});

test("monitor summary and terminal clearing use real states", () => {
  const monitor = loadMonitor();
  const store = new monitor.ProcessingMonitorStore();
  store.ingest(storeEvent(monitor));
  store.ingest(storeEvent(monitor, { imageId: "image-2", operationId: "operation-2", eventId: "detected-2" }));
  store.ingest(storeEvent(monitor, { imageId: "image-2", operationId: "operation-2", eventId: "failed-2", stage: "FAILED" }));

  assert.deepEqual(JSON.parse(JSON.stringify(store.summary())), {
    active: 1,
    queued: 0,
    deferred: 0,
    completed: 0,
    failed: 1,
    timedOut: 0,
    cancelled: 0,
    skipped: 0,
    cacheHits: 0,
    averageDurationMs: 0,
  });
  assert.equal(store.clearTerminal("FAILED"), 1);
  assert.equal(store.snapshot().jobs.length, 1);
});

test("MON-013 aggregates segment terminal state without inventing percentage progress", () => {
  const monitor = loadMonitor();
  const store = new monitor.ProcessingMonitorStore();
  [0, 1].forEach((segmentIndex) => {
    const base = {
      tabId: 7,
      imageId: `image-1-seg-${segmentIndex}`,
      operationId: `operation-1-seg-${segmentIndex}`,
      parentJobId: "7:image-1:operation-1",
      segmentIndex,
      segmentCount: 2,
      eventId: `segment-detected-${segmentIndex}`,
      stage: "DETECTED",
    };
    store.ingest(monitor.createEvent(base));
    store.ingest(monitor.createEvent({ ...base, eventId: `segment-reading-${segmentIndex}`, stage: "READING_SOURCE" }));
    store.ingest(monitor.createEvent({ ...base, eventId: `segment-validating-${segmentIndex}`, stage: "VALIDATING_SOURCE" }));
    store.ingest(monitor.createEvent({ ...base, eventId: `segment-queued-${segmentIndex}`, stage: "QUEUED" }));
    store.ingest(monitor.createEvent({ ...base, eventId: `segment-failed-${segmentIndex}`, stage: segmentIndex ? "FAILED" : "CANCELLED", error: { status: 503 } }));
  });
  assert.deepEqual(JSON.parse(JSON.stringify(store.segmentSummary("7:image-1:operation-1"))), {
    segmentCount: 2,
    completed: 0,
    failed: 1,
    cancelled: 1,
    active: 0,
    progress: null,
  });
});
