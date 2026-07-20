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
    this.events = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("Unable to connect to browser CDP.")), { once: true });
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
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("CDP target disconnected."));
      this.pending.clear();
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

async function browserWebSocketUrl(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!response.ok) throw new Error(`CDP version endpoint returned HTTP ${response.status}.`);
  return (await response.json()).webSocketDebuggerUrl;
}

async function waitForExtensionWorker(port, previousTargetId = null) {
  return waitFor("unpacked extension service worker", async () => {
    const targets = await listTargets(port);
    return targets.find((target) => (
      target.type === "service_worker" && target.url.endsWith("/src/background.js") && target.id !== previousTargetId
    )) || null;
  }, 20000);
}

async function waitForServiceWorkerVersion(cdpClient, targetId) {
  return waitFor("extension service-worker version", async () => {
    const versions = cdpClient.events
      .filter((event) => event.method === "ServiceWorker.workerVersionUpdated")
      .flatMap((event) => event.params?.versions || []);
    return [...versions].reverse().find((version) => (
      version.targetId === targetId && version.runningStatus === "running"
    )) || null;
  }, 20000);
}

async function connectTarget(target) {
  assert.ok(target?.webSocketDebuggerUrl, `Target ${target?.url || "unknown"} is not directly debuggable.`);
  const client = await new CdpClient(target.webSocketDebuggerUrl).open();
  await client.send("Runtime.enable");
  return client;
}

async function readWorkerState(client, pageUrl) {
  return client.evaluate(`(async () => {
    const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} });
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    return {
      tabId: tab?.id ?? null,
      rules,
      queue: scheduler.snapshot(),
      registry: tab?.id ? pageImageRegistry.list(tab.id) : [],
      activeJobs: scheduler.active.size,
      pendingJobs: scheduler.pending.size,
      activeKeys: [...scheduler.active.keys()],
      pendingKeys: [...scheduler.pending.keys()],
      retryTimers: scheduler.retryTimers.size,
      imageReadLocks: upscaleProvider.imageReadLocks.size,
    };
  })()`);
}

function refererRules(rules) {
  return rules.filter((rule) => rule.action?.requestHeaders?.some(
    (header) => String(header.header).toLowerCase() === "referer",
  ));
}

async function waitForSettledWorkerState(client, pageUrl) {
  return waitFor("worker queue and registry settlement", async () => {
    const state = await readWorkerState(client, pageUrl);
    return state.queue.queueSize === 0 && state.activeJobs === 0 && state.pendingJobs === 0
      && state.retryTimers === 0 && state.imageReadLocks === 0 ? state : null;
  });
}

async function pageImageState(pageClient, selector) {
  return pageClient.evaluate(`(() => {
    const image = document.querySelector(${JSON.stringify(selector)});
    return image ? {
      src: image.src,
      ready: image.classList.contains('ai-manga-upscaler-ready'),
      imageId: image.dataset.aiEnhancerImageId || null,
      matches: document.querySelectorAll(${JSON.stringify(selector)}).length,
      contentInstance: document.documentElement.dataset.aiMangaUpscalerInstance || null,
    } : null;
  })()`);
}

async function readReloadDiagnostics(workerClient, pageUrl, pageClient) {
  const worker = await workerClient.evaluate(`(async () => {
    const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} });
    let ping = null;
    try {
      ping = tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: 'AI_ENHANCER_PING' }) : null;
    } catch (error) {
      ping = { error: error?.message || String(error) };
    }
    return {
      tabId: tab?.id ?? null,
      enabled: (await chrome.storage.local.get({ enabled: true })).enabled,
      ping,
      queue: scheduler.snapshot(),
      registry: tab?.id ? pageImageRegistry.list(tab.id) : [],
      rules: await chrome.declarativeNetRequest.getSessionRules(),
    };
  })()`);
  const page = await pageClient.evaluate(`(() => {
    const image = document.querySelector('#lifecycle-primary');
    return {
      readyState: document.readyState,
      lifecycleCase: document.body?.dataset.lifecycleCase || null,
      imageSrc: image?.src || null,
      imageReady: image?.classList.contains('ai-manga-upscaler-ready') || false,
      observed: image?.dataset.aiMangaUpscalerObserved || null,
      seen: image?.dataset.aiEnhancerSeen || null,
    };
  })()`);
  return { worker, page };
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
  let browserClient = null;
  let dashboardClient = null;
  let geometryClient = null;
  let lookaheadClient = null;
  const workerClients = [];

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

    browserClient = await new CdpClient(await browserWebSocketUrl(port)).open();
    const extensionWorker = await waitForExtensionWorker(port);
    assert.ok(extensionWorker.url.startsWith("chrome-extension://"));
    const initialWorkerClient = await connectTarget(extensionWorker);

    const targets = await listTargets(port);
    const pageTarget = targets.find((target) => target.type === "page" && target.url === "about:blank")
      || targets.find((target) => target.type === "page");
    assert.ok(pageTarget?.webSocketDebuggerUrl, "A controllable page target is required.");
    pageClient = await new CdpClient(pageTarget.webSocketDebuggerUrl).open();
    await pageClient.send("Page.enable");
    await pageClient.send("Runtime.enable");
    await pageClient.send("ServiceWorker.enable");
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
    const monitorState = await initialWorkerClient.evaluate("processingMonitor.snapshot()");
    const dashboardEvidence = {};
    const completedMonitorJobs = monitorState.jobs.filter((job) => job.stage === "COMPLETED");
    assert.ok(completedMonitorJobs.length >= 2, "monitor must record DOM-committed completions");
    assert.ok(completedMonitorJobs.every((job) => job.renderCommit?.confirmed === true), "monitor completion must include renderer confirmation");
    assert.equal(JSON.stringify(monitorState).includes("imageData"), false, "monitor snapshot must exclude image bytes");

    const retrySource = completedMonitorJobs[0];
    const dashboardSeed = await initialWorkerClient.evaluate(`(async () => {
      processingMonitor.clearTerminal();
      const tabId = ${JSON.stringify(retrySource.tabId)};
      const now = Date.now() - 10000;
      let sequence = 0;
      const emit = (identity, stage, extra = {}) => processingMonitor.ingest(AI_PROCESSING_MONITOR.createEvent({
        tabId,
        imageId: identity.imageId,
        operationId: identity.operationId,
        jobId: identity.jobId || tabId + ':' + identity.imageId + ':' + identity.operationId,
        traceId: identity.traceId,
        sourceUrl: identity.sourceUrl || 'https://cdn.example.test/chapter/page.jpg?token=secret&part=1',
        sourceFingerprint: identity.sourceFingerprint || 'sha256-dashboard-fixture',
        stage,
        timestamp: new Date(now + (++sequence * 10)).toISOString(),
        mode: extra.mode || 'manga',
        provider: extra.provider || 'DmlExecutionProvider',
        model: extra.model || 'anime_x4',
        cache: extra.cache || 'MISS',
        retryCount: extra.retryCount || 0,
        input: extra.input || { width: 900, height: 1400, mime: 'image/jpeg', sourceKind: 'browser-owned-bytes' },
        output: extra.output || null,
        renderCommit: extra.renderCommit || null,
        error: extra.error || null,
        metadata: extra.metadata || {},
      }));
      const lifecycle = (identity, terminal, extra = {}) => {
        for (const stage of ['DETECTED', 'READING_SOURCE', 'VALIDATING_SOURCE', 'QUEUED', 'SENDING_TO_BACKEND']) emit(identity, stage, extra);
        if (terminal === 'COMPLETED') {
          emit(identity, 'RECEIVING_RESULT', extra);
          emit(identity, 'PREPARING_RENDER', extra);
          emit(identity, 'RENDERING', extra);
          emit(identity, 'COMPLETED', { ...extra, renderCommit: { confirmed: true, committedAt: new Date(now + (++sequence * 10)).toISOString() }, output: { width: 1800, height: 2800, mime: 'image/webp', byteLength: 123456 } });
        } else {
          emit(identity, terminal, extra);
        }
      };
      lifecycle({ imageId: 'dash-completed', operationId: 'dash-completed-op', traceId: 'trace-dashboard-completed' }, 'COMPLETED');
      lifecycle({ imageId: 'dash-cache', operationId: 'dash-cache-op', traceId: 'trace-dashboard-cache' }, 'COMPLETED', { cache: 'HIT' });
      lifecycle({ imageId: ${JSON.stringify(retrySource.imageId)}, operationId: ${JSON.stringify(retrySource.operationId)}, traceId: ${JSON.stringify(retrySource.traceId)} }, 'FAILED', {
        error: { errorCode: 'BACKEND_UNAVAILABLE', category: 'NETWORK', message: 'Temporary backend outage.', status: 503, retryable: true },
      });
      lifecycle({ imageId: 'dash-422', operationId: 'dash-422-op', traceId: 'trace-dashboard-422' }, 'FAILED', {
        error: { errorCode: 'REQUEST_VALIDATION_FAILED', category: 'BACKEND_CONTRACT', message: 'Output width is below backend minimum.', status: 422, field: 'maxOutputWidth', retryable: false },
      });
      emit({ imageId: 'dash-cancelled', operationId: 'dash-cancelled-op', traceId: 'trace-dashboard-cancelled' }, 'DETECTED');
      emit({ imageId: 'dash-cancelled', operationId: 'dash-cancelled-op', traceId: 'trace-dashboard-cancelled' }, 'CANCELLED', {
        error: { errorCode: 'JOB_CANCELLED', category: 'CANCELLATION', message: 'Cancelled fixture.', retryable: true },
      });
      emit({ imageId: 'dash-timeout', operationId: 'dash-timeout-op', traceId: 'trace-dashboard-timeout' }, 'DETECTED');
      emit({ imageId: 'dash-timeout', operationId: 'dash-timeout-op', traceId: 'trace-dashboard-timeout' }, 'TIMED_OUT', {
        error: { errorCode: 'PROCESSING_TIMEOUT', category: 'TIMEOUT', message: 'Timed out fixture.', status: 504, retryable: true },
      });
      const cancelJob = {
        tabId, imageId: 'dash-active-cancel', operationId: 'dash-active-cancel-op', traceId: 'trace-dashboard-active-cancel',
        queueKey: tabId + ':dash-active-cancel:dash-active-cancel-op', attempt: 1, imageUrl: 'https://cdn.example.test/chapter/slow.jpg?token=private',
        sourceFingerprint: 'sha256-dashboard-cancel', mode: 'manga', pageOrder: 99, viewportDistance: 0,
      };
      emit(cancelJob, 'DETECTED');
      emit(cancelJob, 'READING_SOURCE');
      emit(cancelJob, 'VALIDATING_SOURCE');
      emit(cancelJob, 'QUEUED');
      globalThis.__dashboardBackendCancelCalls = 0;
      const cancelBackendJob = upscaleProvider.cancel.bind(upscaleProvider);
      upscaleProvider.cancel = (jobId) => {
        globalThis.__dashboardBackendCancelCalls += 1;
        return cancelBackendJob(jobId);
      };
      scheduler.active.set(cancelJob.queueKey, { ...cancelJob, abortController: new AbortController() });
      pageImageRegistry.update(tabId, cancelJob.imageId, { operationId: cancelJob.operationId, status: 'waiting' });
      await persistProcessingMonitor();
      return processingMonitor.snapshot();
    })()`);
    assert.equal(dashboardSeed.summary.completed, 2);
    assert.equal(dashboardSeed.summary.failed, 2);
    assert.equal(dashboardSeed.summary.cancelled, 1);
    assert.equal(dashboardSeed.summary.timedOut, 1);
    assert.equal(dashboardSeed.summary.queued, 1);
    assert.equal(dashboardSeed.summary.cacheHits, 1);

    const dashboardUrl = new URL("../dashboard.html", extensionWorker.url);
    dashboardUrl.searchParams.set("tabId", String(retrySource.tabId));
    const createdDashboard = await browserClient.send("Target.createTarget", { url: dashboardUrl.href });
    const dashboardTarget = await waitFor("extension Dashboard target", async () => {
      const currentTargets = await listTargets(port);
      return currentTargets.find((target) => target.id === createdDashboard.targetId && target.webSocketDebuggerUrl) || null;
    }, 20000);
    dashboardClient = await connectTarget(dashboardTarget);
    await dashboardClient.send("Page.enable");
    await waitFor("Dashboard monitor render", async () => dashboardClient.evaluate(
      "document.readyState === 'complete' && document.querySelectorAll('#monitorSummary article').length === 13 && document.querySelectorAll('#monitorJobs tr').length >= 7",
    ), 20000);

    const dashboardObservedSnapshot = await initialWorkerClient.evaluate("processingMonitor.snapshot()");
    const dashboardState = await dashboardClient.evaluate(`(() => ({
      summary: Object.fromEntries([...document.querySelectorAll('#monitorSummary article')].map((card) => [card.querySelector('span')?.textContent, card.querySelector('strong')?.textContent])),
      rows: [...document.querySelectorAll('#monitorJobs tr')].map((row) => ({ key: row.dataset.key, text: row.textContent, status: row.children[2]?.textContent, actions: [...row.querySelectorAll('[data-action]')].map((item) => item.dataset.action) })),
      containsImageData: document.documentElement.outerHTML.includes('imageData'),
    }))()`);
    assert.equal(Number(dashboardState.summary.Completed), dashboardObservedSnapshot.summary.completed);
    assert.equal(Number(dashboardState.summary.Failed), dashboardObservedSnapshot.summary.failed);
    assert.equal(Number(dashboardState.summary.Cancelled), dashboardObservedSnapshot.summary.cancelled);
    assert.equal(Number(dashboardState.summary["Timed out"]), dashboardObservedSnapshot.summary.timedOut);
    assert.equal(Number(dashboardState.summary.Queued), dashboardObservedSnapshot.summary.queued);
    assert.equal(Number(dashboardState.summary["Cache hits"]), dashboardObservedSnapshot.summary.cacheHits);
    assert.ok(dashboardState.rows.every((row) => row.status), "Dashboard status must be visible as text");
    assert.equal(dashboardState.containsImageData, false);

    const detailToggleState = await dashboardClient.evaluate(`(() => {
      const layout = document.getElementById('monitorLayout');
      const detail = document.getElementById('monitorDetail');
      const toggle = document.getElementById('toggleMonitorDetail');
      const detailText = detail.textContent;
      toggle.click();
      const collapsed = {
        hidden: detail.hidden,
        layoutState: layout.dataset.detailCollapsed,
        expanded: toggle.getAttribute('aria-expanded'),
        label: toggle.textContent,
        detailPreserved: detail.textContent === detailText,
      };
      toggle.click();
      return {
        collapsed,
        restored: {
          hidden: detail.hidden,
          layoutState: layout.dataset.detailCollapsed,
          expanded: toggle.getAttribute('aria-expanded'),
          label: toggle.textContent,
          detailPreserved: detail.textContent === detailText,
        },
      };
    })()`);
    assert.deepEqual(detailToggleState.collapsed, {
      hidden: true,
      layoutState: "true",
      expanded: "false",
      label: "Show details",
      detailPreserved: true,
    });
    assert.deepEqual(detailToggleState.restored, {
      hidden: false,
      layoutState: "false",
      expanded: "true",
      label: "Hide details",
      detailPreserved: true,
    });

    const completedFilter = await dashboardClient.evaluate(`(() => {
      const select = document.getElementById('monitorStatusFilter');
      select.value = 'COMPLETED';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return [...document.querySelectorAll('#monitorJobs tr')].map((row) => row.dataset.key);
    })()`);
    assert.equal(completedFilter.length, dashboardObservedSnapshot.summary.completed);
    const compoundFilter = await dashboardClient.evaluate(`(() => {
      const status = document.getElementById('monitorStatusFilter');
      const stage = document.getElementById('monitorStageFilter');
      const site = document.getElementById('monitorSiteFilter');
      const tab = document.getElementById('monitorTabFilter');
      status.value = 'FAILED'; status.dispatchEvent(new Event('change', { bubbles: true }));
      stage.value = 'FAILED'; stage.dispatchEvent(new Event('change', { bubbles: true }));
      site.value = 'cdn.example.test'; site.dispatchEvent(new Event('change', { bubbles: true }));
      tab.value = ${JSON.stringify(String(retrySource.tabId))}; tab.dispatchEvent(new Event('change', { bubbles: true }));
      return [...document.querySelectorAll('#monitorJobs tr')].map((row) => row.dataset.key);
    })()`);
    assert.equal(compoundFilter.length, 2);
    const searchResult = await dashboardClient.evaluate(`(() => {
      document.getElementById('monitorStatusFilter').value = 'ALL';
      document.getElementById('monitorStatusFilter').dispatchEvent(new Event('change', { bubbles: true }));
      for (const id of ['monitorStageFilter', 'monitorSiteFilter', 'monitorTabFilter', 'monitorModeFilter', 'monitorProviderFilter', 'monitorCacheFilter']) {
        const select = document.getElementById(id);
        select.value = 'ALL';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const input = document.getElementById('monitorSearchFilter');
      input.value = 'trace-dashboard-422';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return [...document.querySelectorAll('#monitorJobs tr')].map((row) => row.dataset.key);
    })()`);
    assert.deepEqual(searchResult, [String(retrySource.tabId) + ':dash-422:dash-422-op']);
    const detailState = await dashboardClient.evaluate(`(() => {
      document.querySelector('#monitorJobs tr')?.click();
      return { text: document.getElementById('monitorDetail').textContent, retryVisible: Boolean(document.querySelector('#monitorJobs [data-action="retry"]')) };
    })()`);
    assert.match(detailState.text, /REQUEST_VALIDATION_FAILED/);
    assert.match(detailState.text, /maxOutputWidth/);
    assert.match(detailState.text, /cdn\.example\.test\/chapter\/page\.jpg \?part, token/);
    assert.doesNotMatch(detailState.text, /secret|token=|private/);
    assert.equal(detailState.retryVisible, false, "HTTP 422 must not expose Retry");

    const retryStarted = await dashboardClient.evaluate(`(() => {
      document.getElementById('monitorSearchFilter').value = '';
      document.getElementById('monitorSearchFilter').dispatchEvent(new Event('input', { bubbles: true }));
      for (const id of ['monitorStageFilter', 'monitorSiteFilter', 'monitorTabFilter', 'monitorModeFilter', 'monitorProviderFilter', 'monitorCacheFilter']) {
        const select = document.getElementById(id);
        select.value = 'ALL';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const row = document.querySelector('tr[data-key="${retrySource.tabId}:${retrySource.imageId}:${retrySource.operationId}"]');
      const button = row?.querySelector('[data-action="retry"]');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(retryStarted, true, "Retryable failure must expose a Retry action");
    const retryRecord = await waitFor("Dashboard retry attempt", async () => initialWorkerClient.evaluate(`(() => {
      const operationId = processingMonitor.currentOperation(${retrySource.tabId}, ${JSON.stringify(retrySource.imageId)});
      if (!operationId || operationId === ${JSON.stringify(retrySource.operationId)}) return null;
      const job = processingMonitor.get(${retrySource.tabId}, ${JSON.stringify(retrySource.imageId)}, operationId);
      return job?.retryCount === 1 && job.parentJobId === ${JSON.stringify(retrySource.key)} ? job : null;
    })()`), 20000);
    assert.notEqual(retryRecord.operationId, retrySource.operationId);
    const originalRetryRecord = await initialWorkerClient.evaluate(`processingMonitor.get(${retrySource.tabId}, ${JSON.stringify(retrySource.imageId)}, ${JSON.stringify(retrySource.operationId)})`);
    assert.equal(originalRetryRecord.stage, "FAILED");
    await waitFor("retried image queue settlement", async () => {
      const health = await readHealth();
      const worker = await initialWorkerClient.evaluate("({ queue: scheduler.snapshot(), active: scheduler.active.size, pending: scheduler.pending.size })");
      return health.queue.size === 0 && health.queue.waiting === 0 && health.queue.processing === 0 && worker.active === 1 && worker.pending === 0 ? true : null;
    }, 30000);
    const retryDomState = await pageClient.evaluate(`(() => ({
      matches: document.querySelectorAll('#eligible-static').length,
      ready: document.querySelector('#eligible-static')?.classList.contains('ai-manga-upscaler-ready') || false,
      src: document.querySelector('#eligible-static')?.src || null,
    }))()`);
    assert.equal(retryDomState.matches, 1);
    assert.equal(retryDomState.ready, true);
    assert.match(retryDomState.src, /^blob:/);

    await dashboardClient.evaluate(`(() => {
      document.getElementById('monitorSearchFilter').value = '';
      document.getElementById('monitorSearchFilter').dispatchEvent(new Event('input', { bubbles: true }));
      for (const id of ['monitorStatusFilter', 'monitorStageFilter', 'monitorSiteFilter', 'monitorTabFilter', 'monitorModeFilter', 'monitorProviderFilter', 'monitorCacheFilter']) {
        const select = document.getElementById(id);
        select.value = 'ALL';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.querySelector('tr[data-key="${retrySource.tabId}:dash-active-cancel:dash-active-cancel-op"] [data-action="cancel"]').click();
      return true;
    })()`);
    const cancelledFromDashboard = await waitFor("Dashboard cancellation", async () => initialWorkerClient.evaluate(`(() => {
      const job = processingMonitor.get(${retrySource.tabId}, 'dash-active-cancel', 'dash-active-cancel-op');
      return job?.stage === 'CANCELLED' && !scheduler.active.has('${retrySource.tabId}:dash-active-cancel:dash-active-cancel-op') && globalThis.__dashboardBackendCancelCalls === 1 ? job : null;
    })()`), 20000);
    assert.equal(cancelledFromDashboard.stage, "CANCELLED");
    assert.equal(cancelledFromDashboard.timeline.some((event) => event.stage === "COMPLETED"), false);

    const exported = await dashboardClient.evaluate(`(async () => {
      window.__dashboardExport = null;
      URL.createObjectURL = (blob) => { blob.text().then((text) => { window.__dashboardExport = text; }); return 'blob:dashboard-export'; };
      HTMLAnchorElement.prototype.click = function click() {};
      document.getElementById('exportMonitor').click();
      for (let index = 0; index < 100 && !window.__dashboardExport; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      return window.__dashboardExport;
    })()`);
    const exportedDiagnostic = JSON.parse(exported);
    assert.equal(exportedDiagnostic.schemaVersion, 1);
    assert.ok(exportedDiagnostic.jobs.some((job) => job.error?.field === "maxOutputWidth"));
    assert.equal(/imageData|Authorization|cookie|token=secret|browserprofile|requestbody|responsebody/i.test(exported), false);

    await dashboardClient.evaluate("document.getElementById('clearMonitorCompleted').click()");
    await waitFor("clear completed history", async () => initialWorkerClient.evaluate(`(() => {
      const snapshot = processingMonitor.snapshot();
      return snapshot.summary.completed === 0 && snapshot.summary.failed === 2 ? snapshot : null;
    })()`), 20000);

    await dashboardClient.send("Page.reload");
    await waitFor("Dashboard reload recovery", async () => dashboardClient.evaluate(
      "document.readyState === 'complete' && document.querySelectorAll('#monitorJobs tr').length >= 5 && !document.body.textContent.includes('dash-completed')",
    ), 20000);

    const heapBefore = await dashboardClient.evaluate("performance.memory?.usedJSHeapSize || 0");
    const loadSeed = await initialWorkerClient.evaluate(`(async () => {
      const started = performance.now();
      for (let index = 0; index < 500; index += 1) {
        processingMonitor.ingest(AI_PROCESSING_MONITOR.createEvent({
          tabId: ${retrySource.tabId}, imageId: 'load-' + index, operationId: 'load-op-' + index,
          traceId: 'trace-load-' + index, sourceUrl: 'https://load.example.test/chapter/page-' + index + '.jpg?token=hidden',
          stage: 'DETECTED', mode: index % 2 ? 'manga' : 'auto', provider: 'DmlExecutionProvider',
          input: { width: 900, height: 1400, mime: 'image/jpeg', sourceKind: 'fixture' },
        }));
      }
      await persistProcessingMonitor();
      return { elapsedMs: performance.now() - started, snapshot: processingMonitor.snapshot() };
    })()`);
    assert.equal(loadSeed.snapshot.jobs.filter((job) => job.imageId.startsWith("load-")).length, 500);
    const dashboardLoad = await dashboardClient.evaluate(`(async () => {
      const refreshStarted = performance.now();
      document.getElementById('refreshMonitor').click();
      for (let index = 0; index < 300 && document.querySelectorAll('#monitorJobs tr').length < 500; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      const renderMs = performance.now() - refreshStarted;
      const filterStarted = performance.now();
      const status = document.getElementById('monitorStatusFilter');
      status.value = 'ACTIVE';
      status.dispatchEvent(new Event('change', { bubbles: true }));
      const filterMs = performance.now() - filterStarted;
      const detailStarted = performance.now();
      document.querySelector('#monitorJobs tr')?.click();
      const detailMs = performance.now() - detailStarted;
      return { renderMs, filterMs, detailMs, rows: document.querySelectorAll('#monitorJobs tr').length };
    })()`);
    const heapAfter = await dashboardClient.evaluate("performance.memory?.usedJSHeapSize || 0");
    assert.ok(dashboardLoad.rows >= 500, "Dashboard must render all 500 synthetic active jobs");
    assert.ok(dashboardLoad.renderMs < 3000, `Dashboard 500-job render took ${dashboardLoad.renderMs} ms`);
    assert.ok(dashboardLoad.filterMs < 3000, `Dashboard filter took ${dashboardLoad.filterMs} ms`);
    assert.ok(dashboardLoad.detailMs < 3000, `Dashboard detail took ${dashboardLoad.detailMs} ms`);
    if (heapBefore && heapAfter) assert.ok(heapAfter - heapBefore < 128 * 1024 * 1024, "Dashboard heap growth must remain bounded");
    dashboardEvidence.summary = dashboardSeed.summary;
    dashboardEvidence.filters = { completedRows: completedFilter.length, compoundRows: compoundFilter.length, searchRows: searchResult.length };
    dashboardEvidence.retry = { oldOperation: retrySource.operationId, newOperation: retryRecord.operationId, retryCount: retryRecord.retryCount, linkedParent: retryRecord.parentJobId === retrySource.key };
    dashboardEvidence.cancel = { stage: cancelledFromDashboard.stage, backendCancelCalls: 1 };
    dashboardEvidence.exportSanitized = true;
    dashboardEvidence.reloadRecovered = true;
    dashboardEvidence.detailToggle = detailToggleState;
    dashboardEvidence.load = { syntheticJobs: 500, renderedRows: dashboardLoad.rows, renderMs: Math.round(dashboardLoad.renderMs), filterMs: Math.round(dashboardLoad.filterMs), detailMs: Math.round(dashboardLoad.detailMs), heapGrowthBytes: heapBefore && heapAfter ? heapAfter - heapBefore : null };

    dashboardClient.close();
    dashboardClient = null;
    await browserClient.send("Target.closeTarget", { targetId: createdDashboard.targetId });

    await initialWorkerClient.evaluate("chrome.storage.local.set({ imageSliceMaxWidth: 1024, imageSliceMaxHeight: 2200, maxInputWidthEnabled: false })");
    const geometryTargetCreated = await browserClient.send("Target.createTarget", { url: `${fixture.origin}/geometry-e2e` });
    const geometryTarget = await waitFor("extreme geometry fixture target", async () => {
      const currentTargets = await listTargets(port);
      return currentTargets.find((target) => target.id === geometryTargetCreated.targetId && target.webSocketDebuggerUrl) || null;
    }, 20000);
    geometryClient = await connectTarget(geometryTarget);
    await geometryClient.send("Page.enable");
    const geometryState = await waitFor("real 768x32768 DOM render", async () => geometryClient.evaluate(`(() => {
      const image = document.querySelector('#eligible-extreme');
      const wrapper = image?.previousElementSibling?.classList.contains('ai-enhancer-slice-wrapper') ? image.previousElementSibling : null;
      const rawSlices = wrapper ? [...wrapper.querySelectorAll('img.ai-enhancer-raw-slice')] : [];
      const direct = Boolean(image?.classList.contains('ai-manga-upscaler-ready') && image.src.startsWith('blob:'));
      const sliced = Boolean(image?.dataset.aiEnhancerSliced === 'true' && rawSlices.length > 1 && rawSlices.every((raw) => raw.classList.contains('ai-manga-upscaler-ready') && raw.src.startsWith('blob:')));
      return image && (direct || sliced) ? {
        width: image.naturalWidth,
        height: image.naturalHeight,
        direct,
        sliced,
        rawSlices: rawSlices.length,
        readyRawSlices: rawSlices.filter((raw) => raw.classList.contains('ai-manga-upscaler-ready')).length,
        imageCount: document.querySelectorAll('#eligible-extreme').length,
      } : null;
    })()`), 180000);
    assert.equal(geometryState.width, 768);
    assert.equal(geometryState.height, 32768);
    assert.equal(geometryState.imageCount, 1);
    assert.equal(geometryState.direct, false, "768x32768 must use vertical slicing in the browser");
    assert.equal(geometryState.sliced, true);
    assert.equal(geometryState.readyRawSlices, geometryState.rawSlices);
    const wideGeometryState = await waitFor("real 2048x1200 grid DOM render", async () => geometryClient.evaluate(`(() => {
      const image = document.querySelector('#eligible-wide');
      const wrapper = image?.previousElementSibling?.classList.contains('ai-enhancer-slice-wrapper') ? image.previousElementSibling : null;
      const rawSlices = wrapper ? [...wrapper.querySelectorAll('img.ai-enhancer-raw-slice')] : [];
      if (image?.dataset.aiEnhancerSliced !== 'true' || rawSlices.length !== 2 || !rawSlices.every((raw) => raw.classList.contains('ai-manga-upscaler-ready') && raw.src.startsWith('blob:'))) return null;
      const wrapperRect = wrapper.getBoundingClientRect();
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        rawSlices: rawSlices.length,
        positions: rawSlices.map((raw) => {
          const rect = raw.getBoundingClientRect();
          return { left: raw.style.left, top: raw.style.top, width: raw.style.width, position: raw.style.position, renderedLeft: Math.round(rect.left - wrapperRect.left), renderedWidth: Math.round(rect.width) };
        }),
        wrapperPosition: wrapper.style.position,
        wrapperHidden: wrapper.hidden,
        wrapperWidth: Math.round(wrapperRect.width),
        parentDisplay: image.style.display,
      };
    })()`), 180000);
    assert.equal(wideGeometryState.width, 2048);
    assert.equal(wideGeometryState.height, 1200);
    assert.equal(wideGeometryState.wrapperPosition, "relative");
    assert.equal(wideGeometryState.wrapperHidden, false);
    assert.equal(wideGeometryState.parentDisplay, "none");
    assert.deepEqual(wideGeometryState.positions.map((item) => item.left), ["0%", "50%"]);
    assert.deepEqual(wideGeometryState.positions.map((item) => item.width), ["50%", "50%"]);
    assert.deepEqual(wideGeometryState.positions.map((item) => item.renderedLeft), [0, Math.round(wideGeometryState.wrapperWidth / 2)]);
    assert.deepEqual(wideGeometryState.positions.map((item) => item.renderedWidth), [Math.round(wideGeometryState.wrapperWidth / 2), Math.round(wideGeometryState.wrapperWidth / 2)]);
    assert.deepEqual(wideGeometryState.positions.map((item) => item.position), ["absolute", "absolute"]);
    const geometryHealth = await waitFor("extreme geometry backend settlement", async () => {
      const health = await readHealth();
      return health.queue.size === 0 && health.queue.waiting === 0 && health.queue.processing === 0 ? health : null;
    }, 180000);
    const geometryEvidence = { ...geometryState, wide: wideGeometryState, queue: geometryHealth.queue };
    geometryClient.close();
    geometryClient = null;
    await browserClient.send("Target.closeTarget", { targetId: geometryTargetCreated.targetId });
    initialWorkerClient.close();

    const lifecycleEvidence = {};
    const unrelatedRuleId = 900000;
    await pageClient.send("Page.navigate", { url: `${fixture.origin}/lifecycle/worker` });
    await waitFor("worker lifecycle fixture load", async () => pageClient.evaluate(
      "document.readyState === 'complete' && document.body?.dataset.lifecycleCase === 'worker'",
    ), 20000);
    await waitFor("stalled worker protected read", async () => fixture.hasStalledLifecycleRead("worker"));
    let workerTarget = await waitForExtensionWorker(port);
    let workerClient = await connectTarget(workerTarget);
    workerClients.push(workerClient);
    const workerPageUrl = `${fixture.origin}/lifecycle/worker`;
    const activeWorkerState = await waitFor("active exact Referer rule", async () => {
      const state = await readWorkerState(workerClient, workerPageUrl);
      return refererRules(state.rules).length === 1 ? state : null;
    });
    assert.equal(activeWorkerState.queue.processing, 0);
    assert.equal(activeWorkerState.registry.length, 1);
    const workerContentInstance = (await pageImageState(pageClient, "#lifecycle-primary")).contentInstance;
    await workerClient.evaluate(`chrome.declarativeNetRequest.updateSessionRules({ addRules: [{
      id: ${unrelatedRuleId}, priority: 1, action: { type: 'block' },
      condition: { urlFilter: 'https://unrelated.invalid/never', resourceTypes: ['xmlhttprequest'] }
    }] })`);
    const terminatedWorkerId = workerTarget.id;
    const terminatedWorkerVersion = await waitForServiceWorkerVersion(pageClient, terminatedWorkerId);
    workerClient.close();
    await pageClient.send("ServiceWorker.stopWorker", { versionId: terminatedWorkerVersion.versionId });
    await waitFor("terminated worker target removal", async () => {
      const targetsAfterClose = await listTargets(port);
      return !targetsAfterClose.some((target) => target.id === terminatedWorkerId);
    }, 20000);
    await pageClient.evaluate("addLifecycleRecoveryImage()");
    workerTarget = await waitForExtensionWorker(port, terminatedWorkerId);
    workerClient = await connectTarget(workerTarget);
    workerClients.push(workerClient);
    const restartedState = await waitFor("startup orphan cleanup", async () => {
      const state = await readWorkerState(workerClient, workerPageUrl);
      return refererRules(state.rules).length === 0 && state.rules.some((rule) => rule.id === unrelatedRuleId) ? state : null;
    });
    fixture.releaseStalledLifecycleRead("worker");
    const recoveredImage = await waitFor("new image after worker reactivation", async () => {
      const state = await pageImageState(pageClient, "#lifecycle-recovery");
      return state?.ready && state.src.startsWith("blob:") ? state : null;
    });
    const oldWorkerImage = await pageImageState(pageClient, "#lifecycle-primary");
    const settledWorkerState = await waitForSettledWorkerState(workerClient, workerPageUrl);
    assert.equal(oldWorkerImage.ready, false, `old worker image unexpectedly rendered: ${JSON.stringify(oldWorkerImage)}`);
    assert.doesNotMatch(oldWorkerImage.src, /^blob:/);
    assert.equal(recoveredImage.matches, 1);
    assert.equal(refererRules(settledWorkerState.rules).length, 0);
    assert.equal(oldWorkerImage.contentInstance, workerContentInstance, "worker restart reinjected the content script");
    assert.ok(fixture.lifecycleRequestCount("worker") <= 3, "worker restart retried the protected transport more than once");
    assert.equal(
      settledWorkerState.registry.some((entry) => entry.imageUrl?.includes("/protected/lifecycle.png?case=worker")),
      false,
      "the terminated protected-read job reappeared in the restarted worker registry",
    );
    lifecycleEvidence.worker = {
      terminatedTarget: terminatedWorkerId,
      restartedTarget: workerTarget.id,
      unrelatedRulePreserved: restartedState.rules.some((rule) => rule.id === unrelatedRuleId),
      oldImageRendered: oldWorkerImage.ready,
      recoveryRendered: recoveredImage.ready,
      protectedTransportRequests: fixture.lifecycleRequestCount("worker"),
      queue: settledWorkerState.queue,
    };

    const navigationAUrl = `${fixture.origin}/lifecycle/navigation-a`;
    const navigationBUrl = `${fixture.origin}/lifecycle/navigation-b`;
    await pageClient.send("Page.navigate", { url: navigationAUrl });
    await waitFor("Chapter A lifecycle load", async () => pageClient.evaluate(
      "document.readyState === 'complete' && document.body?.dataset.lifecycleCase === 'navigation-a'",
    ), 20000);
    await waitFor("Chapter A stalled protected read", async () => fixture.hasStalledLifecycleRead("navigation-a"));
    await waitFor("Chapter A exact Referer rule", async () => {
      const state = await readWorkerState(workerClient, navigationAUrl);
      return refererRules(state.rules).length === 1 ? state : null;
    });
    await pageClient.send("Page.navigate", { url: navigationBUrl });
    fixture.releaseStalledLifecycleRead("navigation-a");
    await waitFor("Chapter B lifecycle load", async () => pageClient.evaluate(
      "document.readyState === 'complete' && document.body?.dataset.lifecycleCase === 'navigation-b'",
    ), 20000);
    const chapterBImage = await waitFor("Chapter B Blob replacement", async () => {
      const state = await pageImageState(pageClient, "#lifecycle-primary");
      return state?.ready && state.src.startsWith("blob:") ? state : null;
    });
    const settledNavigationState = await waitForSettledWorkerState(workerClient, navigationBUrl);
    assert.equal(chapterBImage.matches, 1);
    assert.equal(refererRules(settledNavigationState.rules).length, 0);
    assert.equal(settledNavigationState.registry.some((entry) => entry.pageUrl === navigationAUrl), false);
    assert.equal(fixture.lifecycleRequestCount("navigation-a"), 2, "Chapter A was retried after navigation");
    lifecycleEvidence.navigation = {
      chapterARequests: fixture.lifecycleRequestCount("navigation-a"),
      chapterBRendered: chapterBImage.ready,
      staleChapterAEntries: settledNavigationState.registry.filter((entry) => entry.pageUrl === navigationAUrl).length,
      queue: settledNavigationState.queue,
    };

    const reloadUrl = `${fixture.origin}/lifecycle/reload`;
    await pageClient.send("Page.navigate", { url: reloadUrl });
    await waitFor("extension reload lifecycle load", async () => pageClient.evaluate(
      "document.readyState === 'complete' && document.body?.dataset.lifecycleCase === 'reload'",
    ), 20000);
    await waitFor("reload stalled protected read", async () => fixture.hasStalledLifecycleRead("reload"));
    const preReloadState = await waitFor("reload exact Referer rule", async () => {
      const state = await readWorkerState(workerClient, reloadUrl);
      return refererRules(state.rules).length === 1 ? state : null;
    });
    assert.equal(preReloadState.queue.processing, 0, JSON.stringify({
      activeKeys: preReloadState.activeKeys,
      pendingKeys: preReloadState.pendingKeys,
      registry: preReloadState.registry,
    }));
    assert.equal(preReloadState.registry.length, 1);
    const preReloadTargetId = workerTarget.id;
    workerClient.send("Runtime.evaluate", { expression: "chrome.runtime.reload()" }).catch(() => {});
    await waitFor("extension reload worker replacement", async () => {
      const current = await listTargets(port);
      return !current.some((target) => target.id === preReloadTargetId);
    }, 20000);
    workerTarget = await waitForExtensionWorker(port, preReloadTargetId);
    workerClient = await connectTarget(workerTarget);
    workerClients.push(workerClient);
    fixture.releaseStalledLifecycleRead("reload");
    let reloadedImage;
    try {
      reloadedImage = await waitFor("automatic content recovery after extension reload", async () => {
        const state = await pageImageState(pageClient, "#lifecycle-primary");
        return state?.ready && state.src.startsWith("blob:") ? state : null;
      }, 30000);
    } catch (error) {
      const diagnostics = await readReloadDiagnostics(workerClient, reloadUrl, pageClient);
      diagnostics.requestCount = fixture.lifecycleRequestCount("reload");
      throw new Error(`${error.message}: ${JSON.stringify(diagnostics)}`);
    }
    const settledReloadState = await waitForSettledWorkerState(workerClient, reloadUrl);
    assert.equal(reloadedImage.matches, 1);
    assert.equal(refererRules(settledReloadState.rules).length, 0);
    assert.ok(settledReloadState.rules.some((rule) => rule.id === unrelatedRuleId));
    assert.equal(fixture.lifecycleRequestCount("reload"), 3, "extension reload duplicated protected-image recovery");
    lifecycleEvidence.reload = {
      previousTarget: preReloadTargetId,
      currentTarget: workerTarget.id,
      automaticReplacement: reloadedImage.ready,
      duplicateReplacements: reloadedImage.matches - 1,
      protectedRequests: fixture.lifecycleRequestCount("reload"),
      queue: settledReloadState.queue,
    };

    const lookaheadTargetCreated = await browserClient.send("Target.createTarget", { url: `${fixture.origin}/lookahead-e2e` });
    const lookaheadTarget = await waitFor("lookahead fixture target", async () => {
      const currentTargets = await listTargets(port);
      return currentTargets.find((target) => target.id === lookaheadTargetCreated.targetId && target.webSocketDebuggerUrl) || null;
    });
    lookaheadClient = await connectTarget(lookaheadTarget);
    await lookaheadClient.send("Page.enable");
    await lookaheadClient.send("Runtime.enable");
    const lookaheadEvidence = await waitFor("offscreen image processing before scroll", async () => {
      const state = await lookaheadClient.evaluate(`(() => {
        const image = document.querySelector('#eligible-lookahead');
        if (!image) return null;
        const rect = image.getBoundingClientRect();
        return {
          marker: document.body?.dataset.fixture || null,
          ready: image.classList.contains('ai-manga-upscaler-ready'),
          src: image.src,
          scrollY: window.scrollY,
          viewportHeight: window.innerHeight,
          rectTop: rect.top,
          viewportDistance: Math.max(0, rect.top - window.innerHeight),
        };
      })()`);
      if (state?.marker !== "lookahead-e2e-v1" || !state.ready || !state.src?.startsWith("blob:")) return null;
      const health = await readHealth();
      if (health.queue.size !== 0 || health.queue.waiting !== 0 || health.queue.processing !== 0) return null;
      return state;
    }, 60000);
    assert.equal(lookaheadEvidence.scrollY, 0, "lookahead acceptance scrolled the page");
    assert.ok(lookaheadEvidence.viewportDistance > 1800, "lookahead image was outside the legacy prefetch margin");

    const browserExceptions = [pageClient, lookaheadClient, ...workerClients]
      .filter(Boolean)
      .flatMap((client) => client.events)
      .filter((event) => event.method === "Runtime.exceptionThrown");
    const browserExceptionDetails = browserExceptions.map((event) => ({
      text: event.params?.exceptionDetails?.text || null,
      description: event.params?.exceptionDetails?.exception?.description || null,
      url: event.params?.exceptionDetails?.url || null,
      lineNumber: event.params?.exceptionDetails?.lineNumber ?? null,
    }));
    assert.equal(browserExceptions.length, 0, `Unhandled browser exceptions were observed: ${JSON.stringify(browserExceptionDetails)}`);

    console.log(JSON.stringify({
      result: "PASS",
      browser: browserPath,
      extensionWorker: extensionWorker.url,
      fixture: fixture.origin,
      completedDelta: pageState.health.queue.completed - healthBefore.queue.completed,
      staticOutput: [pageState.state.staticImage.naturalWidth, pageState.state.staticImage.naturalHeight],
      dynamicOutput: [pageState.state.dynamicImage.naturalWidth, pageState.state.dynamicImage.naturalHeight],
      queue: pageState.health.queue,
      dashboard: dashboardEvidence,
      lookahead: lookaheadEvidence,
      geometry: geometryEvidence,
      lifecycle: lifecycleEvidence,
      browserExceptions: browserExceptions.length,
    }, null, 2));
  } finally {
    for (const client of workerClients) client.close();
    dashboardClient?.close();
    geometryClient?.close();
    lookaheadClient?.close();
    browserClient?.close();
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
