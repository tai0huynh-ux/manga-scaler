const assert = require("node:assert/strict");
const test = require("node:test");

const { backendRestarted, sanitizeSourceIdentity } = require("./e2e/edge_live_reader_e2e.cjs");

function health(uptime, queue = {}) {
  return {
    uptime,
    queue: { accepted: 10, completed: 9, failed: 0, cancelled: 1, ...queue },
  };
}

test("live-reader gate detects backend uptime reset", () => {
  assert.deepEqual(backendRestarted(health(120), health(4)), {
    reason: "uptime-reset",
    previousUptime: 120,
    currentUptime: 4,
  });
});

test("live-reader gate detects queue counter rollback", () => {
  assert.deepEqual(backendRestarted(health(120), health(121, { completed: 2 })), {
    reason: "queue-counter-reset",
    counter: "completed",
    previous: 9,
    current: 2,
  });
});

test("live-reader gate accepts monotonic backend health", () => {
  assert.equal(backendRestarted(health(120), health(121, { accepted: 12, completed: 11 })), null);
});

test("live-reader diagnostics redact path details and query values", () => {
  assert.deepEqual(
    sanitizeSourceIdentity("https://cdn.example.test/series/chapter/image.jpg?token=secret&part=1#reader"),
    {
      scheme: "https",
      hostname: "cdn.example.test",
      path: "/series/...",
      queryKeys: ["part", "token"],
    },
  );
  assert.deepEqual(sanitizeSourceIdentity("data:image/png;base64,secret"), { scheme: "data" });
});
