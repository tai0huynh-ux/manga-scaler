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
    const completedMonitorJobs = monitorState.jobs.filter((job) => job.stage === "COMPLETED");
    assert.ok(completedMonitorJobs.length >= 2, "monitor must record DOM-committed completions");
    assert.ok(completedMonitorJobs.every((job) => job.renderCommit?.confirmed === true), "monitor completion must include renderer confirmation");
    assert.equal(JSON.stringify(monitorState).includes("imageData"), false, "monitor snapshot must exclude image bytes");
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
    assert.equal(oldWorkerImage.ready, false);
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
    assert.equal(preReloadState.queue.processing, 0);
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

    const browserExceptions = [pageClient, ...workerClients]
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
      lifecycle: lifecycleEvidence,
      browserExceptions: browserExceptions.length,
    }, null, 2));
  } finally {
    for (const client of workerClients) client.close();
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
