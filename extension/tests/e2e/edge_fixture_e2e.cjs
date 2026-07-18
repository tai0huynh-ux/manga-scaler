const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startReaderFixture } = require("../fixtures/reader/server.cjs");

const BACKEND_URL = process.env.AI_MANGA_E2E_BACKEND || "http://127.0.0.1:8765";
const WAIT_TIMEOUT_MS = Number(process.env.AI_MANGA_E2E_TIMEOUT_MS) || 180000;

function browserCandidates() {
  return [
    process.env.AI_MANGA_E2E_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
}

function findBrowser() {
  const browser = browserCandidates().find((candidate) => fs.existsSync(candidate));
  if (!browser) throw new Error("Edge or Chrome was not found. Set AI_MANGA_E2E_BROWSER to an executable path.");
  return browser;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(description, predicate, timeoutMs = WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`${description} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.sequence = 0;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("Unable to connect to browser CDP.")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    return this;
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Page evaluation failed.");
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function readHealth() {
  const response = await fetch(`${BACKEND_URL}/health`);
  if (!response.ok) throw new Error(`Backend health returned HTTP ${response.status}.`);
  return response.json();
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}.`);
  return response.json();
}

async function main() {
  const root = path.resolve(__dirname, "..", "..", "..");
  const extensionPath = path.join(root, "extension");
  const browserPath = findBrowser();
  const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), "ai-manga-upscaler-e2e-"));
  const fixture = await startReaderFixture();
  const healthBefore = await readHealth();
  let browserProcess = null;
  let pageClient = null;

  try {
    browserProcess = spawn(browserPath, [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--metrics-recording-only",
      "--remote-debugging-port=0",
      `--user-data-dir=${profilePath}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "about:blank",
    ], { stdio: "ignore", windowsHide: true });

    const activePortFile = path.join(profilePath, "DevToolsActivePort");
    const activePortText = await waitFor("Edge DevToolsActivePort", async () => {
      if (!fs.existsSync(activePortFile)) return null;
      return fs.readFileSync(activePortFile, "utf8");
    }, 20000);
    const port = Number(activePortText.split(/\r?\n/, 1)[0]);
    assert.ok(Number.isInteger(port) && port > 0, "CDP port must be valid.");

    const targets = await waitFor("unpacked extension service worker", async () => {
      const current = await listTargets(port);
      return current.some((target) => target.type === "service_worker" && target.url.endsWith("/src/background.js")) ? current : null;
    }, 20000);
    const extensionWorker = targets.find((target) => target.type === "service_worker" && target.url.endsWith("/src/background.js"));
    assert.ok(extensionWorker.url.startsWith("chrome-extension://"));

    const pageTarget = targets.find((target) => target.type === "page" && target.url === "about:blank")
      || targets.find((target) => target.type === "page");
    assert.ok(pageTarget?.webSocketDebuggerUrl, "A controllable page target is required.");
    pageClient = await new CdpClient(pageTarget.webSocketDebuggerUrl).open();
    await pageClient.send("Page.enable");
    await pageClient.send("Runtime.enable");
    await pageClient.send("Page.navigate", { url: `${fixture.origin}/e2e` });

    await waitFor("fixture document load", async () => pageClient.evaluate("document.readyState === 'complete' && document.body?.dataset.fixture === 'extension-e2e-v1'"), 20000);
    const pageState = await waitFor("two real upscales and queue settlement", async () => {
      const state = await pageClient.evaluate(`(() => {
        const describe = (id) => {
          const image = document.querySelector(id);
          return image ? {
            src: image.src,
            ready: image.classList.contains('ai-manga-upscaler-ready'),
            imageId: image.dataset.aiEnhancerImageId || null,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          } : null;
        };
        return {
          marker: document.body.dataset.fixture,
          staticImage: describe('#eligible-static'),
          dynamicImage: describe('#eligible-dynamic'),
          belowThreshold: describe('#below-threshold'),
          oneDimensionSmall: describe('#one-dimension-small'),
          logo: describe('#fixture-logo'),
        };
      })()`);
      if (!state.staticImage?.ready || !state.dynamicImage?.ready) return null;
      const health = await readHealth();
      if (health.queue.size !== 0 || health.queue.waiting !== 0 || health.queue.processing !== 0) return null;
      return { state, health };
    });

    assert.equal(pageState.state.marker, "extension-e2e-v1");
    assert.match(pageState.state.staticImage.src, /^blob:/);
    assert.match(pageState.state.dynamicImage.src, /^blob:/);
    assert.ok(pageState.state.staticImage.imageId);
    assert.ok(pageState.state.dynamicImage.imageId);
    for (const rejected of [pageState.state.belowThreshold, pageState.state.oneDimensionSmall, pageState.state.logo]) {
      assert.equal(rejected.ready, false);
      assert.equal(rejected.imageId, null);
      assert.match(rejected.src, /^http:/);
    }
    assert.ok(pageState.health.queue.completed >= healthBefore.queue.completed + 2);

    console.log(JSON.stringify({
      result: "PASS",
      browser: browserPath,
      extensionWorker: extensionWorker.url,
      fixture: fixture.origin,
      completedDelta: pageState.health.queue.completed - healthBefore.queue.completed,
      staticOutput: [pageState.state.staticImage.naturalWidth, pageState.state.staticImage.naturalHeight],
      dynamicOutput: [pageState.state.dynamicImage.naturalWidth, pageState.state.dynamicImage.naturalHeight],
      queue: pageState.health.queue,
    }, null, 2));
  } finally {
    pageClient?.close();
    await fixture.close();
    if (browserProcess && browserProcess.exitCode === null) browserProcess.kill();
    await delay(500);
    fs.rmSync(profilePath, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

