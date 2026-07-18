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
