const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function loadQueueScheduler(options = {}) {
  const root = path.resolve(__dirname, "..", "..");
  const configSource = fs.readFileSync(path.join(root, "extension", "src", "config.js"), "utf8");
  const background = fs.readFileSync(path.join(root, "extension", "src", "background.js"), "utf8");
  const prefix = background.slice(0, background.indexOf("const statisticsTracker ="));
  const pageImageRegistry = { update() {} };
  const context = vm.createContext({
    AbortController,
    URL,
    Uint8Array,
    Promise,
    Map,
    Set,
    Math,
    Number,
    String,
    Error,
    performance,
    crypto: options.crypto || webcrypto,
    setTimeout: options.timers?.setTimeout || setTimeout,
    clearTimeout: options.timers?.clearTimeout || clearTimeout,
    console: options.console || console,
    importScripts() {},
    __pageImageRegistry: pageImageRegistry,
    chrome: { tabs: { sendMessage: options.tabsSendMessage || (async () => undefined) } },
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    __AI_MANGA_UPSCALER_TRACE_EVENTS__: options.traceEvents || [],
    __AI_MANGA_UPSCALER_DEBUG__: options.debug === true,
  });
  vm.runInContext(configSource, context);
  vm.runInContext(`${prefix}\nconst pageImageRegistry = globalThis.__pageImageRegistry; globalThis.__QueueScheduler = QueueScheduler;`, context);
  return context.__QueueScheduler;
}

function loadBackgroundHelpers() {
  const root = path.resolve(__dirname, "..", "..");
  const configSource = fs.readFileSync(path.join(root, "extension", "src", "config.js"), "utf8");
  const background = fs.readFileSync(path.join(root, "extension", "src", "background.js"), "utf8");
  const prefix = background.slice(0, background.indexOf("chrome.runtime.onInstalled"));
  const context = vm.createContext({
    AbortController,
    URL,
    Uint8Array,
    Promise,
    Map,
    Set,
    Math,
    Number,
    String,
    Error,
    performance,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    console,
    crypto: webcrypto,
    importScripts() {},
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => undefined } },
      tabs: { sendMessage: async () => undefined },
      declarativeNetRequest: { updateSessionRules: async () => undefined },
      runtime: {
        getURL: () => "chrome-extension://test/",
        onMessage: { addListener() {} },
        onStartup: { addListener() {} },
        sendNativeMessage() {},
      },
      alarms: { onAlarm: { addListener() {} }, create() {} },
      scripting: { executeScript: async () => undefined },
    },
  });
  vm.runInContext(configSource, context);
  vm.runInContext(`${prefix}\nglobalThis.__resolveOutputLimits = resolveOutputLimits;`, context);
  return context.__resolveOutputLimits;
}

function loadBackgroundClasses(options = {}) {
  const root = path.resolve(__dirname, "..", "..");
  const configSource = fs.readFileSync(path.join(root, "extension", "src", "config.js"), "utf8");
  const background = fs.readFileSync(path.join(root, "extension", "src", "background.js"), "utf8");
  const prefix = background.slice(0, background.indexOf("const statisticsTracker ="));
  const context = vm.createContext({
    AbortController,
    URL,
    Uint8Array,
    Promise,
    Map,
    Set,
    Math,
    Number,
    String,
    Error,
    performance,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    console,
    importScripts() {},
    chrome: {
      tabs: { sendMessage: async () => undefined },
      declarativeNetRequest: {
        getSessionRules: options.getSessionRules || (async () => []),
        updateSessionRules: options.updateSessionRules || (async () => undefined),
      },
    },
    fetch: options.fetch || (async () => ({ ok: true })),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    __AI_MANGA_UPSCALER_TRACE_EVENTS__: options.traceEvents || [],
  });
  vm.runInContext(configSource, context);
  vm.runInContext(`${prefix}\nglobalThis.__QueueScheduler = QueueScheduler; globalThis.__PageImageRegistry = PageImageRegistry; globalThis.__BackendUpscaleProvider = BackendUpscaleProvider;`, context);
  return {
    QueueScheduler: context.__QueueScheduler,
    PageImageRegistry: context.__PageImageRegistry,
    BackendUpscaleProvider: context.__BackendUpscaleProvider,
  };
}

function loadBackgroundMessageHarness(options = {}) {
  const root = path.resolve(__dirname, "..", "..");
  const configSource = fs.readFileSync(path.join(root, "extension", "src", "config.js"), "utf8");
  const background = fs.readFileSync(path.join(root, "extension", "src", "background.js"), "utf8");
  const prefix = background.slice(0, background.indexOf("chrome.runtime.onInstalled"));
  const messageHandlers = background.slice(
    background.indexOf("function hasMessageOperationIdentity"),
    background.indexOf("chrome.tabs.onRemoved.addListener"),
  );
  let messageListener = null;
  const storageGet = options.storageGet || (async (defaults) => defaults);
  const storageSet = options.storageSet || (async () => undefined);
  const context = vm.createContext({
    AbortController,
    URL,
    Uint8Array,
    Promise,
    Map,
    Set,
    Math,
    Number,
    String,
    Error,
    performance,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    console,
    importScripts() {},
    fetch: options.fetch || (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    __AI_MANGA_UPSCALER_TRACE_EVENTS__: options.traceEvents || [],
    chrome: {
      storage: {
        local: { get: storageGet, set: storageSet },
        onChanged: { addListener() {} },
      },
      tabs: {
        sendMessage: async () => undefined,
        query: async () => [],
      },
      declarativeNetRequest: { updateSessionRules: options.updateSessionRules || (async () => undefined) },
      runtime: {
        getURL: () => "chrome-extension://test/",
        onMessage: { addListener(listener) { messageListener = listener; } },
        sendNativeMessage() {},
      },
      scripting: { executeScript: async () => undefined },
    },
  });
  vm.runInContext(configSource, context);
  vm.runInContext(
    `${prefix}\n${messageHandlers}\nglobalThis.__scheduler = scheduler; globalThis.__pageImageRegistry = pageImageRegistry;`,
    context,
  );
  return {
    dispatch: (message, sender, sendResponse) => messageListener(message, sender, sendResponse),
    scheduler: context.__scheduler,
    pageImageRegistry: context.__pageImageRegistry,
  };
}

function loadContentClasses(options = {}) {
  const root = path.resolve(__dirname, "..", "..");
  const configSource = fs.readFileSync(path.join(root, "extension", "src", "config.js"), "utf8");
  const content = fs.readFileSync(path.join(root, "extension", "src", "content.js"), "utf8");
  const prefix = content.slice(0, content.indexOf("const renderer ="));
  class FakeObserver {
    observe() {}
  }
  class FakeNode {}
  class FakeHTMLElement extends FakeNode {
    querySelectorAll() { return []; }
  }
  class FakeHtmlImageElement extends FakeHTMLElement {
    constructor() {
      super();
      this.dataset = {};
      this.style = {};
      this.listeners = new Map();
      this.attributes = new Map();
      this.complete = false;
      this.naturalWidth = 1;
      this.naturalHeight = 1;
      this.clientWidth = 900;
      this.clientHeight = 1000;
      let srcValue = "";
      Object.defineProperty(this, "src", {
        get: () => srcValue,
        set: (value) => {
          srcValue = String(value);
          this.currentSrc = srcValue;
          this.attributes.set("src", srcValue);
        },
      });
      this.currentSrc = "";
      const classes = new Set();
      this.classList = {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
      };
      if (typeof options.onImageCreated === "function") {
        options.onImageCreated(this);
      }
    }

    addEventListener(type, callback, options = {}) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ callback, once: options.once === true });
    }

    removeEventListener(type, callback) {
      const listeners = this.listeners.get(type) || [];
      this.listeners.set(type, listeners.filter((listener) => listener.callback !== callback));
    }

    dispatch(type) {
      const listeners = [...(this.listeners.get(type) || [])];
      for (const listener of listeners) {
        listener.callback({ type, target: this });
        if (listener.once) this.removeEventListener(type, listener.callback);
      }
    }

    removeAttribute(name) {
      this.attributes.delete(name);
      if (name === "src") {
        this.currentSrc = this.src;
      } else if (name === "srcset" || name === "sizes") {
        delete this[name];
      }
    }

    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }

    hasAttribute(name) {
      return this.attributes.has(name);
    }

    setAttribute(name, value) {
      const normalized = String(value);
      this.attributes.set(name, normalized);
      if (name === "src") {
        this.src = normalized;
      } else if (name === "srcset" || name === "sizes") {
        this[name] = normalized;
      }
    }

    getBoundingClientRect() {
      return { width: this.clientWidth, height: this.clientHeight, top: 0, bottom: this.clientHeight, left: 0, right: this.clientWidth };
    }

    closest() {
      return null;
    }
  }
  const sentMessages = [];
  const timers = options.timers || { setTimeout, clearTimeout };
  const urlApi = options.urlApi || URL;
  const context = vm.createContext({
    URL: urlApi,
    Map,
    Set,
    Math,
    Number,
    String,
    console,
    performance,
    crypto: options.crypto || webcrypto,
    MutationObserver: FakeObserver,
    IntersectionObserver: FakeObserver,
    window: { innerWidth: 1200, innerHeight: 900, addEventListener() {} },
    document: {
      baseURI: "https://example.com/page",
      getElementById: () => ({}),
      createElement: (tagName) => {
        if (typeof options.createElement === "function") return options.createElement(tagName);
        return {
          style: {},
          dataset: {},
          children: [],
          appendChild(child) {
            this.children.push(child);
            child.parentNode = this;
          },
          remove() {
            this.parentNode?.removeChild?.(this);
            this.parentNode = null;
          },
        };
      },
      documentElement: { appendChild() {}, contains: () => true },
      elementsFromPoint: options.elementsFromPoint,
    },
    getComputedStyle: (element) => element.style || {},
    chrome: { storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } }, runtime: { sendMessage: (message) => { sentMessages.push(message); return typeof options.sendMessage === "function" ? options.sendMessage(message) : { catch() {} }; }, onMessage: { addListener() {} } } },
    HTMLImageElement: FakeHtmlImageElement,
    HTMLElement: FakeHTMLElement,
    Node: FakeNode,
    Image: FakeHtmlImageElement,
    Blob: class {},
    URLSearchParams,
    TextEncoder,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    __AI_MANGA_UPSCALER_TRACE_EVENTS__: options.traceEvents || [],
  });
  vm.runInContext(configSource, context);
  vm.runInContext(`${prefix}\nglobalThis.__ImageProvider = ImageProvider; globalThis.__ViewportImageProvider = ViewportImageProvider; globalThis.__Renderer = Renderer; globalThis.__HTMLImageElement = HTMLImageElement; globalThis.__trackedImages = trackedImages; globalThis.__trackedImageKeys = trackedImageKeys; globalThis.__completedImageKeys = completedImageKeys;`, context);
  return {
    ImageProvider: context.__ImageProvider,
    ViewportImageProvider: context.__ViewportImageProvider,
    Renderer: context.__Renderer,
    HTMLImageElement: context.__HTMLImageElement,
    config: context.AI_MANGA_UPSCALER_CONFIG,
    sentMessages,
    trackedImages: context.__trackedImages,
    trackedImageKeys: context.__trackedImageKeys,
    completedImageKeys: context.__completedImageKeys,
  };
}

function makeContentProvider({ readDisplayedImage, cropImageSegments, preprocessingConcurrency = 3, renderer = null, timers = null, urlApi = null, imageProvider = null, elementsFromPoint = undefined, onImageCreated = undefined, sendMessage = undefined } = {}) {
  const traceEvents = [];
  const { ViewportImageProvider, HTMLImageElement, sentMessages, trackedImages, trackedImageKeys, completedImageKeys } = loadContentClasses({ timers, urlApi, elementsFromPoint, onImageCreated, sendMessage, traceEvents });
  const viewportProvider = new ViewportImageProvider({
    imageProvider: imageProvider || {
      canProcess: () => true,
      read: (image) => ({
        imageUrl: image.src,
        src: image.src,
        srcset: null,
        sizes: null,
        width: image.clientWidth,
        height: image.clientHeight,
        pictureSources: [],
      }),
    },
    renderer: renderer || {
      installRawSlices: () => [],
      waitForImageLoad: async () => undefined,
    },
  });
  viewportProvider.imageSlicingEnabled = true;
  viewportProvider.imageSliceMaxHeight = 1000;
  viewportProvider.preprocessingConcurrency = preprocessingConcurrency;
  viewportProvider.readDisplayedImage = readDisplayedImage || (async () => "image-data");
  viewportProvider.cropImageSegments = cropImageSegments || (async () => []);
  return { viewportProvider, HTMLImageElement, sentMessages, trackedImages, trackedImageKeys, completedImageKeys, traceEvents };
}

function makeFakeTimers() {
  const timers = [];
  return {
    api: {
      setTimeout(callback) {
        const timer = { callback, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) {
        if (timer) timer.cleared = true;
      },
    },
    runNext() {
      const timer = timers.find((entry) => !entry.cleared);
      if (timer) {
        timer.cleared = true;
        timer.callback();
      }
    },
  };
}

function makeTrackedUrlApi() {
  const revoked = [];
  function TrackedURL(...args) {
    return new URL(...args);
  }
  Object.assign(TrackedURL, URL, {
    createObjectURL: (blob) => blob.objectUrl,
    revokeObjectURL: (objectUrl) => revoked.push(objectUrl),
    revoked,
  });
  return TrackedURL;
}

function makeClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
    contains: (name) => classes.has(name),
    values: () => [...classes].sort(),
  };
}

function makeRenderElement({ src = "", attributes = {}, dataset = {}, style = {}, classes = [] } = {}) {
  const attributeMap = new Map(Object.entries(attributes).map(([name, value]) => [name, String(value)]));
  const listeners = new Map();
  let srcValue = src;
  const element = {
    complete: false,
    naturalWidth: 100,
    dataset: { ...dataset },
    style: { ...style },
    classList: makeClassList(classes),
    addEventListener(type, callback, options = {}) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ callback, once: options.once === true });
    },
    removeEventListener(type, callback) {
      listeners.set(type, (listeners.get(type) || []).filter((listener) => listener.callback !== callback));
    },
    dispatch(type) {
      for (const listener of [...(listeners.get(type) || [])]) {
        listener.callback({ type, target: element });
        if (listener.once) element.removeEventListener(type, listener.callback);
      }
    },
    getAttribute(name) {
      return attributeMap.get(name) ?? null;
    },
    hasAttribute(name) {
      return attributeMap.has(name);
    },
    setAttribute(name, value) {
      attributeMap.set(name, String(value));
    },
    removeAttribute(name) {
      attributeMap.delete(name);
    },
  };
  Object.defineProperty(element, "src", {
    get: () => srcValue,
    set: (value) => {
      srcValue = String(value);
      attributeMap.set("src", srcValue);
      element.currentSrc = srcValue;
    },
  });
  element.currentSrc = src;
  return element;
}

function instrumentPreprocessingSlots(viewportProvider) {
  const stats = {
    acquired: 0,
    released: 0,
    maxActive: 0,
    minActive: 0,
  };
  const acquire = viewportProvider.acquirePreprocessingSlot.bind(viewportProvider);
  viewportProvider.acquirePreprocessingSlot = async (operation) => {
    const release = await acquire(operation);
    if (!release) return null;
    stats.acquired += 1;
    stats.maxActive = Math.max(stats.maxActive, viewportProvider.preprocessingActive);
    assert.ok(viewportProvider.preprocessingActive <= viewportProvider.preprocessingConcurrency);
    return () => {
      const didRelease = release();
      if (didRelease) stats.released += 1;
      stats.minActive = Math.min(stats.minActive, viewportProvider.preprocessingActive);
      assert.ok(viewportProvider.preprocessingActive >= 0);
      assert.ok(viewportProvider.preprocessingActive <= viewportProvider.preprocessingConcurrency);
      return didRelease;
    };
  };
  return stats;
}

test("content reads slicing image data through the background boundary", async () => {
  const { ViewportImageProvider, sentMessages } = loadContentClasses({
    sendMessage: async (message) => {
      assert.equal(message.type, "READ_IMAGE_FOR_SLICING");
      assert.equal(message.imageUrl, "https://cdn.example.test/page.webp");
      return { ok: true, imageData: "background-image-data" };
    },
  });
  const viewportProvider = new ViewportImageProvider({
    imageProvider: { canProcess: () => true, read: () => ({}) },
    renderer: { waitForImageLoad: async () => undefined },
  });

  const result = await viewportProvider.readDisplayedImage("https://cdn.example.test/page.webp");

  assert.equal(result.ok, true);
  assert.equal(result.imageData, "background-image-data");
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, "READ_IMAGE_FOR_SLICING");
  assert.equal(sentMessages[0].imageUrl, "https://cdn.example.test/page.webp");
});

test("content returns a read reason when the background cannot read a slicing image", async () => {
  const { ViewportImageProvider } = loadContentClasses({
    sendMessage: async () => ({ ok: false, reason: "read-fetch-error", message: "CORS blocked" }),
  });
  const viewportProvider = new ViewportImageProvider({
    imageProvider: { canProcess: () => true, read: () => ({}) },
    renderer: { waitForImageLoad: async () => undefined },
  });

  const result = await viewportProvider.readDisplayedImage("https://cdn.example.test/page.webp");

  assert.equal(result.ok, false);
  assert.equal(result.imageData, null);
  assert.equal(result.reason, "read-fetch-error");
});

test("background READ_IMAGE_FOR_SLICING uses the existing browser image reader for CDN images", async () => {
  const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const fetchedUrls = [];
  const ruleUpdates = [];
  const responses = [];
  const { dispatch } = loadBackgroundMessageHarness({
    fetch: async (url) => {
      fetchedUrls.push(url);
      return { ok: true, arrayBuffer: async () => pngBytes.buffer };
    },
    updateSessionRules: async (update) => {
      ruleUpdates.push(update);
    },
  });

  assert.equal(dispatch(
    { type: "READ_IMAGE_FOR_SLICING", imageUrl: "https://cdn.example.test/chapter/page.png" },
    { tab: { id: 7, url: "https://reader.example.test/chapter/1" } },
    (response) => responses.push(response),
  ), true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(fetchedUrls, ["https://cdn.example.test/chapter/page.png"]);
  assert.equal(responses.at(-1).ok, true);
  assert.equal(responses.at(-1).imageData, Buffer.from(pngBytes).toString("base64"));
  assert.ok(ruleUpdates.some((update) => update.addRules?.[0]?.action?.requestHeaders?.[0]?.value === "https://reader.example.test/chapter/1"));
});

test("background READ_IMAGE_FOR_SLICING rejects unsupported URLs", () => {
  const responses = [];
  const { dispatch } = loadBackgroundMessageHarness();

  assert.equal(dispatch(
    { type: "READ_IMAGE_FOR_SLICING", imageUrl: "data:image/png;base64,abc" },
    { tab: { id: 7, url: "https://reader.example.test/" } },
    (response) => responses.push(response),
  ), false);

  assert.equal(responses.at(-1).ok, false);
  assert.equal(responses.at(-1).reason, "read-invalid-url");
  assert.equal(responses.at(-1).message, "Only http and https image URLs are supported.");
});

test("background READ_IMAGE_FOR_SLICING reports read timeouts", async () => {
  const responses = [];
  const { dispatch } = loadBackgroundMessageHarness({
    fetch: async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });

  assert.equal(dispatch(
    { type: "READ_IMAGE_FOR_SLICING", imageUrl: "https://cdn.example.test/slow.png" },
    { tab: { id: 7, url: "https://reader.example.test/" } },
    (response) => responses.push(response),
  ), true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(responses.at(-1).ok, false);
  assert.equal(responses.at(-1).reason, "read-timeout");
});

test("DISCOVERY-003 browser image reads settle when a response body ignores abort", async () => {
  const { BackendUpscaleProvider } = loadBackgroundClasses({
    fetch: async () => ({
      ok: true,
      arrayBuffer: () => new Promise(() => {}),
    }),
  });
  const provider = new BackendUpscaleProvider("http://127.0.0.1:8765", 20000);
  const controller = new AbortController();
  controller.abort();

  const outcome = await Promise.race([
    provider.readBrowserImage(
      "https://cdn.example.test/chapter/page.jpg",
      "https://reader.example.test/chapter/1",
      controller.signal,
    ).then(() => "resolved", (error) => `${error?.name || "Error"}:${error?.message || "rejected"}`),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
  ]);

  assert.match(outcome, /^AbortError:/);
});

function makeTallImage(index) {
  const attributes = new Map();
  const image = {
    dataset: {},
    style: {},
    hidden: false,
    src: `https://example.com/tall-${index}.png`,
    currentSrc: `https://example.com/tall-${index}.png`,
    width: 900,
    height: 4000,
    clientWidth: 900,
    clientHeight: 4000,
    naturalWidth: 900,
    naturalHeight: 4000,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    contains: (node) => node === image,
    getBoundingClientRect: () => ({ width: 900, height: 4000, top: 0, bottom: 4000, left: 0, right: 900 }),
  };
  return image;
}

function makeTransactionalSliceRenderer({ token = "slice-owner-token", onRollback = () => {}, onRender = async () => "rendered" } = {}) {
  return {
    prepareRawSlices(image, _metadata, segments) {
      const rawImages = segments.map((segment) => makeTallImage(`raw-${segment.index}`));
      const wrapper = {
        dataset: { aiEnhancerSliceToken: token },
        children: rawImages,
      };
      rawImages.forEach((rawImage) => {
        rawImage.parentNode = wrapper;
        rawImage.dataset.aiEnhancerSliceToken = token;
      });
      return {
        token,
        wrapper,
        state: "prepared",
        rawImages,
        commit() {
          if (this.state !== "prepared") return this.state === "committed";
          this.state = "committed";
          image.style.display = "none";
          image.dataset.aiEnhancerSliced = "true";
          return true;
        },
        rollback() {
          if (this.state === "rolledBack") return false;
          this.state = "rolledBack";
          image.style.display = "";
          delete image.dataset.aiEnhancerSliced;
          onRollback();
          return true;
        },
      };
    },
    waitForImageLoad: async () => undefined,
    render: onRender,
  };
}

async function waitForSettled(promise, timeoutMs = 100) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const result = await Promise.race([
    Promise.all(promise).then(() => "settled"),
    timeout,
  ]);
  clearTimeout(timeoutId);
  return result;
}

function makeJob(imageId = "image-1") {
  return {
    tabId: 7,
    imageId,
    operationId: `${imageId}-op-1`,
    sourceRevision: `${imageId}-rev-1`,
    imageUrl: `https://example.com/${imageId}.png`,
    pageOrder: 1,
    viewportDistance: 0,
    mode: "manga",
    enhanceLevel: 0.3,
    maxOutputWidth: 1000,
    maxOutputHeight: 2000,
    outputQuality: 90,
    tileSize: 256,
    attempt: 1,
    traceId: `trace-${imageId}`,
  };
}

test("content operation creates and propagates trace id", async () => {
  const { viewportProvider, sentMessages, traceEvents } = makeContentProvider({
    readDisplayedImage: async () => ({ ok: true, imageData: Buffer.from("trace-image").toString("base64") }),
  });
  viewportProvider.withTimeout = async (promise) => promise;

  await viewportProvider.schedule(makeTallImage("trace-content"));

  const enqueue = sentMessages.find((message) => message.type === "ENQUEUE_IMAGE");
  assert.ok(enqueue.traceId);
  assert.equal(typeof enqueue.traceId, "string");
  assert.equal(sentMessages.find((message) => message.type === "PREPROCESSING_STARTED").traceId, enqueue.traceId);
  assert.equal(traceEvents.some((event) => event.event === "content.operation.created" && event.traceId === enqueue.traceId), true);
  assert.equal(traceEvents.some((event) => JSON.stringify(event).includes("imageData")), false);
});

test("background request carries trace metadata without image data in trace payload", async () => {
  const traceEvents = [];
  const QueueScheduler = loadQueueScheduler({ traceEvents });
  const requests = [];
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 1,
    cacheProvider: { get: async () => null, set: async () => undefined },
    upscaleProvider: {
      upscale: async (_url, options) => {
        requests.push(options);
        return { buffer: new Uint8Array([1]).buffer, contentType: "image/png", traceId: options.traceId };
      },
      cancel() {},
    },
    statisticsTracker: { recordSuccess: async () => undefined, recordError: async () => undefined },
  });

  scheduler.enqueue({ ...makeJob("trace-background"), imageData: "base64-payload", sourceFingerprint: "sha256-trace" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requests[0].traceId, "trace-trace-background");
  assert.equal(requests[0].operationId, "trace-background-op-1");
  assert.equal(requests[0].queueKey, "7:trace-background:trace-background-op-1");
  assert.equal(requests[0].attempt, 1);
  assert.equal(requests[0].sourceFingerprint, "sha256-trace");
  assert.equal(traceEvents.some((event) => event.event === "background.cache.miss"), true);
  assert.equal(traceEvents.some((event) => JSON.stringify(event).includes("base64-payload")), false);
});

test("background retry keeps trace id and increments attempt", async () => {
  const traceEvents = [];
  const fakeTimers = makeFakeTimers();
  const QueueScheduler = loadQueueScheduler({ timers: fakeTimers.api, traceEvents });
  let calls = 0;
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 1,
    cacheProvider: { get: async () => null, set: async () => undefined },
    upscaleProvider: {
      upscale: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary");
        return { buffer: new Uint8Array([1]).buffer, contentType: "image/png" };
      },
      cancel() {},
    },
    statisticsTracker: { recordSuccess: async () => undefined, recordError: async () => undefined },
  });

  scheduler.enqueue(makeJob("trace-retry"));
  await new Promise((resolve) => setImmediate(resolve));
  fakeTimers.runNext();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const retry = traceEvents.find((event) => event.event === "background.job.retrying");
  assert.equal(retry.traceId, "trace-trace-retry");
  assert.equal(retry.attempt, 2);
  assert.equal(calls, 2);
});

test("background cache hit emits completion terminal event", async () => {
  const traceEvents = [];
  const QueueScheduler = loadQueueScheduler({ traceEvents });
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 1,
    cacheProvider: {
      get: async () => ({ buffer: new Uint8Array([1]).buffer, contentType: "image/png", quality: {} }),
      set: async () => undefined,
    },
    upscaleProvider: { cancel() {} },
    statisticsTracker: { recordSuccess: async () => undefined, recordError: async () => undefined },
  });

  scheduler.enqueue(makeJob("trace-cache"));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(traceEvents.some((event) => event.event === "background.cache.hit" && event.traceId === "trace-trace-cache"), true);
  assert.equal(traceEvents.some((event) => event.event === "background.job.completed" && event.status === "completed"), true);
});

test("trace helper does not throw when console debug fails", () => {
  const traceEvents = [];
  const QueueScheduler = loadQueueScheduler({
    traceEvents,
    debug: true,
    console: { debug: () => { throw new Error("console unavailable"); } },
  });
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 0,
    cacheProvider: {},
    upscaleProvider: { cancel() {} },
    statisticsTracker: {},
  });
  scheduler.paused = true;
  scheduler.setPaused(false);
  scheduler.maxConcurrentRequests = 0;
  assert.doesNotThrow(() => scheduler.enqueue(makeJob("trace-console")));
});

test("same pathname with different query creates distinct content keys", () => {
  const { viewportProvider } = makeContentProvider();
  const first = makeTallImage(1);
  const second = makeTallImage(2);
  first.src = "https://cdn.example.com/page.jpg?chapter=1";
  first.currentSrc = first.src;
  second.src = "https://cdn.example.com/page.jpg?chapter=2";
  second.currentSrc = second.src;

  assert.notEqual(
    viewportProvider.imageKey(viewportProvider.imageProvider.read(first), first),
    viewportProvider.imageKey(viewportProvider.imageProvider.read(second), second),
  );
});

test("content fingerprint remains SHA-256 when Web Crypto is unavailable", async () => {
  const { ViewportImageProvider } = loadContentClasses({ crypto: {} });
  const viewportProvider = new ViewportImageProvider({ imageProvider: {}, renderer: {} });

  const fingerprint = await viewportProvider.sourceFingerprint(Buffer.from("abc").toString("base64"));

  assert.equal(fingerprint, "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("same image element source change starts a new operation identity", async () => {
  const reads = ["first-data", "second-data"];
  const { viewportProvider, sentMessages } = makeContentProvider({
    readDisplayedImage: async () => reads.shift(),
  });
  const image = makeTallImage(0);
  image.naturalHeight = 900;
  image.clientHeight = 900;
  image.height = 900;
  image.getBoundingClientRect = () => ({ width: 900, height: 900, top: 0, bottom: 900, left: 0, right: 900 });
  image.src = "https://example.com/page.jpg?rev=1";
  image.currentSrc = image.src;
  await viewportProvider.schedule(image);
  const firstMessage = sentMessages.find((message) => message.type === "ENQUEUE_IMAGE");

  image.src = "https://example.com/page.jpg?rev=2";
  image.currentSrc = image.src;
  image.dataset.aiEnhancerSeen = "false";
  await viewportProvider.schedule(image);
  const enqueued = sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE");

  assert.equal(enqueued.length, 2);
  assert.notEqual(enqueued[0].operationId, enqueued[1].operationId);
  assert.notEqual(enqueued[0].sourceRevision, enqueued[1].sourceRevision);
  assert.notEqual(enqueued[0].imageId, enqueued[1].imageId);
  assert.ok(firstMessage.sourceFingerprint);
});

test("IMAGE_SEEN and enqueue lifecycle share one exact operation identity", async () => {
  const { viewportProvider, HTMLImageElement, sentMessages } = makeContentProvider();
  const image = new HTMLImageElement();
  image.src = "https://example.com/identity.png";
  image.currentSrc = image.src;
  image.naturalWidth = 900;
  image.naturalHeight = 900;
  image.clientWidth = 900;
  image.clientHeight = 900;
  image.width = 900;
  image.height = 900;

  viewportProvider.observeImage(image);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const messages = sentMessages.filter((message) => ["IMAGE_SEEN", "PREPROCESSING_STARTED", "ENQUEUE_IMAGE"].includes(message.type));
  assert.deepEqual(messages.map(({ type, imageId, operationId, sourceRevision }) => ({ type, imageId, operationId, sourceRevision })), [
    { type: "IMAGE_SEEN", imageId: messages[0].imageId, operationId: messages[0].operationId, sourceRevision: messages[0].sourceRevision },
    { type: "PREPROCESSING_STARTED", imageId: messages[0].imageId, operationId: messages[0].operationId, sourceRevision: messages[0].sourceRevision },
    { type: "ENQUEUE_IMAGE", imageId: messages[0].imageId, operationId: messages[0].operationId, sourceRevision: messages[0].sourceRevision },
  ]);
  assert.ok(messages.every((message) => message.operationId));
});

test("same-URL page reload cancels old bytes and starts a new source revision", async () => {
  const firstRead = deferred();
  const firstReadStarted = deferred();
  let readCount = 0;
  const { viewportProvider, HTMLImageElement, sentMessages } = makeContentProvider({
    readDisplayedImage: () => {
      readCount += 1;
      if (readCount === 1) {
        firstReadStarted.resolve();
        return firstRead.promise;
      }
      return Promise.resolve("new-bytes-at-same-url");
    },
  });
  const image = new HTMLImageElement();
  image.src = "https://example.com/reloaded-in-place.png";
  image.naturalWidth = 900;
  image.naturalHeight = 900;
  image.clientWidth = 900;
  image.clientHeight = 900;
  image.width = 900;
  image.height = 900;

  viewportProvider.observeImage(image);
  await firstReadStarted.promise;
  image.dispatch("load");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  firstRead.resolve("old-bytes-at-same-url");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const seen = sentMessages.filter((message) => message.type === "IMAGE_SEEN");
  const enqueued = sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE");
  assert.equal(seen.length, 2, JSON.stringify(sentMessages));
  assert.equal(enqueued.length, 1, JSON.stringify(sentMessages));
  assert.equal(enqueued[0].operationId, seen[1].operationId);
  assert.notEqual(seen[0].operationId, seen[1].operationId);
  assert.notEqual(seen[0].sourceRevision, seen[1].sourceRevision);
  assert.ok(sentMessages.some((message) => message.type === "CANCEL_IMAGE" && message.operationId === seen[0].operationId));
});

test("page-owned source change after render releases saved metadata and replaces the operation", async () => {
  let ownedObjectUrl = null;
  const renderer = {
    installRawSlices: () => [],
    waitForImageLoad: async () => undefined,
    isOwnedSource: (image) => Boolean(ownedObjectUrl && image.src === ownedObjectUrl),
    releaseImageOwnership(image) {
      ownedObjectUrl = null;
      delete image.dataset.aiMangaOriginalSrc;
      delete image.dataset.aiMangaOriginalSrcset;
      delete image.dataset.aiMangaOriginalSizes;
    },
  };
  const imageProvider = {
    canProcess: () => true,
    read: (image) => {
      const source = image.dataset.aiMangaOriginalSrc || image.currentSrc || image.src;
      return {
        imageUrl: source,
        src: image.dataset.aiMangaOriginalSrc || image.getAttribute("src"),
        srcset: null,
        sizes: null,
        width: image.clientWidth,
        height: image.clientHeight,
        pictureSources: [],
      };
    },
  };
  const { viewportProvider, HTMLImageElement, sentMessages } = makeContentProvider({ renderer, imageProvider });
  const image = new HTMLImageElement();
  const originalUrl = "https://example.com/original-before-render.png";
  const replacementUrl = "https://example.com/replacement-from-page.png";
  image.src = originalUrl;
  image.naturalWidth = 900;
  image.naturalHeight = 900;
  image.clientWidth = 900;
  image.clientHeight = 900;
  image.width = 900;
  image.height = 900;

  viewportProvider.observeImage(image);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  ownedObjectUrl = "blob:rendered-owned-source";
  image.dataset.aiMangaOriginalSrc = originalUrl;
  image.src = ownedObjectUrl;
  image.src = replacementUrl;
  image.dispatch("load");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const enqueued = sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE");
  assert.equal(enqueued.length, 2, JSON.stringify(sentMessages));
  assert.equal(enqueued[1].imageUrl, replacementUrl);
  assert.notEqual(enqueued[0].operationId, enqueued[1].operationId);
  assert.equal(image.dataset.aiMangaOriginalSrc, undefined);
});

test("source replacement during fingerprint hashing cannot emit stale enqueue", async () => {
  const oldFingerprint = deferred();
  const fingerprintStarted = deferred();
  const { viewportProvider, sentMessages } = makeContentProvider({
    readDisplayedImage: async (imageUrl) => imageUrl.includes("rev=1") ? "old-bytes" : "new-bytes",
  });
  viewportProvider.sourceFingerprint = async (imageData) => {
    if (imageData === "old-bytes") {
      fingerprintStarted.resolve();
      return oldFingerprint.promise;
    }
    return "sha256:new";
  };
  const image = makeTallImage("hash-race");
  image.naturalHeight = 900;
  image.clientHeight = 900;
  image.height = 900;
  image.getBoundingClientRect = () => ({ width: 900, height: 900, top: 0, bottom: 900, left: 0, right: 900 });
  image.src = "https://example.com/page.png?rev=1";
  image.currentSrc = image.src;

  const staleSchedule = viewportProvider.schedule(image);
  await fingerprintStarted.promise;
  image.src = "https://example.com/page.png?rev=2";
  image.currentSrc = image.src;
  const currentSchedule = viewportProvider.schedule(image);
  await currentSchedule;
  oldFingerprint.resolve("sha256:old");
  await staleSchedule;

  const enqueued = sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE");
  assert.equal(enqueued.length, 1, JSON.stringify(enqueued));
  assert.equal(enqueued[0].sourceFingerprint, "sha256:new");
  assert.ok(enqueued[0].imageUrl.includes("rev=2"));
});

test("concurrent scheduling of one operation emits exactly one enqueue", async () => {
  const firstRead = deferred();
  let reads = 0;
  const { viewportProvider, sentMessages } = makeContentProvider({
    readDisplayedImage: () => {
      reads += 1;
      return firstRead.promise;
    },
  });
  const image = makeTallImage("duplicate");
  image.naturalHeight = 900;
  image.clientHeight = 900;
  image.height = 900;
  image.getBoundingClientRect = () => ({ width: 900, height: 900, top: 0, bottom: 900, left: 0, right: 900 });

  const first = viewportProvider.schedule(image);
  const second = viewportProvider.schedule(image);
  await new Promise((resolve) => setImmediate(resolve));
  firstRead.resolve("same-bytes");
  await Promise.all([first, second]);

  assert.equal(reads, 1);
  assert.equal(sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE").length, 1);
});

test("old completion after source change is ignored", async () => {
  const rendered = [];
  const { viewportProvider, sentMessages } = makeContentProvider({
    renderer: {
      render: async (_image, payload) => rendered.push(payload.operationId),
      installRawSlices: () => [],
      waitForImageLoad: async () => undefined,
    },
  });
  const image = makeTallImage(0);
  image.naturalHeight = 900;
  image.clientHeight = 900;
  image.height = 900;
  image.getBoundingClientRect = () => ({ width: 900, height: 900, top: 0, bottom: 900, left: 0, right: 900 });
  image.src = "https://example.com/page.jpg?rev=1";
  image.currentSrc = image.src;
  await viewportProvider.schedule(image);
  const stale = sentMessages.find((message) => message.type === "ENQUEUE_IMAGE");
  image.src = "https://example.com/page.jpg?rev=2";
  image.currentSrc = image.src;
  image.dataset.aiEnhancerSeen = "false";
  await viewportProvider.schedule(image);
  const current = sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE")[1];

  await viewportProvider.complete({ type: "UPSCALE_COMPLETE", imageId: stale.imageId, operationId: stale.operationId, sourceRevision: stale.sourceRevision, sourceFingerprint: stale.sourceFingerprint, imageBase64: "old" });
  await viewportProvider.complete({ type: "UPSCALE_COMPLETE", imageId: current.imageId, operationId: current.operationId, sourceRevision: current.sourceRevision, sourceFingerprint: current.sourceFingerprint, imageBase64: "new" });

  assert.deepEqual(rendered, [current.operationId]);
});

test("old failure after source change cannot remove current operation", () => {
  const { viewportProvider, trackedImages, trackedImageKeys } = makeContentProvider();
  const image = makeTallImage("shared");
  const current = {
    imageId: "shared-image",
    operationId: "current-op",
    sourceRevision: "current-rev",
    image,
    metadata: { imageUrl: image.src },
    baseKey: "current-rev",
  };
  trackedImages.set(current.imageId, current);
  trackedImageKeys.set(current.baseKey, current);

  viewportProvider.fail(current.imageId, false, "stale-op", "stale-rev");

  assert.equal(trackedImages.get(current.imageId), current);
  assert.equal(trackedImageKeys.get(current.baseKey), current);
});

test("canceling a stale content entry cannot delete its replacement", () => {
  const { viewportProvider, trackedImages, trackedImageKeys } = makeContentProvider();
  const image = makeTallImage("cancel-current");
  const current = {
    imageId: "shared-image",
    operationId: "new-op",
    sourceRevision: "shared-revision",
    image,
    metadata: { imageUrl: image.src },
    baseKey: "shared-revision",
  };
  const stale = { ...current, operationId: "old-op" };
  trackedImages.set(current.imageId, current);
  trackedImageKeys.set(current.baseKey, current);

  viewportProvider.cancel(stale);

  assert.equal(trackedImages.get(current.imageId), current);
  assert.equal(trackedImageKeys.get(current.baseKey), current);
});

test("renderer aborts if operation becomes stale during fade", async () => {
  const urlApi = makeTrackedUrlApi();
  let nextObjectUrl = 0;
  urlApi.createObjectURL = () => `blob:render-${nextObjectUrl++}`;
  const { Renderer, trackedImages } = loadContentClasses({ urlApi });
  const renderer = new Renderer();
  renderer.fadeOut = async () => undefined;
  const image = {
    dataset: {},
    style: {},
    src: "https://example.com/original.png",
    complete: true,
    classList: { add() {} },
    removeAttribute() {},
    addEventListener() {},
  };
  const current = {
    imageId: "shared-image",
    operationId: "current-op",
    sourceRevision: "current-rev",
    metadata: { width: 100, height: 100, src: image.src, srcset: "", sizes: "", pictureSources: [] },
  };
  trackedImages.set(current.imageId, current);
  renderer.fadeOut = async () => {
    trackedImages.set(current.imageId, { ...current, operationId: "new-op", sourceRevision: "new-rev" });
  };
  const isCurrent = () => {
    const entry = trackedImages.get(current.imageId);
    return entry?.operationId === current.operationId && entry?.sourceRevision === current.sourceRevision;
  };

  await renderer.render(image, {
    imageId: current.imageId,
    operationId: current.operationId,
    sourceRevision: current.sourceRevision,
    imageBase64: Buffer.from("new-image").toString("base64"),
  }, isCurrent);

  assert.equal(image.src, "https://example.com/original.png");
  assert.deepEqual(urlApi.revoked, ["blob:render-0"]);
});

test("renderer rolls back its own stale src assignment after load", async () => {
  const urlApi = makeTrackedUrlApi();
  let nextObjectUrl = 0;
  urlApi.createObjectURL = () => `blob:render-${nextObjectUrl++}`;
  const { Renderer, trackedImages } = loadContentClasses({ urlApi });
  const renderer = new Renderer();
  renderer.fadeOut = async () => undefined;
  const current = {
    imageId: "shared-image",
    operationId: "current-op",
    sourceRevision: "current-rev",
    metadata: { width: 100, height: 100, src: "https://example.com/original.png", srcset: "", sizes: "", pictureSources: [] },
  };
  trackedImages.set(current.imageId, current);
  const image = {
    dataset: {},
    style: {},
    complete: false,
    naturalWidth: 100,
    classList: { add() {} },
    listeners: new Map(),
    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    },
    removeAttribute() {},
  };
  let srcValue = "https://example.com/original.png";
  Object.defineProperty(image, "src", {
    get: () => srcValue,
    set: (value) => {
      srcValue = value;
      if (value === "blob:render-0") {
        trackedImages.set(current.imageId, { ...current, operationId: "new-op", sourceRevision: "new-rev" });
      }
    },
  });
  const isCurrent = () => {
    const entry = trackedImages.get(current.imageId);
    return entry?.operationId === current.operationId && entry?.sourceRevision === current.sourceRevision;
  };

  const rendering = renderer.render(image, {
    imageId: current.imageId,
    operationId: current.operationId,
    sourceRevision: current.sourceRevision,
    imageBase64: Buffer.from("new-image").toString("base64"),
  }, isCurrent);
  await new Promise((resolve) => setImmediate(resolve));
  image.complete = true;
  image.listeners.get("load")();
  await rendering;

  assert.equal(image.src, "https://example.com/original.png");
  assert.deepEqual(urlApi.revoked, ["blob:render-0"]);
});

test("renderer stale rollback does not overwrite a newer src assignment", async () => {
  const urlApi = makeTrackedUrlApi();
  let nextObjectUrl = 0;
  urlApi.createObjectURL = () => `blob:render-${nextObjectUrl++}`;
  const { Renderer, trackedImages } = loadContentClasses({ urlApi });
  const renderer = new Renderer();
  renderer.fadeOut = async () => undefined;
  const current = {
    imageId: "shared-image",
    operationId: "current-op",
    sourceRevision: "current-rev",
    metadata: { width: 100, height: 100, src: "https://example.com/original.png", srcset: "", sizes: "", pictureSources: [] },
  };
  trackedImages.set(current.imageId, current);
  const image = {
    dataset: {},
    style: {},
    complete: false,
    naturalWidth: 100,
    classList: { add() {} },
    listeners: new Map(),
    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    },
    removeAttribute() {},
  };
  let srcValue = "https://example.com/original.png";
  Object.defineProperty(image, "src", {
    get: () => srcValue,
    set: (value) => {
      srcValue = value;
      if (value === "blob:render-0") {
        trackedImages.set(current.imageId, { ...current, operationId: "new-op", sourceRevision: "new-rev" });
        srcValue = "blob:new-operation";
      }
    },
  });
  const isCurrent = () => {
    const entry = trackedImages.get(current.imageId);
    return entry?.operationId === current.operationId && entry?.sourceRevision === current.sourceRevision;
  };

  const rendering = renderer.render(image, {
    imageId: current.imageId,
    operationId: current.operationId,
    sourceRevision: current.sourceRevision,
    imageBase64: Buffer.from("new-image").toString("base64"),
  }, isCurrent);
  await new Promise((resolve) => setImmediate(resolve));
  image.complete = true;
  image.listeners.get("load")();
  await rendering;

  assert.equal(image.src, "blob:new-operation");
  assert.deepEqual(urlApi.revoked, ["blob:render-0"]);
});

test("renderer stale during fade restores the complete captured DOM state", async () => {
  const urlApi = makeTrackedUrlApi();
  urlApi.createObjectURL = () => "blob:stale-fade";
  const { Renderer, trackedImages } = loadContentClasses({ urlApi });
  const renderer = new Renderer();
  const pictureSource = makeRenderElement({
    attributes: { srcset: "picture-old 2x", sizes: "80vw" },
    dataset: { aiMangaOriginalSrcset: "prior-picture-data", aiMangaOriginalSizes: "prior-picture-size" },
  });
  const image = makeRenderElement({
    src: "https://example.com/original.png",
    attributes: { srcset: "old-1x.png 1x", sizes: "50vw" },
    dataset: {
      aiMangaOriginalSrc: "prior-original-data",
      aiMangaOriginalSrcset: "prior-srcset-data",
      aiMangaOriginalSizes: "prior-sizes-data",
    },
    style: { width: "37px", height: "41px" },
    classes: ["ai-manga-upscaler-ready"],
  });
  const entry = {
    imageId: "fade-image",
    operationId: "fade-op",
    sourceRevision: "fade-rev",
    metadata: {
      width: 300,
      height: 500,
      src: image.src,
      srcset: image.getAttribute("srcset"),
      sizes: image.getAttribute("sizes"),
      pictureSources: [{ source: pictureSource, srcset: "picture-old 2x", sizes: "80vw" }],
    },
  };
  trackedImages.set(entry.imageId, entry);
  renderer.fadeOut = async (target) => {
    target.classList.add("ai-manga-upscaler-fading");
    trackedImages.set(entry.imageId, { ...entry, operationId: "replacement-op", sourceRevision: "replacement-rev" });
  };

  const outcome = await renderer.render(image, {
    imageId: entry.imageId,
    operationId: entry.operationId,
    sourceRevision: entry.sourceRevision,
    imageBase64: Buffer.from("new-image").toString("base64"),
  }, () => trackedImages.get(entry.imageId) === entry);

  assert.equal(outcome, "stale");
  assert.equal(image.src, "https://example.com/original.png");
  assert.equal(image.getAttribute("srcset"), "old-1x.png 1x");
  assert.equal(image.getAttribute("sizes"), "50vw");
  assert.deepEqual(image.style, { width: "37px", height: "41px" });
  assert.deepEqual(image.dataset, {
    aiMangaOriginalSrc: "prior-original-data",
    aiMangaOriginalSrcset: "prior-srcset-data",
    aiMangaOriginalSizes: "prior-sizes-data",
  });
  assert.equal(image.classList.contains("ai-manga-upscaler-fading"), false);
  assert.equal(image.classList.contains("ai-manga-upscaler-ready"), true);
  assert.equal(pictureSource.getAttribute("srcset"), "picture-old 2x");
  assert.equal(pictureSource.getAttribute("sizes"), "80vw");
  assert.deepEqual(pictureSource.dataset, {
    aiMangaOriginalSrcset: "prior-picture-data",
    aiMangaOriginalSizes: "prior-picture-size",
  });
  assert.deepEqual(urlApi.revoked, ["blob:stale-fade"]);
});

test("renderer converts blob load error into load-error and exact rollback", async () => {
  const urlApi = makeTrackedUrlApi();
  urlApi.createObjectURL = () => "blob:broken-render";
  const { Renderer, trackedImages } = loadContentClasses({ urlApi });
  const renderer = new Renderer();
  const pictureSource = makeRenderElement({
    attributes: { srcset: "picture-original 2x", sizes: "90vw" },
    dataset: { aiMangaOriginalSrcset: "source-dataset", aiMangaOriginalSizes: "sizes-dataset" },
  });
  const image = makeRenderElement({
    src: "https://example.com/original.png",
    attributes: { srcset: "original-1x.png 1x", sizes: "60vw" },
    dataset: { aiMangaOriginalSrc: "old-data", aiMangaOriginalSrcset: "old-set", aiMangaOriginalSizes: "old-sizes" },
    style: { width: "111px", height: "222px" },
    classes: ["ai-manga-upscaler-ready"],
  });
  const entry = {
    imageId: "broken-image",
    operationId: "broken-op",
    sourceRevision: "broken-rev",
    metadata: {
      width: 400,
      height: 800,
      src: image.src,
      srcset: image.getAttribute("srcset"),
      sizes: image.getAttribute("sizes"),
      pictureSources: [{ source: pictureSource, srcset: "picture-original 2x", sizes: "90vw" }],
    },
  };
  trackedImages.set(entry.imageId, entry);
  renderer.activeObjectUrls.set(image, "blob:previous-active");
  renderer.fadeOut = async (target) => target.classList.add("ai-manga-upscaler-fading");

  const rendering = renderer.render(image, {
    imageId: entry.imageId,
    operationId: entry.operationId,
    sourceRevision: entry.sourceRevision,
    imageBase64: Buffer.from("broken-image").toString("base64"),
  }, () => trackedImages.get(entry.imageId) === entry);
  await new Promise((resolve) => setImmediate(resolve));
  image.dispatch("error");
  const outcome = await rendering;

  assert.equal(outcome, "load-error");
  assert.equal(image.src, "https://example.com/original.png");
  assert.equal(image.getAttribute("srcset"), "original-1x.png 1x");
  assert.equal(image.getAttribute("sizes"), "60vw");
  assert.deepEqual(image.style, { width: "111px", height: "222px" });
  assert.deepEqual(image.dataset, { aiMangaOriginalSrc: "old-data", aiMangaOriginalSrcset: "old-set", aiMangaOriginalSizes: "old-sizes" });
  assert.deepEqual(pictureSource.dataset, { aiMangaOriginalSrcset: "source-dataset", aiMangaOriginalSizes: "sizes-dataset" });
  assert.equal(pictureSource.getAttribute("srcset"), "picture-original 2x");
  assert.equal(pictureSource.getAttribute("sizes"), "90vw");
  assert.equal(image.classList.contains("ai-manga-upscaler-fading"), false);
  assert.equal(image.classList.contains("ai-manga-upscaler-ready"), true);
  assert.equal(renderer.activeObjectUrls.get(image), "blob:previous-active");
  assert.deepEqual(urlApi.revoked, ["blob:broken-render"]);
});

test("renderer success returns rendered and removes fading ownership class", async () => {
  const urlApi = makeTrackedUrlApi();
  urlApi.createObjectURL = () => "blob:render-success";
  const { Renderer, trackedImages } = loadContentClasses({ urlApi });
  const renderer = new Renderer();
  const image = makeRenderElement({ src: "https://example.com/original.png" });
  const entry = {
    imageId: "success-image",
    operationId: "success-op",
    sourceRevision: "success-rev",
    metadata: { width: 100, height: 100, src: image.src, srcset: null, sizes: null, pictureSources: [] },
  };
  trackedImages.set(entry.imageId, entry);
  renderer.fadeOut = async (target) => target.classList.add("ai-manga-upscaler-fading");

  const rendering = renderer.render(image, {
    imageId: entry.imageId,
    operationId: entry.operationId,
    sourceRevision: entry.sourceRevision,
    imageBase64: Buffer.from("success-image").toString("base64"),
  }, () => trackedImages.get(entry.imageId) === entry);
  await new Promise((resolve) => setImmediate(resolve));
  image.complete = true;
  image.dispatch("load");
  const outcome = await rendering;

  assert.equal(outcome, "rendered");
  assert.equal(image.src, "blob:render-success");
  assert.equal(image.classList.contains("ai-manga-upscaler-fading"), false);
  assert.equal(image.classList.contains("ai-manga-upscaler-ready"), true);
  assert.equal(renderer.activeObjectUrls.get(image), "blob:render-success");
});

test("renderer rollback preserves an originally absent src attribute", async () => {
  const urlApi = makeTrackedUrlApi();
  urlApi.createObjectURL = () => "blob:responsive-error";
  const { Renderer, trackedImages } = loadContentClasses({ urlApi });
  const renderer = new Renderer();
  const image = makeRenderElement({
    src: "https://example.com/selected-from-srcset.png",
    attributes: { srcset: "selected-from-srcset.png 2x", sizes: "100vw" },
  });
  const entry = {
    imageId: "responsive-error-image",
    operationId: "responsive-error-op",
    sourceRevision: "responsive-error-rev",
    metadata: {
      imageUrl: image.currentSrc,
      width: 100,
      height: 100,
      src: null,
      srcset: image.getAttribute("srcset"),
      sizes: image.getAttribute("sizes"),
      pictureSources: [],
    },
  };
  trackedImages.set(entry.imageId, entry);
  renderer.fadeOut = async () => undefined;

  const rendering = renderer.render(image, {
    imageId: entry.imageId,
    operationId: entry.operationId,
    sourceRevision: entry.sourceRevision,
    imageBase64: Buffer.from("broken-responsive").toString("base64"),
  }, () => trackedImages.get(entry.imageId) === entry);
  await new Promise((resolve) => setImmediate(resolve));
  image.dispatch("error");

  assert.equal(await rendering, "load-error");
  assert.equal(image.hasAttribute("src"), false);
  assert.equal(image.getAttribute("srcset"), "selected-from-srcset.png 2x");
});

test("superseding a render settles the old load wait without a DOM event", async () => {
  const urlApi = makeTrackedUrlApi();
  let objectUrlSequence = 0;
  urlApi.createObjectURL = () => `blob:overlap-${objectUrlSequence++}`;
  const { Renderer, trackedImages } = loadContentClasses({ urlApi });
  const renderer = new Renderer();
  renderer.fadeOut = async () => undefined;
  const image = makeRenderElement({ src: "https://example.com/original-overlap.png", attributes: { src: "https://example.com/original-overlap.png" } });
  const firstEntry = {
    imageId: "overlap-image",
    operationId: "overlap-op-1",
    sourceRevision: "overlap-rev-1",
    metadata: { imageUrl: image.src, width: 100, height: 100, src: image.src, srcset: null, sizes: null, pictureSources: [] },
  };
  trackedImages.set(firstEntry.imageId, firstEntry);
  const firstRender = renderer.render(image, {
    imageId: firstEntry.imageId,
    operationId: firstEntry.operationId,
    sourceRevision: firstEntry.sourceRevision,
    imageBase64: Buffer.from("first-render").toString("base64"),
  }, () => trackedImages.get(firstEntry.imageId) === firstEntry);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(image.src, "blob:overlap-0");

  const secondEntry = {
    ...firstEntry,
    operationId: "overlap-op-2",
    sourceRevision: "overlap-rev-2",
  };
  trackedImages.set(secondEntry.imageId, secondEntry);
  const secondRender = renderer.render(image, {
    imageId: secondEntry.imageId,
    operationId: secondEntry.operationId,
    sourceRevision: secondEntry.sourceRevision,
    imageBase64: Buffer.from("second-render").toString("base64"),
  }, () => trackedImages.get(secondEntry.imageId) === secondEntry);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(await waitForSettled([firstRender], 50), "settled");
  assert.equal(await firstRender, "stale");
  assert.equal(image.src, "blob:overlap-1");
  image.complete = true;
  image.dispatch("load");
  assert.equal(await secondRender, "rendered");
  assert.deepEqual(urlApi.revoked, ["blob:overlap-0"]);
});

test("responsive-only render preserves the selected original source identity", async () => {
  const urlApi = makeTrackedUrlApi();
  urlApi.createObjectURL = () => "blob:responsive-success";
  const { Renderer, trackedImages } = loadContentClasses({ urlApi });
  const renderer = new Renderer();
  renderer.fadeOut = async () => undefined;
  const selectedUrl = "https://example.com/responsive-selected.png";
  const image = makeRenderElement({
    src: selectedUrl,
    attributes: { srcset: "responsive-selected.png 2x", sizes: "100vw" },
  });
  const entry = {
    imageId: "responsive-success-image",
    operationId: "responsive-success-op",
    sourceRevision: "responsive-success-rev",
    metadata: {
      imageUrl: selectedUrl,
      width: 100,
      height: 100,
      src: null,
      srcset: image.getAttribute("srcset"),
      sizes: image.getAttribute("sizes"),
      pictureSources: [],
    },
  };
  trackedImages.set(entry.imageId, entry);

  const rendering = renderer.render(image, {
    imageId: entry.imageId,
    operationId: entry.operationId,
    sourceRevision: entry.sourceRevision,
    imageBase64: Buffer.from("responsive-success").toString("base64"),
  }, () => trackedImages.get(entry.imageId) === entry);
  await new Promise((resolve) => setImmediate(resolve));
  image.complete = true;
  image.dispatch("load");

  assert.equal(await rendering, "rendered");
  assert.equal(image.dataset.aiMangaOriginalSrc, selectedUrl);
  assert.equal(renderer.isOwnedSource(image), true);
});

test("content completion clears a load-error without marking the source completed", async () => {
  const { viewportProvider, trackedImages, trackedImageKeys, completedImageKeys } = makeContentProvider({
    renderer: {
      render: async () => "load-error",
      installRawSlices: () => [],
      waitForImageLoad: async () => undefined,
    },
  });
  const image = makeTallImage("load-error");
  const entry = {
    imageId: "load-error-image",
    operationId: "load-error-op",
    sourceRevision: "load-error-rev",
    baseKey: "load-error-rev",
    image,
    metadata: { imageUrl: image.src },
    state: "waiting",
  };
  trackedImages.set(entry.imageId, entry);
  trackedImageKeys.set(entry.baseKey, entry);

  const outcome = await viewportProvider.complete({
    type: "UPSCALE_COMPLETE",
    imageId: entry.imageId,
    operationId: entry.operationId,
    sourceRevision: entry.sourceRevision,
    imageBase64: "broken",
  });

  assert.equal(outcome, "load-error");
  assert.equal(trackedImages.has(entry.imageId), false);
  assert.equal(trackedImageKeys.has(entry.baseKey), false);
  assert.equal(completedImageKeys.has(entry.baseKey), false);
});

test("queue distinguishes operations with the same image id", () => {
  const QueueScheduler = loadQueueScheduler();
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 0,
    cacheProvider: {},
    upscaleProvider: { cancel() {} },
    statisticsTracker: {},
  });

  scheduler.enqueue(makeJob("same"));
  scheduler.enqueue({ ...makeJob("same"), operationId: "same-op-2", sourceRevision: "same-rev-2" });

  assert.equal(scheduler.pending.size, 2);
});

test("operationless scheduler cancel cannot use image id as authority", () => {
  const QueueScheduler = loadQueueScheduler();
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 0,
    cacheProvider: {},
    upscaleProvider: { cancel() {} },
    statisticsTracker: {},
  });
  scheduler.enqueue(makeJob("shared"));
  scheduler.enqueue({ ...makeJob("shared"), operationId: "shared-op-2", sourceRevision: "shared-rev-2" });

  scheduler.cancel(7, "shared", null);

  assert.equal(scheduler.pending.size, 2);
});

test("scheduler cancel is isolated by tab and operation", () => {
  const QueueScheduler = loadQueueScheduler();
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 0,
    cacheProvider: {},
    upscaleProvider: { cancel() {} },
    statisticsTracker: {},
  });
  scheduler.enqueue(makeJob("collision"));
  scheduler.enqueue({ ...makeJob("collision"), tabId: 8 });

  scheduler.cancel(8, "collision", "collision-op-1");

  assert.deepEqual([...scheduler.pending.values()].map((job) => job.tabId), [7]);
});

test("delayed retry from an old operation cannot resurrect after replacement", async () => {
  const fakeTimers = makeFakeTimers();
  const QueueScheduler = loadQueueScheduler({ timers: fakeTimers.api });
  const replacementRun = deferred();
  const calls = [];
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 1,
    cacheProvider: { get: async () => null, set: async () => undefined },
    upscaleProvider: {
      upscale: (_url, options) => {
        calls.push(options.jobId);
        if (options.jobId.endsWith(":old-op")) return Promise.reject(new Error("retry old"));
        return replacementRun.promise;
      },
      cancel() {},
    },
    statisticsTracker: { recordSuccess: async () => undefined, recordError: async () => undefined },
  });
  scheduler.enqueue({ ...makeJob("retry-image"), operationId: "old-op", sourceRevision: "old-rev" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  scheduler.cancel(7, "retry-image", "old-op");
  scheduler.enqueue({ ...makeJob("retry-image"), operationId: "new-op", sourceRevision: "new-rev" });
  await new Promise((resolve) => setImmediate(resolve));

  fakeTimers.runNext();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal([...scheduler.pending.values()].some((job) => job.operationId === "old-op"), false);
  assert.equal([...scheduler.active.values()].some((job) => job.operationId === "old-op"), false);
  assert.deepEqual(calls, ["7:retry-image:old-op", "7:retry-image:new-op"]);
  scheduler.cancelAll();
  replacementRun.resolve({});
});

test("cancel during cache-hit statistics cannot send stale completion", async () => {
  const statistics = deferred();
  const statisticsStarted = deferred();
  const sent = [];
  const QueueScheduler = loadQueueScheduler({
    tabsSendMessage: async (_tabId, message) => { sent.push(message); },
  });
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 1,
    cacheProvider: {
      get: async () => ({ buffer: new Uint8Array([1]).buffer, contentType: "image/png" }),
      set: async () => undefined,
    },
    upscaleProvider: { cancel() {} },
    statisticsTracker: {
      recordSuccess: async () => {
        statisticsStarted.resolve();
        await statistics.promise;
      },
      recordError: async () => undefined,
    },
  });
  const job = makeJob("cache-race");
  scheduler.enqueue(job);
  await statisticsStarted.promise;

  scheduler.cancel(job.tabId, job.imageId, job.operationId);
  statistics.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.some((message) => message.type === "UPSCALE_COMPLETE"), false);
});

test("cache identity prefers source fingerprint for different bytes under same url", async () => {
  const QueueScheduler = loadQueueScheduler();
  const keys = [];
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 1,
    cacheProvider: { get: async (key) => { keys.push(key); return null; }, set: async () => undefined },
    upscaleProvider: { upscale: async () => ({ buffer: new Uint8Array([1]).buffer, contentType: "image/png" }), cancel() {} },
    statisticsTracker: { recordSuccess: async () => undefined, recordError: async () => undefined },
  });

  scheduler.enqueue({ ...makeJob("same"), imageUrl: "https://example.com/page.jpg?v=1", imageData: "AAAA", sourceFingerprint: "sha256-a" });
  scheduler.enqueue({ ...makeJob("other"), imageUrl: "https://example.com/page.jpg?v=1", imageData: "BBBB", sourceFingerprint: "sha256-b" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.ok(keys[0].includes("sha256-a"));
  assert.ok(keys[1].includes("sha256-b"));
});

test("cache identity preserves full query when source fingerprint is unavailable", async () => {
  const QueueScheduler = loadQueueScheduler();
  const keys = [];
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 1,
    cacheProvider: { get: async (key) => { keys.push(key); return null; }, set: async () => undefined },
    upscaleProvider: { upscale: async () => ({ buffer: new Uint8Array([1]).buffer, contentType: "image/png" }), cancel() {} },
    statisticsTracker: { recordSuccess: async () => undefined, recordError: async () => undefined },
  });

  scheduler.enqueue({ ...makeJob("signed-a"), imageUrl: "https://cdn.example.com/page.jpg?token=a&signature=one", sourceFingerprint: null });
  scheduler.enqueue({ ...makeJob("signed-b"), imageUrl: "https://cdn.example.com/page.jpg?token=b&signature=two", sourceFingerprint: null });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.ok(keys[0].includes("token=a"));
  assert.ok(keys[1].includes("token=b"));
});

test("segment cache identity includes parent fingerprint as well as coordinates", async () => {
  const QueueScheduler = loadQueueScheduler();
  const keys = [];
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 1,
    cacheProvider: { get: async (key) => { keys.push(key); return null; }, set: async () => undefined },
    upscaleProvider: { upscale: async () => ({ buffer: new Uint8Array([1]).buffer, contentType: "image/png" }), cancel() {} },
    statisticsTracker: { recordSuccess: async () => undefined, recordError: async () => undefined },
  });
  const segmentJob = {
    ...makeJob("parent-a-seg-0"),
    sourceFingerprint: "sha256:same-segment-bytes",
    parentSourceFingerprint: "sha256:parent-a",
    cacheVariant: "segment-0-0-1000",
  };
  scheduler.enqueue(segmentJob);
  scheduler.enqueue({
    ...segmentJob,
    imageId: "parent-b-seg-0",
    operationId: "parent-b-op-seg-0",
    sourceRevision: "parent-b-rev#segment:0:0:1000",
    parentSourceFingerprint: "sha256:parent-b",
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.ok(keys[0].includes("sha256:parent-a"));
  assert.ok(keys[1].includes("sha256:parent-b"));
});

test("tall images can enter slicing even when max input height is enabled", () => {
  const { ImageProvider, ViewportImageProvider } = loadContentClasses();
  const viewportProvider = new ViewportImageProvider({
    imageProvider: new ImageProvider({
      minInputWidthEnabled: true,
      minInputHeightEnabled: true,
      maxInputWidthEnabled: true,
      maxInputHeightEnabled: true,
      minInputWidth: 128,
      minInputHeight: 128,
      maxInputWidth: 8000,
      maxInputHeight: 12000,
    }),
    renderer: {},
  });
  viewportProvider.imageSlicingEnabled = true;
  viewportProvider.imageSliceMaxHeight = 2200;
  const tallImage = {
    naturalWidth: 900,
    naturalHeight: 20000,
    clientWidth: 900,
    clientHeight: 20000,
    getBoundingClientRect: () => ({ width: 900, height: 20000 }),
  };

  assert.equal(viewportProvider.shouldSliceImage(tallImage), true);
  assert.equal(viewportProvider.canProcessCandidate(tallImage), true);
});

test("minimum image boundary follows the documented 300px contract", () => {
  const { ImageProvider, config } = loadContentClasses();
  const imageProvider = new ImageProvider({
    minInputWidthEnabled: true,
    minInputHeightEnabled: true,
    maxInputWidthEnabled: true,
    maxInputHeightEnabled: true,
    minInputWidth: config.images.minWidthPx,
    minInputHeight: config.images.minHeightPx,
    maxInputWidth: config.images.maxWidthPx,
    maxInputHeight: config.images.maxHeightPx,
  });
  const image = (width, height) => ({ naturalWidth: width, naturalHeight: height, closest: () => null });

  assert.equal(config.images.minWidthPx, 300);
  assert.equal(config.images.minHeightPx, 300);
  assert.equal(imageProvider.canProcess(image(299, 299)), false);
  assert.equal(imageProvider.canProcess(image(300, 300)), true);
  assert.equal(imageProvider.canProcess(image(301, 301)), true);
  assert.equal(imageProvider.canProcess(image(300, 100)), false);
  assert.equal(imageProvider.canProcess(image(100, 300)), false);
});

test("image-limit message fallback reuses the configured 300px minimum", async () => {
  const stored = [];
  const responses = [];
  const { dispatch } = loadBackgroundMessageHarness({
    storageSet: async (value) => stored.push(value),
  });

  assert.equal(dispatch({ type: "SET_IMAGE_LIMITS" }, {}, (response) => responses.push(response)), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(stored.length, 1);
  assert.equal(stored[0].minInputWidth, 300);
  assert.equal(stored[0].minInputHeight, 300);
  assert.equal(responses[0].minInputWidth, 300);
  assert.equal(responses[0].minInputHeight, 300);
});

test("extremely tall slicing covers every source row exactly once", async () => {
  const drawCalls = [];
  const { ViewportImageProvider } = loadContentClasses({
    createElement: (tagName) => {
      assert.equal(tagName, "canvas");
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (...args) => drawCalls.push(args),
        }),
      };
    },
  });
  const provider = new ViewportImageProvider({ imageProvider: {}, renderer: {} });
  provider.imageSliceMaxHeight = 2200;
  provider.decodeBase64Image = async () => ({ width: 512, height: 16384 });
  provider.canvasToSegmentPayload = async (canvas) => ({ objectUrl: `blob:${canvas.height}`, imageData: String(canvas.height) });
  const image = makeTallImage("extreme-tall");
  image.naturalWidth = 512;
  image.naturalHeight = 16384;
  image.clientWidth = 512;
  image.clientHeight = 16384;
  image.getBoundingClientRect = () => ({ width: 512, height: 16384, top: 0, bottom: 16384, left: 0, right: 512 });

  const segments = await provider.cropImageSegments("synthetic-source", image);

  assert.ok(segments.length > 1);
  assert.equal(segments[0].sourceY, 0);
  assert.equal(segments.at(-1).sourceY + segments.at(-1).sourceHeight, 16384);
  assert.equal(segments.reduce((total, segment) => total + segment.sourceHeight, 0), 16384);
  for (let index = 1; index < segments.length; index += 1) {
    assert.equal(segments[index].index, index);
    assert.equal(segments[index].sourceY, segments[index - 1].sourceY + segments[index - 1].sourceHeight);
  }
  assert.equal(drawCalls.length, segments.length);
});

test("extremely wide images never enter vertical slicing and are rejected safely", () => {
  const { ImageProvider, ViewportImageProvider, config } = loadContentClasses();
  const imageProvider = new ImageProvider({
    minInputWidthEnabled: true,
    minInputHeightEnabled: true,
    maxInputWidthEnabled: true,
    maxInputHeightEnabled: true,
    minInputWidth: 300,
    minInputHeight: 300,
    maxInputWidth: config.images.maxWidthPx,
    maxInputHeight: config.images.maxHeightPx,
  });
  const provider = new ViewportImageProvider({ imageProvider, renderer: {} });
  provider.imageSlicingEnabled = true;
  provider.imageSliceMaxHeight = 2200;
  const image = makeTallImage("extreme-wide");
  image.naturalWidth = 16384;
  image.naturalHeight = 512;
  image.clientWidth = 16384;
  image.clientHeight = 512;
  image.getBoundingClientRect = () => ({ width: 16384, height: 512, top: 0, bottom: 512, left: 0, right: 16384 });

  assert.equal(provider.shouldSliceImage(image), false);
  assert.equal(provider.canProcessCandidate(image), false);
});

test("candidate evaluator rejects hidden and transparent images", () => {
  const { viewportProvider } = makeContentProvider();
  const hidden = makeTallImage("hidden");
  hidden.style.display = "none";
  const transparent = makeTallImage("transparent");
  transparent.style.opacity = "0";

  assert.equal(viewportProvider.canProcessCandidate(hidden), false);
  assert.equal(viewportProvider.canProcessCandidate(transparent), false);
});

test("candidate evaluator rejects mostly occluded images", () => {
  const image = makeTallImage("occluded");
  const overlay = { id: "overlay" };
  const { viewportProvider } = makeContentProvider({
    elementsFromPoint: () => [overlay, image],
  });

  assert.equal(viewportProvider.canProcessCandidate(image), false);
});

test("candidate evaluator rejects an opaque blocker covering three of five probes", () => {
  const image = makeTallImage("majority-occluded");
  const overlay = { style: { opacity: "1", pointerEvents: "auto" } };
  let probe = 0;
  const { viewportProvider } = makeContentProvider({
    elementsFromPoint: () => {
      probe += 1;
      return probe <= 3 ? [overlay, image] : [image];
    },
  });

  assert.equal(viewportProvider.canProcessCandidate(image), false);
});

test("candidate evaluator accepts an anchor or container covering its image", () => {
  const image = makeTallImage("anchor");
  const anchor = { style: {}, contains: (node) => node === image };
  const { viewportProvider } = makeContentProvider({
    elementsFromPoint: () => [anchor, image],
  });

  assert.equal(viewportProvider.canProcessCandidate(image), true);
});

test("candidate evaluator ignores pointer-events none overlays", () => {
  const image = makeTallImage("pointer-overlay");
  const overlay = { style: { pointerEvents: "none", opacity: "1" } };
  const { viewportProvider } = makeContentProvider({
    elementsFromPoint: () => [overlay, image],
  });

  assert.equal(viewportProvider.canProcessCandidate(image), true);
});

test("candidate evaluator ignores nearly transparent overlays", () => {
  const image = makeTallImage("transparent-overlay");
  const overlay = { style: { pointerEvents: "auto", opacity: "0.02" } };
  const { viewportProvider } = makeContentProvider({
    elementsFromPoint: () => [overlay, image],
  });

  assert.equal(viewportProvider.canProcessCandidate(image), true);
});

test("candidate evaluator accepts partially visible tall comic images", () => {
  const image = makeTallImage("comic");
  image.getBoundingClientRect = () => ({ width: 900, height: 4000, top: -1200, bottom: 2800, left: 0, right: 900 });
  const { viewportProvider } = makeContentProvider({
    elementsFromPoint: () => [image],
  });

  assert.equal(viewportProvider.canProcessCandidate(image), true);
});

test("intersection prefetch schedules offscreen images inside root margin", async () => {
  const { viewportProvider, sentMessages, HTMLImageElement } = makeContentProvider();
  const image = makeTallImage("prefetch");
  Object.setPrototypeOf(image, HTMLImageElement.prototype);
  image.naturalHeight = 900;
  image.clientHeight = 900;
  image.height = 900;
  image.getBoundingClientRect = () => ({ width: 900, height: 900, top: 950, bottom: 1850, left: 0, right: 900 });

  viewportProvider.handleIntersections([{ target: image, isIntersecting: true }]);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE").length, 1);
});

test("initial discovery registers but does not preprocess images outside the prefetch margin", async () => {
  const { viewportProvider, sentMessages, HTMLImageElement } = makeContentProvider();
  const image = new HTMLImageElement();
  image.src = "https://example.com/offscreen-discovery.png";
  image.currentSrc = image.src;
  image.naturalWidth = 900;
  image.naturalHeight = 900;
  image.clientWidth = 900;
  image.clientHeight = 900;
  image.width = 900;
  image.height = 900;
  image.getBoundingClientRect = () => ({ width: 900, height: 900, top: 5000, bottom: 5900, left: 0, right: 900 });

  viewportProvider.observeImage(image);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sentMessages.filter((message) => message.type === "IMAGE_SEEN").length, 1);
  assert.equal(sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE").length, 0);
});

test("preprocessing started is emitted only after an operation owns a slot", async () => {
  const firstRead = deferred();
  const { viewportProvider, sentMessages } = makeContentProvider({
    preprocessingConcurrency: 1,
    readDisplayedImage: (imageUrl) => imageUrl.includes("first") ? firstRead.promise : "second-data",
  });
  const first = makeTallImage("first");
  const second = makeTallImage("second");
  first.naturalHeight = second.naturalHeight = 900;
  first.clientHeight = second.clientHeight = 900;
  first.height = second.height = 900;
  first.getBoundingClientRect = second.getBoundingClientRect = () => ({ width: 900, height: 900, top: 0, bottom: 900, left: 0, right: 900 });

  const firstScheduled = viewportProvider.schedule(first);
  const secondScheduled = viewportProvider.schedule(second);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sentMessages.filter((message) => message.type === "PREPROCESSING_QUEUED").length, 2);
  assert.equal(sentMessages.filter((message) => message.type === "PREPROCESSING_STARTED").length, 1);

  firstRead.resolve("first-data");
  await Promise.all([firstScheduled, secondScheduled]);
  assert.equal(sentMessages.filter((message) => message.type === "PREPROCESSING_STARTED").length, 2);
});

test("preprocessing queue prioritizes the nearest viewport waiter", async () => {
  const activeRead = deferred();
  const readOrder = [];
  const { viewportProvider } = makeContentProvider({
    preprocessingConcurrency: 1,
    readDisplayedImage: (imageUrl) => {
      readOrder.push(imageUrl);
      return imageUrl.includes("active") ? activeRead.promise : "image-data";
    },
  });
  const active = makeTallImage("active");
  const far = makeTallImage("far");
  const near = makeTallImage("near");
  for (const image of [active, far, near]) {
    image.naturalHeight = image.clientHeight = image.height = 900;
  }
  active.getBoundingClientRect = () => ({ width: 900, height: 900, top: 0, bottom: 900, left: 0, right: 900 });
  far.getBoundingClientRect = () => ({ width: 900, height: 900, top: 3000, bottom: 3900, left: 0, right: 900 });
  near.getBoundingClientRect = () => ({ width: 900, height: 900, top: 1000, bottom: 1900, left: 0, right: 900 });

  const scheduled = [viewportProvider.schedule(active), viewportProvider.schedule(far, true, { allowPrefetch: true }), viewportProvider.schedule(near, true, { allowPrefetch: true })];
  await new Promise((resolve) => setImmediate(resolve));
  activeRead.resolve("active-data");
  await Promise.all(scheduled);

  assert.match(readOrder[0], /active/);
  assert.match(readOrder[1], /near/);
  assert.match(readOrder[2], /far/);
});

test("a detached queued operation is cancelled before it can acquire a slot", async () => {
  const activeRead = deferred();
  const readOrder = [];
  const { viewportProvider, sentMessages, trackedImages } = makeContentProvider({
    preprocessingConcurrency: 1,
    readDisplayedImage: (imageUrl) => {
      readOrder.push(imageUrl);
      return imageUrl.includes("active") ? activeRead.promise : "queued-data";
    },
  });
  const active = makeTallImage("active");
  const queued = makeTallImage("queued-detached");
  for (const image of [active, queued]) {
    image.naturalHeight = image.clientHeight = image.height = 900;
    image.getBoundingClientRect = () => ({ width: 900, height: 900, top: 0, bottom: 900, left: 0, right: 900 });
  }

  const first = viewportProvider.schedule(active);
  const second = viewportProvider.schedule(queued);
  await new Promise((resolve) => setImmediate(resolve));
  viewportProvider.cancel(trackedImages.get(queued.dataset.aiEnhancerImageId));
  activeRead.resolve("active-data");
  await Promise.all([first, second]);

  assert.equal(readOrder.some((url) => url.includes("queued-detached")), false);
  assert.equal(viewportProvider.preprocessingWaiters.length, 0);
  assert.equal(sentMessages.filter((message) => message.type === "CANCEL_IMAGE").length, 1);
});

test("twenty-three candidates expose only three active preprocessing operations", async () => {
  const reads = [];
  const { viewportProvider, sentMessages, trackedImages } = makeContentProvider({
    preprocessingConcurrency: 3,
    readDisplayedImage: () => {
      const pending = deferred();
      reads.push(pending);
      return pending.promise;
    },
  });
  const images = Array.from({ length: 23 }, (_, index) => {
    const image = makeTallImage(`chapter-${index}`);
    image.naturalHeight = image.clientHeight = image.height = 900;
    image.getBoundingClientRect = () => ({ width: 900, height: 900, top: 0, bottom: 900, left: 0, right: 900 });
    return image;
  });

  const schedules = images.map((image) => viewportProvider.schedule(image));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sentMessages.filter((message) => message.type === "PREPROCESSING_QUEUED").length, 23);
  assert.equal(sentMessages.filter((message) => message.type === "PREPROCESSING_STARTED").length, 3);
  assert.equal(viewportProvider.preprocessingActive, 3);
  assert.equal(viewportProvider.preprocessingWaiters.length, 20);

  [...trackedImages.values()]
    .filter((entry) => entry.state === "preprocessing_queued")
    .forEach((entry) => viewportProvider.cancel(entry));
  reads.forEach((read) => read.resolve("image-data"));
  await Promise.all(schedules);

  assert.equal(viewportProvider.preprocessingActive, 0);
  assert.equal(viewportProvider.preprocessingWaiters.length, 0);
});

test("candidate evaluator rejects explicitly marked interface and advertising images", () => {
  const { ImageProvider, ViewportImageProvider } = loadContentClasses();
  const viewportProvider = new ViewportImageProvider({
    imageProvider: new ImageProvider({
      minInputWidthEnabled: false,
      minInputHeightEnabled: false,
      maxInputWidthEnabled: false,
      maxInputHeightEnabled: false,
    }),
    renderer: {},
  });
  const advertisement = makeTallImage("advertisement");
  advertisement.alt = "Advertisement";
  const navigationIcon = makeTallImage("navigation-icon");
  navigationIcon.closest = (selector) => selector.includes("nav") ? { tagName: "NAV" } : null;

  assert.equal(viewportProvider.canProcessCandidate(advertisement), false);
  assert.equal(viewportProvider.canProcessCandidate(navigationIcon), false);
});

test("DISCOVERY-002 candidate evaluator rejects reader chrome outside explicit page containers", () => {
  const { ImageProvider } = loadContentClasses();
  const imageProvider = new ImageProvider({
    minInputWidthEnabled: false,
    minInputHeightEnabled: false,
    maxInputWidthEnabled: false,
    maxInputHeightEnabled: false,
  });
  const pageContainer = {};
  const reader = {
    classList: { contains: (name) => name === "reading-detail" || name === "box_doc" },
    querySelector: (selector) => selector === ".page-chapter img" ? {} : null,
  };
  const banner = makeTallImage("reader-chrome");
  banner.src = "https://reader.example.test/images/bn.png";
  banner.currentSrc = banner.src;
  banner.alt = "Reader online";
  banner.parentElement = reader;
  banner.closest = () => null;

  const chapter = makeTallImage("chapter-page");
  chapter.parentElement = reader;
  chapter.closest = (selector) => selector === ".page-chapter" ? pageContainer : null;

  assert.equal(imageProvider.canProcess(banner), false);
  assert.equal(imageProvider.canProcess(chapter), true);
});

test("candidate evaluator rejects fixed banner overlays", () => {
  const banner = makeTallImage("banner");
  banner.naturalHeight = 500;
  banner.clientHeight = 500;
  banner.height = 500;
  banner.style.position = "fixed";
  banner.getBoundingClientRect = () => ({ width: 1200, height: 500, top: 0, bottom: 500, left: 0, right: 1200 });
  const { viewportProvider } = makeContentProvider({
    elementsFromPoint: () => [banner],
  });

  assert.equal(viewportProvider.canProcessCandidate(banner), false);
});

test("raw slices are not rediscovered as candidates", () => {
  const { viewportProvider } = makeContentProvider();
  const raw = makeTallImage("raw");
  raw.dataset.aiEnhancerRawSlice = "true";

  assert.equal(viewportProvider.canProcessCandidate(raw), false);
});

test("segmentation fallback settles when all preprocessing slots are held by null reads", async () => {
  const { viewportProvider, sentMessages } = makeContentProvider({
    readDisplayedImage: async () => null,
  });
  const slotStats = instrumentPreprocessingSlots(viewportProvider);
  const images = [0, 1, 2].map(makeTallImage);

  const result = await waitForSettled(images.map((image) => viewportProvider.schedule(image)));

  assert.equal(result, "settled");
  assert.equal(sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE").length, 3, JSON.stringify(sentMessages));
  assert.equal(slotStats.acquired, slotStats.released);
  assert.ok(slotStats.maxActive <= viewportProvider.preprocessingConcurrency);
  assert.ok(slotStats.minActive >= 0);
});

test("slicing reports preprocessing before reading or cropping the long image", async () => {
  const read = deferred();
  const { viewportProvider, sentMessages } = makeContentProvider({
    readDisplayedImage: () => read.promise,
  });
  const scheduled = viewportProvider.schedule(makeTallImage("preprocessing-state"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sentMessages.filter((message) => message.type === "PREPROCESSING_STARTED").length, 1);

  read.resolve(null);
  await scheduled;
});

test("read-null fallback reuses the failed read and does not read the image twice", async () => {
  let readCount = 0;
  const { viewportProvider, sentMessages } = makeContentProvider({
    readDisplayedImage: async () => {
      readCount += 1;
      return null;
    },
  });
  const image = makeTallImage(0);

  const result = await waitForSettled([viewportProvider.schedule(image)]);
  const enqueued = sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE");

  assert.equal(result, "settled");
  assert.equal(readCount, 1);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].imageData, null);
});

test("slicing fallback reports reason without sending REMOVE_IMAGE for an unenqueued parent", async () => {
  const { viewportProvider, sentMessages } = makeContentProvider({
    cropImageSegments: () => {
      throw new Error("slice failed");
    },
  });

  const result = await waitForSettled([viewportProvider.schedule(makeTallImage(0))]);

  assert.equal(result, "settled");
  assert.equal(sentMessages.filter((message) => message.type === "REMOVE_IMAGE").length, 0);
  assert.deepEqual(
    sentMessages.filter((message) => message.type === "PREPROCESSING_FALLBACK").map((message) => message.reason),
    ["slice-encode-error"],
  );
  assert.equal(sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE").length, 1);
});

test("segmentation fallback settles when all preprocessing slots are held by slicing errors", async () => {
  const { viewportProvider, sentMessages } = makeContentProvider({
    cropImageSegments: () => {
      throw new Error("slice failed");
    },
  });
  const slotStats = instrumentPreprocessingSlots(viewportProvider);
  const images = [0, 1, 2].map(makeTallImage);

  const result = await waitForSettled(images.map((image) => viewportProvider.schedule(image)));

  assert.equal(result, "settled");
  assert.equal(sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE").length, 3);
  assert.equal(sentMessages.filter((message) => message.type === "REMOVE_IMAGE").length, 0);
  assert.equal(slotStats.acquired, slotStats.released);
  assert.ok(slotStats.maxActive <= viewportProvider.preprocessingConcurrency);
  assert.ok(slotStats.minActive >= 0);
});

test("late slicing completion after timeout is ignored", async () => {
  const lateSlice = deferred();
  const { viewportProvider, sentMessages } = makeContentProvider({
    cropImageSegments: () => lateSlice.promise,
    renderer: {
      installRawSlices: () => {
        throw new Error("late segments must not render");
      },
      waitForImageLoad: async () => undefined,
    },
  });
  const slotStats = instrumentPreprocessingSlots(viewportProvider);
  viewportProvider.withTimeout = (promise) => {
    promise.catch(() => {});
    return Promise.reject(new Error("Image segmentation timed out."));
  };
  const image = makeTallImage(0);

  const result = await waitForSettled([viewportProvider.schedule(image)]);
  lateSlice.resolve([{
    index: 0,
    sourceY: 0,
    sourceHeight: 1000,
    renderedHeight: 1000,
    objectUrl: "blob:late",
    imageData: "late-segment",
  }]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result, "settled");
  assert.equal(sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE").length, 1);
  assert.equal(sentMessages.find((message) => message.type === "ENQUEUE_IMAGE").cacheVariant, "full");
  assert.equal(slotStats.acquired, slotStats.released);
});

test("slice timeout settles fallback once and revokes late segment object URLs", async () => {
  const lateSlice = deferred();
  const fakeTimers = makeFakeTimers();
  const urlApi = makeTrackedUrlApi();
  const { viewportProvider, sentMessages } = makeContentProvider({
    cropImageSegments: () => lateSlice.promise,
    timers: fakeTimers.api,
    urlApi,
    renderer: {
      installRawSlices: () => {
        throw new Error("late segments must not render");
      },
      waitForImageLoad: async () => undefined,
    },
  });
  const slotStats = instrumentPreprocessingSlots(viewportProvider);
  const scheduled = viewportProvider.schedule(makeTallImage(0));
  await new Promise((resolve) => setImmediate(resolve));

  fakeTimers.runNext();
  const result = await waitForSettled([scheduled]);
  lateSlice.resolve([{
    index: 0,
    sourceY: 0,
    sourceHeight: 1000,
    renderedHeight: 1000,
    objectUrl: "blob:late",
    imageData: "late-segment",
  }]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result, "settled");
  assert.equal(viewportProvider.preprocessingActive, 0);
  assert.equal(viewportProvider.preprocessingWaiters.length, 0);
  assert.equal(sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE").length, 1);
  assert.equal(sentMessages.find((message) => message.type === "ENQUEUE_IMAGE").cacheVariant, "full");
  assert.equal(sentMessages.filter((message) => String(message.cacheVariant).startsWith("segment-")).length, 0);
  assert.equal(sentMessages.filter((message) => message.type === "REMOVE_IMAGE").length, 0);
  assert.deepEqual(urlApi.revoked, ["blob:late"]);
  assert.equal(slotStats.acquired, slotStats.released);
});

test("raw slice load error rolls back DOM and falls back to the full image", async () => {
  const urlApi = makeTrackedUrlApi();
  const rawImages = [];
  const { Renderer } = loadContentClasses({
    urlApi,
    onImageCreated: (rawImage) => rawImages.push(rawImage),
  });
  const renderer = new Renderer();
  const image = makeTallImage("rollback");
  image.parentNode = {
    inserted: [],
    insertBefore(wrapper) {
      this.inserted.push(wrapper);
      wrapper.parentNode = this;
    },
  };
  image.parentNode.removeChild = (wrapper) => {
    wrapper.removed = true;
  };
  const { viewportProvider, sentMessages } = makeContentProvider({
    urlApi,
    renderer,
    cropImageSegments: () => [{
      index: 0,
      sourceY: 0,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: "blob:segment-0",
      imageData: "segment-data",
    }],
  });
  viewportProvider.withTimeout = async (promise) => promise;

  const scheduled = viewportProvider.schedule(image);
  while (rawImages.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  rawImages[0].dispatch("error");
  const result = await scheduled.then(() => "settled", () => "rejected");

  assert.equal(result, "settled");
  assert.equal(image.style.display || "", "");
  assert.equal(image.dataset.aiEnhancerSliced, undefined);
  const enqueued = sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE");
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].cacheVariant, "full");
  assert.equal(sentMessages.filter((message) => message.type === "PREPROCESSING_FALLBACK").length, 1);
  assert.deepEqual(sentMessages.filter((message) => message.type === "REMOVE_IMAGE"), []);
  assert.deepEqual(urlApi.revoked, ["blob:segment-0"]);
});

test("raw slice rollback removes active object URLs and is idempotent", () => {
  const urlApi = makeTrackedUrlApi();
  const rawImages = [];
  const { Renderer } = loadContentClasses({
    urlApi,
    onImageCreated: (rawImage) => rawImages.push(rawImage),
  });
  const renderer = new Renderer();
  const image = makeTallImage("rollback-idempotent");
  image.parentNode = {
    insertBefore(wrapper) {
      wrapper.parentNode = this;
    },
    removeChild(wrapper) {
      wrapper.removed = true;
      wrapper.parentNode = null;
    },
  };
  const transaction = renderer.prepareRawSlices(
    image,
    { width: 900 },
    [{ index: 0, renderedHeight: 1000, objectUrl: "blob:segment-0" }],
  );
  const [rawImage] = rawImages;

  assert.equal(renderer.activeObjectUrls.get(rawImage), "blob:segment-0");
  transaction.rollback();
  transaction.rollback();

  assert.equal(renderer.activeObjectUrls.get(rawImage), undefined);
  assert.deepEqual(urlApi.revoked, ["blob:segment-0"]);
});

test("raw slice transaction has terminal idempotent state transitions", () => {
  const urlApi = makeTrackedUrlApi();
  const { Renderer } = loadContentClasses({ urlApi });
  const renderer = new Renderer();
  const image = makeTallImage("transaction-state");
  const inserted = [];
  image.parentNode = {
    insertBefore(wrapper) {
      inserted.push(wrapper);
      wrapper.parentNode = this;
    },
    removeChild(wrapper) {
      const index = inserted.indexOf(wrapper);
      if (index >= 0) inserted.splice(index, 1);
      wrapper.parentNode = null;
    },
  };
  const transaction = renderer.prepareRawSlices(
    image,
    { width: 900 },
    [{ index: 0, sourceY: 0, sourceHeight: 1000, renderedHeight: 1000, objectUrl: "blob:state" }],
    { operationId: "parent-op", sourceRevision: "parent-rev" },
  );

  assert.equal(transaction.state, "prepared");
  transaction.commit();
  transaction.commit();
  assert.equal(transaction.state, "committed");
  assert.equal(inserted.length, 1);
  assert.equal(image.style.display, "none");
  transaction.rollback();
  transaction.rollback();
  transaction.commit();

  assert.equal(transaction.state, "rolledBack");
  assert.equal(inserted.length, 0);
  assert.equal(image.style.display || "", "");
  assert.equal(image.dataset.aiEnhancerSliced, undefined);
  assert.deepEqual(urlApi.revoked, ["blob:state"]);
});

test("prepared stale slice rollback cannot unhide a newer committed wrapper", () => {
  const urlApi = makeTrackedUrlApi();
  const { Renderer } = loadContentClasses({ urlApi });
  const renderer = new Renderer();
  const image = makeTallImage("transaction-owner");
  const inserted = [];
  image.parentNode = {
    insertBefore(wrapper) {
      inserted.push(wrapper);
      wrapper.parentNode = this;
    },
    removeChild(wrapper) {
      const index = inserted.indexOf(wrapper);
      if (index >= 0) inserted.splice(index, 1);
      wrapper.parentNode = null;
    },
  };
  const stale = renderer.prepareRawSlices(
    image,
    { width: 900 },
    [{ index: 0, sourceY: 0, sourceHeight: 1000, renderedHeight: 1000, objectUrl: "blob:stale-group" }],
    { operationId: "old-op", sourceRevision: "old-rev" },
  );
  const current = renderer.prepareRawSlices(
    image,
    { width: 900 },
    [{ index: 0, sourceY: 0, sourceHeight: 1000, renderedHeight: 1000, objectUrl: "blob:current-group" }],
    { operationId: "new-op", sourceRevision: "new-rev" },
  );
  current.commit();

  stale.rollback();

  assert.equal(current.state, "committed");
  assert.equal(inserted.length, 1);
  assert.equal(image.style.display, "none");
  assert.equal(image.dataset.aiEnhancerSliced, "true");
  assert.deepEqual(urlApi.revoked, ["blob:stale-group"]);
});

test("renderer rejects already-complete broken images", async () => {
  const { Renderer } = loadContentClasses();
  const renderer = new Renderer();

  await assert.rejects(
    renderer.waitForImageLoad({ complete: true, naturalWidth: 0 }),
    /Image failed to load/,
  );
});

test("renderer image load wait has a finite timeout", async () => {
  const { Renderer, HTMLImageElement } = loadContentClasses();
  const renderer = new Renderer();
  const image = new HTMLImageElement();
  image.complete = false;

  const outcome = await Promise.race([
    renderer.waitForImageLoad(image, null, 1).then(
      () => "loaded",
      (error) => error.message,
    ),
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 20)),
  ]);

  assert.match(outcome, /timed out/i);
});

test("partial segment encoding failure revokes every earlier object URL", async () => {
  const urlApi = makeTrackedUrlApi();
  const { ViewportImageProvider } = loadContentClasses({
    urlApi,
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
    }),
  });
  const viewportProvider = new ViewportImageProvider({ imageProvider: {}, renderer: {} });
  viewportProvider.imageSliceMaxHeight = 1000;
  viewportProvider.decodeBase64Image = async () => ({ width: 900, height: 2500 });
  let encoded = 0;
  viewportProvider.canvasToSegmentPayload = async () => {
    encoded += 1;
    if (encoded === 1) return { objectUrl: "blob:first-segment", imageData: "first" };
    throw viewportProvider.preprocessingError("slice-encode-error");
  };
  const image = makeTallImage("partial-crop");
  image.getBoundingClientRect = () => ({ width: 900, height: 2500, top: 0, bottom: 2500, left: 0, right: 900 });

  await assert.rejects(viewportProvider.cropImageSegments("source", image), /slice-encode-error/);

  assert.deepEqual(urlApi.revoked, ["blob:first-segment"]);
});

test("stale raw-load failure preserves a newer same-key operation", async () => {
  const rawLoad = deferred();
  const prepared = deferred();
  const renderer = {
    prepareRawSlices(_image, _metadata, segments) {
      prepared.resolve();
      return {
        state: "prepared",
        rawImages: segments.map((segment) => makeTallImage(`commit-race-raw-${segment.index}`)),
        commit() { this.state = "committed"; },
        rollback() { this.state = "rolledBack"; },
      };
    },
    waitForImageLoad: () => rawLoad.promise,
  };
  const { viewportProvider, trackedImageKeys } = makeContentProvider({
    renderer,
    cropImageSegments: () => [{
      index: 0,
      sourceY: 0,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: "blob:raw-failure",
      imageData: "segment-data",
    }],
  });
  viewportProvider.withTimeout = async (promise) => promise;
  const image = makeTallImage("raw-race");
  const scheduled = viewportProvider.schedule(image);
  await prepared.promise;
  const [baseKey] = trackedImageKeys.keys();
  const replacement = { imageId: "replacement", operationId: "replacement-op", sourceRevision: baseKey, image };
  trackedImageKeys.set(baseKey, replacement);
  rawLoad.reject(new Error("raw load failed"));
  await scheduled;

  assert.equal(trackedImageKeys.get(baseKey), replacement);
});

test("stale immediately after slice commit rolls back before segment enqueue", async () => {
  let trackedImageKeysRef;
  let rollbackCount = 0;
  const renderer = {
    prepareRawSlices(image, _metadata, segments) {
      return {
        state: "prepared",
        rawImages: segments.map((segment) => makeTallImage(`commit-race-raw-${segment.index}`)),
        commit() {
          this.state = "committed";
          image.style.display = "none";
          image.dataset.aiEnhancerSliced = "true";
          const [baseKey] = trackedImageKeysRef.keys();
          trackedImageKeysRef.set(baseKey, { imageId: "replacement", operationId: "replacement-op", sourceRevision: baseKey, image });
        },
        rollback() {
          rollbackCount += 1;
          this.state = "rolledBack";
          image.style.display = "";
          delete image.dataset.aiEnhancerSliced;
        },
      };
    },
    waitForImageLoad: async () => undefined,
  };
  const setup = makeContentProvider({
    renderer,
    cropImageSegments: () => [{
      index: 0,
      sourceY: 0,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: "blob:commit-race",
      imageData: "segment-data",
    }],
  });
  trackedImageKeysRef = setup.trackedImageKeys;
  setup.viewportProvider.withTimeout = async (promise) => promise;
  const image = makeTallImage("commit-race");

  await setup.viewportProvider.schedule(image);

  assert.equal(rollbackCount, 1);
  assert.equal(image.style.display || "", "");
  assert.equal(image.dataset.aiEnhancerSliced, undefined);
  assert.equal(setup.sentMessages.filter((message) => String(message.cacheVariant).startsWith("segment-")).length, 0);
});

test("stale operation after raw slice prepare rolls back without committing DOM", async () => {
  const urlApi = makeTrackedUrlApi();
  const rawLoaded = deferred();
  const prepared = deferred();
  const calls = { commit: 0, rollback: 0 };
  const image = makeTallImage("stale-prepare");
  image.parentNode = {
    insertBefore() {
      calls.commit += 1;
      image.style.display = "none";
      image.dataset.aiEnhancerSliced = "true";
    },
  };
  const renderer = {
    prepareRawSlices(_image, _metadata, segments) {
      prepared.resolve();
      return {
        rawImages: segments.map((segment) => ({ segment })),
        commit() {
          image.parentNode.insertBefore({}, image);
        },
        rollback() {
          calls.rollback += 1;
          image.style.display = "";
          delete image.dataset.aiEnhancerSliced;
          segments.forEach((segment) => urlApi.revokeObjectURL(segment.objectUrl));
        },
      };
    },
    installRawSlices(imageArg, metadata, segments) {
      const transaction = this.prepareRawSlices(imageArg, metadata, segments);
      transaction.commit();
      return transaction.rawImages;
    },
    waitForImageLoad: () => rawLoaded.promise,
  };
  const { viewportProvider } = makeContentProvider({
    urlApi,
    renderer,
    cropImageSegments: () => [{
      index: 0,
      sourceY: 0,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: "blob:segment-0",
      imageData: "segment-data",
    }],
  });
  viewportProvider.withTimeout = async (promise) => promise;
  const scheduled = viewportProvider.schedule(image);
  await prepared.promise;

  image.src = "https://example.com/stale-prepare.png?rev=2";
  image.currentSrc = image.src;
  image.dataset.aiEnhancerSeen = "false";
  await viewportProvider.schedule(image, false);
  rawLoaded.resolve();
  await scheduled;

  assert.equal(calls.commit, 0);
  assert.equal(calls.rollback, 1);
  assert.equal(image.style.display || "", "");
  assert.equal(image.dataset.aiEnhancerSliced, undefined);
  assert.deepEqual(urlApi.revoked, ["blob:segment-0"]);
});

test("cancellation during preprocessing settles without enqueueing", async () => {
  const read = deferred();
  let readStarted = false;
  const { viewportProvider, sentMessages, trackedImages } = makeContentProvider({
    readDisplayedImage: () => {
      readStarted = true;
      return read.promise;
    },
  });
  const slotStats = instrumentPreprocessingSlots(viewportProvider);
  const image = makeTallImage(0);
  image.naturalHeight = 900;
  image.clientHeight = 900;
  image.height = 900;
  image.getBoundingClientRect = () => ({ width: 900, height: 900, top: 0, bottom: 900, left: 0, right: 900 });
  const scheduled = viewportProvider.schedule(image);
  while (!readStarted) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  viewportProvider.cancel(trackedImages.get(image.dataset.aiEnhancerImageId));
  read.resolve("image-data");
  await scheduled;

  assert.equal(sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE").length, 0);
  assert.equal(sentMessages.filter((message) => message.type === "CANCEL_IMAGE").length, 1);
  assert.equal(slotStats.acquired, slotStats.released);
});

test("successful segments and fallback images each enqueue once", async () => {
  const { viewportProvider, sentMessages } = makeContentProvider({
    readDisplayedImage: async (imageUrl) => (imageUrl.endsWith("0.png") ? "segment-source" : null),
    cropImageSegments: () => [{
      index: 0,
      sourceY: 0,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: "blob:segment",
      imageData: "segment-data",
    }],
    renderer: {
      installRawSlices: (_image, _metadata, segments) => segments.map((segment) => makeTallImage(`raw-${segment.index}`)),
      waitForImageLoad: async () => undefined,
    },
  });
  const slotStats = instrumentPreprocessingSlots(viewportProvider);
  viewportProvider.withTimeout = async (promise) => promise;
  const images = [0, 1, 2].map(makeTallImage);

  const result = await waitForSettled(images.map((image) => viewportProvider.schedule(image)));
  const enqueued = sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE");

  assert.equal(result, "settled");
  assert.equal(enqueued.length, 3, JSON.stringify(sentMessages));
  assert.equal(enqueued.filter((message) => message.cacheVariant === "full").length, 2, JSON.stringify(sentMessages));
  assert.equal(enqueued.filter((message) => String(message.cacheVariant).startsWith("segment-")).length, 1, JSON.stringify(sentMessages));
  assert.equal(slotStats.acquired, slotStats.released);
  assert.ok(slotStats.maxActive <= viewportProvider.preprocessingConcurrency);
  assert.ok(slotStats.minActive >= 0);
});

test("one segment failure rolls back the entire committed slice group", async () => {
  let rollbackCount = 0;
  const parent = makeTallImage("group-failure");
  const renderer = {
    prepareRawSlices(image, _metadata, segments) {
      const rawImages = segments.map((segment) => {
        const raw = makeTallImage(`group-raw-${segment.index}`);
        raw.segmentIndex = segment.index;
        return raw;
      });
      return {
        state: "prepared",
        rawImages,
        commit() {
          if (this.state !== "prepared") return;
          this.state = "committed";
          image.style.display = "none";
          image.dataset.aiEnhancerSliced = "true";
        },
        rollback() {
          if (this.state === "rolledBack") return;
          this.state = "rolledBack";
          rollbackCount += 1;
          image.style.display = "";
          delete image.dataset.aiEnhancerSliced;
        },
      };
    },
    waitForImageLoad: async () => undefined,
    render: async () => "rendered",
  };
  const { viewportProvider, sentMessages, trackedImages } = makeContentProvider({
    renderer,
    cropImageSegments: () => [0, 1].map((index) => ({
      index,
      sourceY: index * 1000,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: `blob:group-${index}`,
      imageData: `segment-${index}`,
    })),
  });
  viewportProvider.withTimeout = async (promise) => promise;
  await viewportProvider.schedule(parent);
  const segmentMessages = sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE" && String(message.cacheVariant).startsWith("segment-"));

  viewportProvider.fail(
    segmentMessages[0].imageId,
    false,
    segmentMessages[0].operationId,
    segmentMessages[0].sourceRevision,
  );

  assert.equal(rollbackCount, 1);
  assert.equal(parent.style.display || "", "");
  assert.equal(parent.dataset.aiEnhancerSliced, undefined);
  assert.equal(segmentMessages.some((message) => trackedImages.has(message.imageId)), false);
  assert.ok(sentMessages.some((message) => message.type === "CANCEL_IMAGE" && message.operationId === segmentMessages[1].operationId));
});

test("segment completion rejects a raw node that lost exact slice ownership", async () => {
  let renderCount = 0;
  const renderer = makeTransactionalSliceRenderer({
    token: "exact-owner-token",
    onRender: async () => {
      renderCount += 1;
      return "rendered";
    },
  });
  const { viewportProvider, sentMessages, trackedImages } = makeContentProvider({
    renderer,
    cropImageSegments: () => [{
      index: 0,
      sourceY: 0,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: "blob:ownership-segment",
      imageData: "ownership-segment-data",
    }],
  });
  viewportProvider.withTimeout = async (promise) => promise;
  await viewportProvider.schedule(makeTallImage("ownership-parent"));
  const completion = sentMessages.find((message) => message.type === "ENQUEUE_IMAGE" && String(message.cacheVariant).startsWith("segment-"));
  const entry = trackedImages.get(completion.imageId);
  delete entry.image.dataset.aiEnhancerSliceToken;

  const outcome = await viewportProvider.complete({ ...completion, type: "UPSCALE_COMPLETE", imageBase64: "enhanced" });

  assert.equal(outcome, "stale");
  assert.equal(renderCount, 0);
  assert.equal(trackedImages.get(entry.imageId), entry);
});

test("segment registration transport failure rolls back the committed group atomically", async () => {
  let rollbackCount = 0;
  const renderer = makeTransactionalSliceRenderer({ onRollback: () => { rollbackCount += 1; } });
  const { viewportProvider, trackedImages, sentMessages } = makeContentProvider({
    renderer,
    sendMessage: (message) => {
      if (message.type === "ENQUEUE_IMAGE" && message.cacheVariant === "segment-1-1000-1000") {
        throw new Error("segment transport failed");
      }
      return Promise.resolve();
    },
    cropImageSegments: () => [0, 1].map((index) => ({
      index,
      sourceY: index * 1000,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: `blob:transport-${index}`,
      imageData: `transport-data-${index}`,
    })),
  });
  viewportProvider.withTimeout = async (promise) => promise;
  const parent = makeTallImage("transport-parent");

  await assert.doesNotReject(viewportProvider.schedule(parent));
  const groupParentIdentity = sentMessages.find((message) => (
    message.type === "PREPROCESSING_STARTED" && !message.imageId.includes("-seg-")
  ));

  assert.equal(rollbackCount, 1);
  assert.equal(parent.style.display || "", "");
  assert.equal(parent.dataset.aiEnhancerSliced, undefined);
  assert.equal(viewportProvider.sliceGroups.size, 0);
  assert.equal([...trackedImages.values()].some((entry) => entry.isSegment), false);
  assert.ok(sentMessages.some((message) => (
    message.type === "REMOVE_IMAGE" &&
    message.imageId === groupParentIdentity.imageId &&
    message.operationId === groupParentIdentity.operationId
  )));
});

test("slice rollback finishes cleanup when cancellation transport throws", async () => {
  let rejectCancellation = false;
  let rollbackCount = 0;
  const renderer = makeTransactionalSliceRenderer({ onRollback: () => { rollbackCount += 1; } });
  const { viewportProvider, sentMessages, trackedImages } = makeContentProvider({
    renderer,
    sendMessage: (message) => {
      if (rejectCancellation && message.type === "CANCEL_IMAGE") throw new Error("cancel transport failed");
      return Promise.resolve();
    },
    cropImageSegments: () => [0, 1].map((index) => ({
      index,
      sourceY: index * 1000,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: `blob:cancel-throw-${index}`,
      imageData: `cancel-throw-data-${index}`,
    })),
  });
  viewportProvider.withTimeout = async (promise) => promise;
  const parent = makeTallImage("cancel-throw-parent");
  await viewportProvider.schedule(parent);
  const segment = sentMessages.find((message) => message.type === "ENQUEUE_IMAGE" && String(message.cacheVariant).startsWith("segment-"));
  rejectCancellation = true;

  assert.doesNotThrow(() => viewportProvider.fail(segment.imageId, false, segment.operationId, segment.sourceRevision));

  assert.equal(rollbackCount, 1);
  assert.equal(parent.style.display || "", "");
  assert.equal(viewportProvider.sliceGroups.size, 0);
  assert.equal([...trackedImages.values()].some((entry) => entry.isSegment), false);
});

test("removing only the hidden sliced parent preserves committed segment jobs", async () => {
  const renderer = makeTransactionalSliceRenderer();
  const { viewportProvider, HTMLImageElement, trackedImages } = makeContentProvider({
    renderer,
    sendMessage: () => Promise.resolve(),
    cropImageSegments: () => [0, 1].map((index) => ({
      index,
      sourceY: index * 1000,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: `blob:detached-parent-${index}`,
      imageData: `detached-parent-data-${index}`,
    })),
  });
  viewportProvider.withTimeout = async (promise) => promise;
  const parent = makeTallImage("detached-parent");
  Object.setPrototypeOf(parent, HTMLImageElement.prototype);
  await viewportProvider.schedule(parent);
  const group = [...viewportProvider.sliceGroups.values()][0];

  viewportProvider.cleanupRemovedNode(parent);

  assert.equal(viewportProvider.sliceGroups.get(group.token), group);
  assert.equal(group.state, "committed");
  assert.equal(group.records.length, 2);
  assert.ok(group.records.every((record) => trackedImages.get(record.entry.imageId) === record.entry));
});

test("parent source reprocess rolls back old segments before scheduling replacement", async () => {
  let rollbackCount = 0;
  const parent = makeTallImage("parent-reprocess");
  parent.src = "https://example.com/parent.png?rev=1";
  parent.currentSrc = parent.src;
  const renderer = {
    prepareRawSlices(image, _metadata, segments) {
      return {
        state: "prepared",
        rawImages: segments.map((segment) => makeTallImage(`reprocess-raw-${segment.index}`)),
        commit() {
          if (this.state !== "prepared") return;
          this.state = "committed";
          image.style.display = "none";
          image.dataset.aiEnhancerSliced = "true";
        },
        rollback() {
          if (this.state === "rolledBack") return;
          this.state = "rolledBack";
          rollbackCount += 1;
          image.style.display = "";
          delete image.dataset.aiEnhancerSliced;
        },
      };
    },
    waitForImageLoad: async () => undefined,
    render: async () => "rendered",
  };
  const { viewportProvider, sentMessages } = makeContentProvider({
    renderer,
    readDisplayedImage: async () => "parent-bytes",
    cropImageSegments: () => [0, 1].map((index) => ({
      index,
      sourceY: index * 1000,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: `blob:reprocess-${index}`,
      imageData: `segment-${index}`,
    })),
  });
  viewportProvider.withTimeout = async (promise) => promise;
  await viewportProvider.schedule(parent);

  parent.src = "https://example.com/parent.png?rev=2";
  parent.currentSrc = parent.src;
  parent.naturalHeight = 900;
  parent.clientHeight = 900;
  parent.height = 900;
  parent.getBoundingClientRect = () => ({ width: 900, height: 900, top: 0, bottom: 900, left: 0, right: 900 });
  await viewportProvider.schedule(parent, false);

  const fullMessages = sentMessages.filter((message) => message.type === "ENQUEUE_IMAGE" && message.cacheVariant === "full");
  assert.equal(rollbackCount, 1);
  assert.equal(parent.style.display || "", "");
  assert.equal(parent.dataset.aiEnhancerSliced, undefined);
  assert.equal(fullMessages.length, 1);
  assert.ok(fullMessages[0].imageUrl.includes("rev=2"));
});

test("ten reversed segment completions render only their recorded raw positions", async () => {
  const rendered = [];
  const renderer = {
    prepareRawSlices(_image, _metadata, segments) {
      return {
        state: "prepared",
        rawImages: segments.map((segment) => ({
          segmentIndex: segment.index,
          dataset: {},
          style: {},
          naturalWidth: 900,
          naturalHeight: 1000,
          clientWidth: 900,
          clientHeight: 1000,
          getBoundingClientRect: () => ({ width: 900, height: 1000, top: 0, bottom: 1000, left: 0, right: 900 }),
        })),
        commit() { this.state = "committed"; },
        rollback() { this.state = "rolledBack"; },
      };
    },
    waitForImageLoad: async () => undefined,
    render: async (raw, payload) => {
      rendered.push({ segmentIndex: raw.segmentIndex, imageId: payload.imageId });
      return "rendered";
    },
  };
  const { viewportProvider, sentMessages } = makeContentProvider({
    renderer,
    cropImageSegments: () => Array.from({ length: 10 }, (_, index) => ({
      index,
      sourceY: index * 1000,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: `blob:reverse-${index}`,
      imageData: `segment-${index}`,
    })),
  });
  viewportProvider.withTimeout = async (promise) => promise;
  await viewportProvider.schedule(makeTallImage("reverse"));
  const completions = sentMessages
    .filter((message) => message.type === "ENQUEUE_IMAGE" && String(message.cacheVariant).startsWith("segment-"))
    .reverse();

  for (const message of completions) {
    await viewportProvider.complete({ ...message, type: "UPSCALE_COMPLETE", imageBase64: "enhanced" });
  }

  assert.equal(rendered.length, 10);
  for (const result of rendered) {
    assert.ok(result.imageId.endsWith(`-seg-${result.segmentIndex}`));
  }
  assert.notEqual(rendered.find((entry) => entry.segmentIndex === 1).imageId, rendered.find((entry) => entry.segmentIndex === 2).imageId);
});

test("segment priority update carries the exact segment operation id", async () => {
  const renderer = {
    prepareRawSlices(_image, _metadata, segments) {
      return {
        state: "prepared",
        rawImages: segments.map((segment) => makeTallImage(`priority-raw-${segment.index}`)),
        commit() { this.state = "committed"; },
        rollback() { this.state = "rolledBack"; },
      };
    },
    waitForImageLoad: async () => undefined,
  };
  const { viewportProvider, sentMessages, trackedImages } = makeContentProvider({
    renderer,
    cropImageSegments: () => [{
      index: 0,
      sourceY: 0,
      sourceHeight: 1000,
      renderedHeight: 1000,
      objectUrl: "blob:priority-segment",
      imageData: "segment-priority",
    }],
  });
  viewportProvider.withTimeout = async (promise) => promise;
  await viewportProvider.schedule(makeTallImage("priority-parent"));
  const segmentEntry = [...trackedImages.values()].find((entry) => entry.isSegment);

  viewportProvider.updateImagePriority(segmentEntry.image, segmentEntry.imageId);

  const update = sentMessages.filter((message) => message.type === "UPDATE_PRIORITY").at(-1);
  assert.equal(update.imageId, segmentEntry.imageId);
  assert.equal(update.operationId, segmentEntry.operationId);
});

test("auto output limits use configured caps for raw image segments", () => {
  const resolveOutputLimits = loadBackgroundHelpers();
  const limits = resolveOutputLimits(
    {
      sizingMode: "auto",
      maxOutputWidthEnabled: true,
      maxOutputHeightEnabled: true,
      maxOutputWidth: 2048,
      maxOutputHeight: 8192,
    },
    {
      cacheVariant: "segment-0-0-2200",
      renderedWidth: 900,
      renderedHeight: 900,
      viewportWidth: 1920,
      viewportHeight: 900,
      screenWidth: 1920,
      screenHeight: 1080,
      devicePixelRatio: 1,
    },
  );

  assert.equal(limits.width, 2048);
  assert.equal(limits.height, 8192);
});

test("stale completion cannot remove a replacement job with the same image id", async () => {
  const QueueScheduler = loadQueueScheduler();
  const runs = [];
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 1,
    cacheProvider: { get: async () => null, set: async () => undefined },
    upscaleProvider: {
      upscale: () => {
        const run = deferred();
        runs.push(run);
        return run.promise;
      },
      cancel() {},
    },
    statisticsTracker: { recordSuccess: async () => undefined, recordError: async () => undefined },
  });

  scheduler.enqueue(makeJob());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.length, 1);
  scheduler.cancel(7, "image-1", "image-1-op-1");
  scheduler.enqueue({ ...makeJob(), operationId: "image-1-op-2", sourceRevision: "image-1-rev-2" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.length, 2);
  const replacement = [...scheduler.active.values()].find((job) => job.imageId === "image-1");

  runs[0].resolve({});
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal([...scheduler.active.values()].find((job) => job.imageId === "image-1"), replacement);
  scheduler.cancelAll();
  runs[1].resolve({});
});

test("backend job id and active cancel use operation queue identity", async () => {
  const QueueScheduler = loadQueueScheduler();
  const run = deferred();
  const jobIds = [];
  const canceled = [];
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 1,
    cacheProvider: { get: async () => null, set: async () => undefined },
    upscaleProvider: {
      upscale: (_url, options) => {
        jobIds.push(options.jobId);
        return run.promise;
      },
      cancel: (jobId) => canceled.push(jobId),
    },
    statisticsTracker: { recordSuccess: async () => undefined, recordError: async () => undefined },
  });

  scheduler.enqueue(makeJob("image-identity"));
  await new Promise((resolve) => setImmediate(resolve));
  scheduler.cancel(7, "image-identity", "image-identity-op-1");

  assert.deepEqual(jobIds, ["7:image-identity:image-identity-op-1"]);
  assert.deepEqual(canceled, ["7:image-identity:image-identity-op-1"]);
  run.resolve({});
});

test("page image registry ignores stale operation updates", async () => {
  const { PageImageRegistry } = loadBackgroundClasses();
  const registry = new PageImageRegistry();
  await registry.seen(7, {
    imageId: "image-1",
    operationId: "op-old",
    imageUrl: "https://example.com/old.png",
    pageUrl: "https://example.com/page",
    pageOrder: 1,
  });
  await registry.seen(7, {
    imageId: "image-1",
    operationId: "op-new",
    imageUrl: "https://example.com/new.png",
    pageUrl: "https://example.com/page",
    pageOrder: 1,
  });

  registry.update(7, "image-1", { operationId: "op-old", status: "fixed" });

  const [entry] = registry.list(7);
  assert.equal(entry.operationId, "op-new");
  assert.equal(entry.status, "seen");
});

test("page image registry seen stores current operation identity", async () => {
  const { PageImageRegistry } = loadBackgroundClasses();
  const registry = new PageImageRegistry();

  await registry.seen(7, {
    imageId: "image-1",
    operationId: "op-current",
    sourceRevision: "rev-current",
    imageUrl: "https://example.com/current.png",
    pageUrl: "https://example.com/page",
    pageOrder: 1,
  });

  const [entry] = registry.list(7);
  assert.equal(entry.operationId, "op-current");
  assert.equal(entry.sourceRevision, "rev-current");
});

test("page image registry seen does not install persistent Referer rules", async () => {
  const ruleUpdates = [];
  const { PageImageRegistry } = loadBackgroundClasses({
    updateSessionRules: async (update) => ruleUpdates.push(update),
  });
  const registry = new PageImageRegistry();

  await registry.seen(7, {
    imageId: "protected-image",
    operationId: "protected-op",
    imageUrl: "https://cdn.example.test/chapter/page.png",
    pageUrl: "https://reader.example.test/chapter/1",
    pageOrder: 1,
  });

  assert.equal(ruleUpdates.length, 0, "discovery leaked a broad session Referer rule");
});

test("same image URL reads serialize temporary Referer rules", async () => {
  const firstBody = deferred();
  const ruleUpdates = [];
  let fetchCount = 0;
  const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const { BackendUpscaleProvider } = loadBackgroundClasses({
    updateSessionRules: async (update) => ruleUpdates.push(update),
    fetch: async () => {
      fetchCount += 1;
      return {
        ok: true,
        arrayBuffer: async () => fetchCount === 1 ? firstBody.promise : pngBytes.buffer,
      };
    },
  });
  const provider = new BackendUpscaleProvider("http://127.0.0.1:8765", 20000);
  const imageUrl = "https://cdn.example.test/protected/page.png";

  const chapterA = provider.readBrowserImage(imageUrl, "https://reader.example.test/chapter/a");
  await new Promise((resolve) => setImmediate(resolve));
  const chapterB = provider.readBrowserImage(imageUrl, "https://reader.example.test/chapter/b");
  await new Promise((resolve) => setImmediate(resolve));

  const overlappingFetchCount = fetchCount;
  const overlappingAddCount = ruleUpdates.filter((update) => update.addRules?.length).length;
  firstBody.resolve(pngBytes.buffer);
  await Promise.all([chapterA, chapterB]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(overlappingFetchCount, 1, "a second fetch started while the first exact-URL Referer rule was active");
  assert.equal(overlappingAddCount, 1);
  assert.equal(fetchCount, 2);
  assert.equal(provider.imageReadLocks.size, 0, "the exact-URL read lock did not settle");
  assert.deepEqual(ruleUpdates.map((update) => update.addRules?.[0]?.action.requestHeaders[0].value || "removed"), [
    "https://reader.example.test/chapter/a",
    "removed",
    "https://reader.example.test/chapter/b",
    "removed",
  ]);
});

test("temporary Referer rules are removed on every browser-read terminal path", async () => {
  const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const cases = [
    { name: "success", response: { ok: true, arrayBuffer: async () => pngBytes.buffer } },
    { name: "non-image", response: { ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer } },
    { name: "disconnect", response: { ok: true, arrayBuffer: async () => { throw new Error("socket disconnected"); } } },
  ];

  for (const scenario of cases) {
    const ruleUpdates = [];
    const { BackendUpscaleProvider } = loadBackgroundClasses({
      updateSessionRules: async (update) => ruleUpdates.push(update),
      fetch: async () => scenario.response,
    });
    const provider = new BackendUpscaleProvider("http://127.0.0.1:8765", 20000);
    const read = provider.readBrowserImage(
      `https://cdn.example.test/${scenario.name}.png`,
      "https://reader.example.test/chapter/a",
    );
    if (scenario.name === "success") await read;
    else await assert.rejects(read);

    const addedRuleId = ruleUpdates.find((update) => update.addRules?.length)?.addRules[0].id;
    assert.ok(Number.isInteger(addedRuleId), `${scenario.name} did not install its temporary rule`);
    assert.ok(
      ruleUpdates.some((update) => update.removeRuleIds?.includes(addedRuleId) && !update.addRules),
      `${scenario.name} leaked temporary rule ${addedRuleId}`,
    );
  }

  const ruleUpdates = [];
  const bodyStarted = deferred();
  const { BackendUpscaleProvider } = loadBackgroundClasses({
    updateSessionRules: async (update) => ruleUpdates.push(update),
    fetch: async () => ({
      ok: true,
      arrayBuffer: async () => {
        bodyStarted.resolve();
        return new Promise(() => {});
      },
    }),
  });
  const provider = new BackendUpscaleProvider("http://127.0.0.1:8765", 20000);
  const controller = new AbortController();
  const abortedRead = provider.readBrowserImage(
    "https://cdn.example.test/aborted.png",
    "https://reader.example.test/chapter/a",
    controller.signal,
  );
  await bodyStarted.promise;
  controller.abort();
  await assert.rejects(abortedRead, { name: "AbortError" });

  const addedRuleId = ruleUpdates.find((update) => update.addRules?.length)?.addRules[0].id;
  assert.ok(Number.isInteger(addedRuleId));
  assert.ok(ruleUpdates.some((update) => update.removeRuleIds?.includes(addedRuleId) && !update.addRules));
});

test("service worker initialization removes interrupted Referer session rules", async () => {
  const ruleUpdates = [];
  const refererAction = {
    type: "modifyHeaders",
    requestHeaders: [{ header: "Referer", operation: "set", value: "https://reader.example.test/chapter/a" }],
  };
  const { BackendUpscaleProvider } = loadBackgroundClasses({
    getSessionRules: async () => [
      { id: 1000, action: refererAction },
      { id: 100000, action: refererAction },
      { id: 999, action: refererAction },
      { id: 1001, action: { type: "block" } },
    ],
    updateSessionRules: async (update) => ruleUpdates.push(update),
  });

  const provider = new BackendUpscaleProvider("http://127.0.0.1:8765", 20000);
  await provider.headerRuleCleanup;

  assert.equal(ruleUpdates.length, 1);
  assert.deepEqual([...ruleUpdates[0].removeRuleIds], [1000, 100000]);
});

test("page image registry stale remove does not delete current operation", async () => {
  const { PageImageRegistry } = loadBackgroundClasses();
  const registry = new PageImageRegistry();
  await registry.seen(7, {
    imageId: "image-1",
    operationId: "op-new",
    sourceRevision: "rev-new",
    imageUrl: "https://example.com/current.png",
    pageUrl: "https://example.com/page",
    pageOrder: 1,
  });

  registry.removeImage(7, "image-1", "op-old");

  const [entry] = registry.list(7);
  assert.equal(entry.operationId, "op-new");
  assert.equal(entry.sourceRevision, "rev-new");
});

test("page image registry rejects operationless update and remove for owned entry", async () => {
  const { PageImageRegistry } = loadBackgroundClasses();
  const registry = new PageImageRegistry();
  await registry.seen(7, {
    imageId: "owned-image",
    operationId: "owned-op",
    sourceRevision: "owned-rev",
    imageUrl: "https://example.com/current.png",
    pageUrl: "https://example.com/page",
    pageOrder: 1,
  });

  registry.update(7, "owned-image", { status: "fixed" });
  registry.removeImage(7, "owned-image");

  const [entry] = registry.list(7);
  assert.ok(entry, "operationless remove deleted the owned entry");
  assert.equal(entry.operationId, "owned-op");
  assert.equal(entry.status, "seen");
});

test("GET_PAGE_IMAGES returns only the requested content tab", async () => {
  const responses = [];
  const { dispatch, pageImageRegistry } = loadBackgroundMessageHarness();
  await pageImageRegistry.seen(7, {
    imageId: "tab-7-image",
    operationId: "tab-7-op",
    imageUrl: "https://example.com/tab-7.png",
    pageUrl: "https://example.com/reader-7",
    pageOrder: 1,
  });
  await pageImageRegistry.seen(8, {
    imageId: "tab-8-image",
    operationId: "tab-8-op",
    imageUrl: "https://example.com/tab-8.png",
    pageUrl: "https://example.com/reader-8",
    pageOrder: 1,
  });

  dispatch({ type: "GET_PAGE_IMAGES", tabId: 7 }, {}, (response) => responses.push(response));

  assert.equal(responses.at(-1).tabId, 7);
  assert.deepEqual(responses.at(-1).images.map((entry) => entry.imageId), ["tab-7-image"]);
});

test("canceling a tab rejects jobs from an older generation", () => {
  const QueueScheduler = loadQueueScheduler();
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 0,
    cacheProvider: {},
    upscaleProvider: { cancel() {} },
    statisticsTracker: {},
  });
  scheduler.paused = true;
  scheduler.setPaused(false);
  scheduler.maxConcurrentRequests = 0;
  scheduler.enqueue(makeJob("old"));
  const oldGeneration = [...scheduler.pending.values()].find((job) => job.imageId === "old").generation;
  scheduler.cancelTab(7);
  scheduler.enqueue({ ...makeJob("stale"), generation: oldGeneration });
  assert.equal([...scheduler.pending.values()].some((job) => job.imageId === "stale"), false);
});

test("delayed enqueue storage read cannot resurrect a pre-navigation job", async () => {
  const storageRead = deferred();
  const responses = [];
  const { dispatch, scheduler } = loadBackgroundMessageHarness({
    storageGet: () => storageRead.promise,
  });
  scheduler.maxConcurrentRequests = 0;
  const message = {
    type: "ENQUEUE_IMAGE",
    imageId: "delayed-image",
    operationId: "delayed-op",
    sourceRevision: "delayed-rev",
    imageUrl: "https://example.com/delayed.png",
    pageOrder: 1,
    viewportDistance: 0,
    displayMetrics: {},
  };

  assert.equal(dispatch(message, { tab: { id: 7, url: "https://example.com/page" } }, (response) => responses.push(response)), true);
  scheduler.cancelTab(7);
  storageRead.resolve({ enabled: true, outputQuality: 90 });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal([...scheduler.pending.values()].some((job) => job.imageId === message.imageId), false);
  assert.equal([...scheduler.active.values()].some((job) => job.imageId === message.imageId), false);
  assert.equal(responses.at(-1)?.accepted, false);
});

test("delayed image-seen storage read cannot resurrect a pre-navigation registry entry", async () => {
  const storageRead = deferred();
  const responses = [];
  const { dispatch, scheduler, pageImageRegistry } = loadBackgroundMessageHarness({
    storageGet: () => storageRead.promise,
  });
  const message = {
    type: "IMAGE_SEEN",
    imageId: "delayed-seen-image",
    operationId: "delayed-seen-op",
    sourceRevision: "delayed-seen-rev",
    imageUrl: "https://example.com/delayed-seen.png",
    width: 900,
    height: 1200,
    pageOrder: 1,
  };

  assert.equal(dispatch(message, { tab: { id: 7, url: "https://example.com/page" } }, (response) => responses.push(response)), true);
  scheduler.cancelTab(7);
  storageRead.resolve({ enabled: true });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(pageImageRegistry.list(7), []);
  assert.equal(responses.at(-1)?.recorded, false);
});

test("scheduler emits one cancellation trace for repeated active cancellation", async () => {
  const traceEvents = [];
  const QueueScheduler = loadQueueScheduler({ traceEvents });
  const run = deferred();
  const canceled = [];
  const scheduler = new QueueScheduler({
    maxConcurrentRequests: 1,
    cacheProvider: { get: async () => null, set: async () => undefined },
    upscaleProvider: {
      upscale: () => run.promise,
      cancel: (jobId) => canceled.push(jobId),
    },
    statisticsTracker: { recordSuccess: async () => undefined, recordError: async () => undefined },
  });

  scheduler.enqueue(makeJob("cancel-once"));
  await new Promise((resolve) => setImmediate(resolve));
  scheduler.cancel(7, "cancel-once", "cancel-once-op-1");
  scheduler.cancel(7, "cancel-once", "cancel-once-op-1");
  run.resolve({});
  await new Promise((resolve) => setImmediate(resolve));

  const cancellationEvents = traceEvents.filter((event) => event.event === "background.job.cancelled");
  assert.equal(cancellationEvents.length, 1);
  assert.deepEqual(canceled, ["7:cancel-once:cancel-once-op-1"]);
  assert.equal(traceEvents.some((event) => event.event === "background.job.completed" && event.traceId === cancellationEvents[0].traceId), false);
});
