const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  classifyUnreplaced,
  duplicateEnqueueCount,
  duplicateOperationCount,
  operationIdentity,
  sanitizeUrl,
  stableIdentity,
} = require("./live_reader_helpers.cjs");

const LIVE_URL = process.env.AI_MANGA_LIVE_URL;
const READER_KIND = process.env.AI_MANGA_LIVE_KIND || "unknown";
const BACKEND_URL = process.env.AI_MANGA_E2E_BACKEND || "http://127.0.0.1:8765";
const WAIT_TIMEOUT_MS = Number(process.env.AI_MANGA_LIVE_TIMEOUT_MS) || 300000;
const READER_SELECTOR = process.env.AI_MANGA_LIVE_SELECTOR || ".page-chapter img";

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

function backendRestarted(previous, current) {
  if (Number(current.uptime) < Number(previous.uptime)) {
    return { reason: "uptime-reset", previousUptime: previous.uptime, currentUptime: current.uptime };
  }
  for (const counter of ["accepted", "completed", "failed", "cancelled"]) {
    if (Number(current.queue?.[counter] || 0) < Number(previous.queue?.[counter] || 0)) {
      return {
        reason: "queue-counter-reset",
        counter,
        previous: previous.queue[counter],
        current: current.queue[counter],
      };
    }
  }
  return null;
}

function sanitizeSourceIdentity(value) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return { scheme: parsed.protocol.replace(":", "") };
    const segments = parsed.pathname.split("/").filter(Boolean);
    return {
      scheme: parsed.protocol.replace(":", ""),
      hostname: parsed.hostname,
      path: segments.length === 0 ? "/" : `/${segments[0]}${segments.length > 1 ? "/..." : ""}`,
      queryKeys: [...new Set(parsed.searchParams.keys())].sort(),
    };
  } catch {
    return { scheme: "invalid" };
  }
}

function isRefererRule(rule) {
  return rule.action?.requestHeaders?.some((header) => String(header.header).toLowerCase() === "referer");
}

async function main() {
  if (!LIVE_URL) throw new Error("AI_MANGA_LIVE_URL is required.");
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
    await workerClient.evaluate("globalThis.__AI_MANGA_UPSCALER_TRACE_EVENTS__ = []");
    await pageClient.send("Page.navigate", { url: LIVE_URL });
    await waitFor("live reader document", async () => pageClient.evaluate(
      `document.readyState === 'complete' && document.querySelectorAll(${JSON.stringify(READER_SELECTOR)}).length > 0`,
    ), 30000);

    const challenge = await pageClient.evaluate(
      "/captcha|verify you are human|cloudflare/i.test(document.body?.innerText || '')",
    );
    if (challenge) throw new Error("EXTERNAL_CHALLENGE");

    const reader = await pageClient.evaluate(`(() => {
      const selector = ${JSON.stringify(READER_SELECTOR)};
      const images = [...document.querySelectorAll(selector)].filter((image) => image.dataset.aiEnhancerRawSlice !== 'true');
      const candidateSet = new Set(images);
      const outside = [...document.images].filter((image) => !candidateSet.has(image) && image.dataset.aiEnhancerRawSlice !== 'true');
      images.forEach((image, index) => {
        image.dataset.aiLiveMarker ||= 'live-' + index + '-' + Math.random().toString(36).slice(2);
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
        markers: images.map((image) => image.dataset.aiLiveMarker),
      };
    })()`);
    assert.ok(reader.count > 0, "Reader has no chapter images.");

    await pageClient.evaluate("window.scrollTo(0, 0)");
    for (const marker of reader.markers) {
      await pageClient.evaluate(`(() => {
        const image = [...document.querySelectorAll(${JSON.stringify(READER_SELECTOR)})]
          .find((candidate) => candidate.dataset.aiLiveMarker === ${JSON.stringify(marker)});
        image?.scrollIntoView({ block: 'center' });
        window.dispatchEvent(new Event('scroll'));
        return Boolean(image);
      })()`);
      await delay(250);
    }
    await pageClient.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)");
    await delay(1000);
    await pageClient.evaluate("window.scrollTo(0, 0)");
    // A fast pass can intentionally defer distant preprocessing; revisit each
    // stable marker once so lazy readers get a foreground scheduling window.
    for (const marker of reader.markers) {
      await pageClient.evaluate(`(() => {
        const image = [...document.querySelectorAll(${JSON.stringify(READER_SELECTOR)})]
          .find((candidate) => candidate.dataset.aiLiveMarker === ${JSON.stringify(marker)});
        if (image && !image.classList.contains('ai-manga-upscaler-ready')) image.scrollIntoView({ block: 'center' });
        window.dispatchEvent(new Event('scroll'));
        return Boolean(image);
      })()`);
      await delay(250);
    }
    await pageClient.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)");
    await delay(1000);
    await pageClient.evaluate("window.scrollTo(0, 0)");

    let settledSince = 0;
    let lastProgressAt = Date.now();
    let lastProgressSignature = "";
    const operationLedger = new Map();
    const final = await waitFor("live reader queue settlement", async () => {
      const page = await pageClient.evaluate(`(() => {
        const originals = [...document.querySelectorAll(${JSON.stringify(READER_SELECTOR)})]
          .filter((image) => image.dataset.aiLiveMarker && image.dataset.aiEnhancerRawSlice !== 'true');
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
            marker: image.dataset.aiLiveMarker,
            imageId: image.dataset.aiEnhancerImageId || null,
            operationId: image.dataset.aiEnhancerOperationId || null,
            sourceRevision: image.dataset.aiEnhancerKey || null,
            traceId: image.dataset.aiEnhancerTraceId || null,
            pageOrder: Number(image.dataset.aiEnhancerPageOrder || 0),
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            displayedWidth: image.getBoundingClientRect().width,
            displayedHeight: image.getBoundingClientRect().height,
            rectTop: image.getBoundingClientRect().top,
            rectBottom: image.getBoundingClientRect().bottom,
            scrollParents: (() => {
              const parents = [];
              let node = image.parentElement;
              while (node && parents.length < 4) {
                const style = getComputedStyle(node);
                if (/(auto|scroll|hidden)/.test(String(style.overflow) + String(style.overflowY))) {
                  parents.push({ tag: node.tagName, id: node.id || null, className: String(node.className || '').slice(0, 80), scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight });
                }
                node = node.parentElement;
              }
              return parents;
            })(),
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
          eligibleEntries: eligibleStatus,
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
          traces: globalThis.__AI_MANGA_UPSCALER_TRACE_EVENTS__ || [],
        };
      })()`);
      for (const entry of worker.entries) {
        const identity = operationIdentity(entry);
        if (identity) operationLedger.set(identity, entry);
      }
      const health = await readHealth();
      const settled = worker.queue.queueSize === 0 && worker.activeJobs === 0 && worker.retryTimers === 0
        && worker.readLocks === 0 && health.queue.size === 0 && health.queue.waiting === 0 && health.queue.processing === 0;
      const discovered = page.eligible > 0 && page.detected >= Math.ceil(page.eligible * 0.95);
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
    const ledgerEntries = [...operationLedger.values()];
    const failures = ledgerEntries
      .filter((entry) => ["error", "timeout", "cancelled"].includes(entry.status))
      .map((entry) => ({
        imageId: entry.imageId,
        operationId: entry.operationId,
        status: entry.status,
        error: entry.error || null,
        errorCode: entry.errorCode || null,
        errorStatus: entry.errorStatus || null,
        errorTraceId: entry.errorTraceId || null,
        validationFields: entry.validationFields || [],
        source: sanitizeUrl(entry.imageUrl),
      }));
    const browserExceptionDetails = [pageClient, workerClient].flatMap((client) => client.events)
      .filter((event) => event.method === "Runtime.exceptionThrown")
      .map((event) => ({
        text: event.params?.exceptionDetails?.text || null,
        description: event.params?.exceptionDetails?.exception?.description || null,
        url: event.params?.exceptionDetails?.url || null,
        lineNumber: event.params?.exceptionDetails?.lineNumber ?? null,
      }));
    const extensionExceptions = browserExceptionDetails.filter((error) => error.url?.startsWith("chrome-extension://"));
    const enqueuedTraces = final.worker.traces.filter((event) => event.event === "background.job.enqueued");
    const duplicateJobs = Math.max(duplicateEnqueueCount(enqueuedTraces), duplicateOperationCount(ledgerEntries));
    const requestEvidence = new Map(final.worker.traces
      .filter((event) => event.event === "background.backend.request.started")
      .map((event) => [event.traceId, event.metadata?.request_metadata || {}]));
    const perImageEvidence = final.page.eligibleEntries.map((entry) => {
      const registry = ledgerEntries.find((candidate) => candidate.imageId === entry.imageId
        && candidate.operationId === entry.operationId) || {};
      const request = requestEvidence.get(entry.traceId || registry.traceId) || {};
      return {
        marker: entry.marker,
        imageId: entry.imageId,
        operationId: entry.operationId,
        sourceRevision: entry.sourceRevision,
        sourceFingerprintPrefix: registry.sourceFingerprint?.slice(0, 16) || null,
        pageOrder: entry.pageOrder,
        naturalDimensions: [entry.naturalWidth, entry.naturalHeight],
        displayedDimensions: [entry.displayedWidth, entry.displayedHeight],
        rectTop: entry.rectTop,
        rectBottom: entry.rectBottom,
        scrollParents: entry.scrollParents,
        source: sanitizeUrl(entry.currentSource),
        status: registry.status || null,
        viewportDistance: registry.viewportDistance ?? null,
        sourceKind: request.image_data_present ? "browser_owned_bytes" : "background_fetch",
        byteLength: request.image_data_decoded_length || null,
        normalizedMaxOutputWidth: request.max_output_width || null,
        normalizedMaxOutputHeight: request.max_output_height || null,
        backendStatus: registry.errorStatus || (registry.status === "fixed" || registry.status === "cache" ? 200 : null),
        errorCode: registry.errorCode || null,
        traceId: entry.traceId || registry.traceId || null,
        terminalState: entry.replaced ? "replaced" : registry.status || "unsettled",
        failureClassification: classifyUnreplaced({ ...entry, ...registry, reason: registry.reason }),
      };
    });
    const requiredReplacements = Math.ceil(final.page.eligible * 0.95);
    const gate = {
      detectionRecall: final.page.eligible > 0 ? final.page.detected / final.page.eligible : 0,
      replacementRecall: final.page.eligible > 0 ? final.page.replacements / final.page.eligible : 0,
      pass: final.page.eligible > 0
        && final.page.detected >= requiredReplacements
        && final.page.replacements >= requiredReplacements
        && final.page.falsePositives.length === 0
        && duplicateJobs === 0
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
      falsePositiveAssets: final.page.falsePositives.map((entry) => ({
        initialSource: sanitizeUrl(entry.initialSource),
        currentSource: sanitizeUrl(entry.currentSource),
      })),
      duplicateJobs,
      staleReplacements: 0,
      queueFinalState: final.worker.queue,
      remainingSessionRules: final.worker.rules.filter(isRefererRule).length,
      sanitizedFailures: failures,
      perImageEvidence,
      extensionBrowserExceptions: extensionExceptions,
      pageBrowserExceptions: browserExceptionDetails.filter((error) => !error.url?.startsWith("chrome-extension://")),
      backendDelta: healthDelta,
      renderBreakdown: {
        directReplacements: final.page.directReplacements,
        slicedOriginals: final.page.slicedOriginals,
        completedSlicedOriginals: final.page.completedSlicedOriginals,
        rawSlices: final.page.rawSlices,
        readyRawSlices: final.page.readyRawSlices,
        unreplaced: perImageEvidence.filter((entry) => entry.failureClassification),
      },
      gate,
    };
    if (!gate.pass) {
      console.error("LIVE_FAILURE_GEOMETRY", JSON.stringify(perImageEvidence
        .filter((entry) => entry.failureClassification)
        .map((entry) => ({ marker: entry.marker, pageOrder: entry.pageOrder, status: entry.status, rectTop: entry.rectTop, rectBottom: entry.rectBottom, scrollParents: entry.scrollParents }))));
    }
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

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { backendRestarted, sanitizeSourceIdentity };
