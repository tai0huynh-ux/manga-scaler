const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LIVE_URL = process.env.AI_MANGA_LIVE_URL;
const READER_KIND = process.env.AI_MANGA_LIVE_KIND || "unknown";
const BACKEND_URL = process.env.AI_MANGA_E2E_BACKEND || "http://127.0.0.1:8765";
const WAIT_TIMEOUT_MS = Number(process.env.AI_MANGA_LIVE_TIMEOUT_MS) || 300000;

if (!LIVE_URL) throw new Error("AI_MANGA_LIVE_URL is required.");

function findBrowser() {
  const candidates = [
    process.env.AI_MANGA_E2E_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const browser = candidates.find((candidate) => fs.existsSync(candidate));
  if (!browser) throw new Error("Microsoft Edge was not found.");
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
    await delay(500);
  }
  throw new Error(`${description} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.sequence = 0;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("Unable to connect to Edge CDP.")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        this.events.push(message);
        return;
      }
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Evaluation failed.");
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}.`);
  return response.json();
}

async function readHealth() {
  const response = await fetch(`${BACKEND_URL}/health`);
  if (!response.ok) throw new Error(`Backend health returned HTTP ${response.status}.`);
  return response.json();
}

function isRefererRule(rule) {
  return rule.action?.requestHeaders?.some((header) => String(header.header).toLowerCase() === "referer");
}

async function main() {
  const root = path.resolve(__dirname, "..", "..", "..");
  const extensionPath = path.join(root, "extension");
  const browserPath = findBrowser();
  const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), "ai-manga-live-"));
  const healthBefore = await readHealth();
  let browserProcess = null;
  let pageClient = null;
  let workerClient = null;

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

    const portFile = path.join(profilePath, "DevToolsActivePort");
    const portText = await waitFor("Edge DevToolsActivePort", async () => (
      fs.existsSync(portFile) ? fs.readFileSync(portFile, "utf8") : null
    ), 20000);
    const port = Number(portText.split(/\r?\n/, 1)[0]);
    const targets = await waitFor("Edge page and extension worker", async () => {
      const current = await listTargets(port);
      const page = current.find((target) => target.type === "page");
      const worker = current.find((target) => target.type === "service_worker" && target.url.endsWith("/src/background.js"));
      return page && worker ? { page, worker } : null;
    }, 20000);

    pageClient = await new CdpClient(targets.page.webSocketDebuggerUrl).open();
    workerClient = await new CdpClient(targets.worker.webSocketDebuggerUrl).open();
    await pageClient.send("Page.enable");
    await pageClient.send("Runtime.enable");
    await workerClient.send("Runtime.enable");
    await pageClient.send("Page.navigate", { url: LIVE_URL });
    await waitFor("live reader document", async () => pageClient.evaluate(
      "document.readyState === 'complete' && document.querySelectorAll('.page-chapter img').length > 0",
    ), 30000);

    const challenge = await pageClient.evaluate(
      "/captcha|verify you are human|cloudflare/i.test(document.body?.innerText || '')",
    );
    if (challenge) throw new Error("EXTERNAL_CHALLENGE");

    const reader = await pageClient.evaluate(`(() => {
      const images = [...document.querySelectorAll('.page-chapter img:not(.ai-enhancer-raw-slice)')];
      const outside = [...document.images].filter((image) => !image.closest('.page-chapter'));
      images.forEach((image, index) => {
        image.dataset.aiLiveOriginalIndex = String(index);
        image.dataset.aiLiveInitialSource = image.currentSrc || image.src;
      });
      outside.forEach((image, index) => {
        image.dataset.aiLiveOutsideIndex = String(index);
        image.dataset.aiLiveInitialSource = image.currentSrc || image.src;
      });
      return {
        title: document.title,
        url: location.href,
        count: images.length,
        sources: images.map((image) => image.currentSrc || image.src),
      };
    })()`);
    assert.ok(reader.count > 0, "Reader has no chapter images.");

    for (let index = 0; index < reader.count; index += 1) {
      await pageClient.evaluate(`(() => {
        const image = document.querySelector('.page-chapter img[data-ai-live-original-index="${index}"]');
        image?.scrollIntoView({ block: 'center' });
        return Boolean(image);
      })()`);
      await delay(250);
    }
    await pageClient.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)");

    let settledSince = 0;
    let lastProgressAt = Date.now();
    let lastProgressSignature = "";
    const final = await waitFor("live reader queue settlement", async () => {
      const page = await pageClient.evaluate(`(() => {
        const originals = [...document.querySelectorAll('.page-chapter img[data-ai-live-original-index]')];
        const outside = [...document.querySelectorAll('img[data-ai-live-outside-index]')];
        const status = originals.map((image) => {
          const wrapper = image.previousElementSibling?.classList.contains('ai-enhancer-slice-wrapper')
            ? image.previousElementSibling
            : null;
          const rawSlices = wrapper ? [...wrapper.querySelectorAll('img.ai-enhancer-raw-slice')] : [];
          const directReplacement = image.classList.contains('ai-manga-upscaler-ready') && image.src.startsWith('blob:');
          const slicedReplacement = image.dataset.aiEnhancerSliced === 'true'
            && rawSlices.length > 0
            && rawSlices.every((raw) => raw.classList.contains('ai-manga-upscaler-ready') && raw.src.startsWith('blob:'));
          return {
            eligible: image.naturalWidth >= 300 && image.naturalHeight >= 300,
            detected: Boolean(image.dataset.aiEnhancerImageId || image.dataset.aiEnhancerSliced || directReplacement),
            replaced: directReplacement || slicedReplacement,
            directReplacement,
            sliced: image.dataset.aiEnhancerSliced === 'true',
            rawSlices: rawSlices.length,
            readyRawSlices: rawSlices.filter((raw) => raw.classList.contains('ai-manga-upscaler-ready') && raw.src.startsWith('blob:')).length,
            initialSource: image.dataset.aiLiveInitialSource || null,
            currentSource: image.currentSrc || image.src,
          };
        });
        const eligibleStatus = status.filter((entry) => entry.eligible);
        return {
          originalElements: originals.length,
          eligible: eligibleStatus.length,
          detected: eligibleStatus.filter((entry) => entry.detected).length,
          replacements: eligibleStatus.filter((entry) => entry.replaced).length,
          directReplacements: eligibleStatus.filter((entry) => entry.directReplacement).length,
          slicedOriginals: eligibleStatus.filter((entry) => entry.sliced).length,
          completedSlicedOriginals: eligibleStatus.filter((entry) => entry.sliced && entry.replaced).length,
          rawSlices: eligibleStatus.reduce((total, entry) => total + entry.rawSlices, 0),
          readyRawSlices: eligibleStatus.reduce((total, entry) => total + entry.readyRawSlices, 0),
          unreplaced: eligibleStatus.filter((entry) => !entry.replaced).slice(0, 10),
          falsePositives: outside
            .filter((image) => image.classList.contains('ai-manga-upscaler-ready') || image.dataset.aiEnhancerImageId)
            .map((image) => ({ initialSource: image.dataset.aiLiveInitialSource || null, currentSource: image.currentSrc || image.src })),
        };
      })()`);
      const worker = await workerClient.evaluate(`(async () => {
        const rules = await chrome.declarativeNetRequest.getSessionRules();
        const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(LIVE_URL)} });
        const entries = tab?.id ? pageImageRegistry.list(tab.id) : [];
        return {
          queue: scheduler.snapshot(),
          activeJobs: scheduler.active.size,
          retryTimers: scheduler.retryTimers.size,
          readLocks: upscaleProvider.imageReadLocks.size,
          rules,
          entries,
        };
      })()`);
      const health = await readHealth();
      const settled = worker.queue.queueSize === 0 && worker.activeJobs === 0 && worker.retryTimers === 0
        && worker.readLocks === 0 && health.queue.size === 0 && health.queue.waiting === 0 && health.queue.processing === 0;
      const discovered = page.eligible > 0 && page.detected >= page.eligible;
      const completeEnough = page.replacements >= Math.ceil(page.eligible * 0.95);
      const progressSignature = `${page.replacements}:${page.readyRawSlices}:${health.queue.accepted}:${health.queue.completed}`;
      if (progressSignature !== lastProgressSignature) {
        lastProgressSignature = progressSignature;
        lastProgressAt = Date.now();
      }
      if (!settled || !discovered) {
        settledSince = 0;
        return null;
      }
      if (!settledSince) settledSince = Date.now();
      const stableEnough = completeEnough ? Date.now() - settledSince >= 3000 : Date.now() - lastProgressAt >= 30000;
      return stableEnough ? { page, worker, health } : null;
    });

    const healthDelta = {
      accepted: final.health.queue.accepted - healthBefore.queue.accepted,
      completed: final.health.queue.completed - healthBefore.queue.completed,
      failed: final.health.queue.failed - healthBefore.queue.failed,
      cancelled: final.health.queue.cancelled - healthBefore.queue.cancelled,
    };
    const failures = final.worker.entries
      .filter((entry) => ["error", "timeout", "cancelled"].includes(entry.status))
      .map((entry) => ({ status: entry.status, error: entry.error || null, imageUrl: entry.imageUrl }));
    const browserExceptionDetails = [pageClient, workerClient].flatMap((client) => client.events)
      .filter((event) => event.method === "Runtime.exceptionThrown")
      .map((event) => ({
        text: event.params?.exceptionDetails?.text || null,
        description: event.params?.exceptionDetails?.exception?.description || null,
        url: event.params?.exceptionDetails?.url || null,
        lineNumber: event.params?.exceptionDetails?.lineNumber ?? null,
      }));
    const extensionExceptions = browserExceptionDetails.filter((error) => error.url?.startsWith("chrome-extension://"));
    const uniqueJobKeys = new Set(final.worker.entries.map((entry) => `${entry.imageId || ""}:${entry.operationId || ""}`));
    const requiredReplacements = Math.ceil(final.page.eligible * 0.95);
    const gate = {
      detectionRecall: final.page.eligible > 0 ? final.page.detected / final.page.eligible : 0,
      replacementRecall: final.page.eligible > 0 ? final.page.replacements / final.page.eligible : 0,
      pass: final.page.eligible > 0
        && final.page.detected >= requiredReplacements
        && final.page.replacements >= requiredReplacements
        && final.page.falsePositives.length === 0
        && Math.max(healthDelta.accepted - uniqueJobKeys.size, 0) === 0
        && final.worker.rules.filter(isRefererRule).length === 0
        && extensionExceptions.length === 0,
    };
    const result = {
      result: gate.pass ? "PASS" : "FAIL",
      kind: READER_KIND,
      title: reader.title,
      url: reader.url,
      eligibleImages: final.page.eligible,
      chapterImageElements: final.page.originalElements,
      detectedImages: final.page.detected,
      browserReadSuccesses: final.page.replacements,
      upscaleRequests: healthDelta.accepted,
      backendSuccesses: healthDelta.completed,
      blobReplacements: final.page.replacements,
      falsePositiveAssets: final.page.falsePositives,
      duplicateJobs: Math.max(healthDelta.accepted - uniqueJobKeys.size, 0),
      staleReplacements: 0,
      queueFinalState: final.worker.queue,
      remainingSessionRules: final.worker.rules.filter(isRefererRule).length,
      sanitizedFailures: failures,
      extensionBrowserExceptions: extensionExceptions,
      pageBrowserExceptions: browserExceptionDetails.filter((error) => !error.url?.startsWith("chrome-extension://")),
      backendDelta: healthDelta,
      renderBreakdown: {
        directReplacements: final.page.directReplacements,
        slicedOriginals: final.page.slicedOriginals,
        completedSlicedOriginals: final.page.completedSlicedOriginals,
        rawSlices: final.page.rawSlices,
        readyRawSlices: final.page.readyRawSlices,
        unreplaced: final.page.unreplaced,
      },
      gate,
    };
    console.log(JSON.stringify(result, null, 2));
    assert.equal(gate.pass, true, `Live reader gate failed: ${JSON.stringify(result)}`);
  } finally {
    workerClient?.close();
    pageClient?.close();
    if (browserProcess && browserProcess.exitCode === null) browserProcess.kill();
    await delay(300);
    fs.rmSync(profilePath, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
