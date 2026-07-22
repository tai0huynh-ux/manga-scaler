const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.parentNode = null;
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.attributes = new Map();
  }

  get firstElementChild() { return this.children[0] || null; }

  append(...children) { children.forEach((child) => this.appendChild(child)); }

  appendChild(child) {
    child.parentNode?.removeChild?.(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
  }

  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    this.append(...children);
  }

  remove() { this.parentNode?.removeChild?.(this); }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }

  getAttribute(name) { return this.attributes.get(name) ?? null; }

  dispatch(type) { (this.listeners.get(type) || []).forEach((callback) => callback({ type, target: this })); }

  querySelector(selector) {
    const matches = (element) => selector.startsWith(".")
      ? String(element.className).split(/\s+/).includes(selector.slice(1))
      : element.tagName === selector.toUpperCase();
    for (const child of this.children) {
      if (matches(child)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}

function loadDashboard(options = {}) {
  const root = path.resolve(__dirname, "..", "..");
  const source = fs.readFileSync(path.join(root, "extension", "src", "dashboard.js"), "utf8");
  const prefix = source.slice(0, source.indexOf('document.getElementById("mode").addEventListener'));
  const elements = {
    imageList: new FakeElement("div"),
    imageCount: new FakeElement("span"),
    mode: new FakeElement("select"),
    level: new FakeElement("input"),
    levelValue: new FakeElement("output"),
    monitorLayout: new FakeElement("div"),
    monitorListPanel: new FakeElement("div"),
    monitorDetail: new FakeElement("aside"),
    toggleMonitorList: new FakeElement("button"),
    toggleMonitorDetail: new FakeElement("button"),
  };
  Object.entries(elements).forEach(([id, element]) => { element.id = id; });
  const document = {
    activeElement: null,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => elements[id] || new FakeElement("div"),
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    Map,
    Set,
    document,
    window: { location: { search: "?tabId=7" } },
    chrome: {
      runtime: { sendMessage: options.sendMessage || (async () => ({})) },
      storage: {
        local: {
          get: options.storageGet || (async () => ({ blacklistRules: [], blockedResultRules: [] })),
          set: options.storageSet || (async () => undefined),
        },
      },
    },
  });
  vm.runInContext(`${prefix}\nglobalThis.__renderImages = renderImages; globalThis.__imageRows = imageRows; globalThis.__initializeMonitorListToggle = initializeMonitorListToggle; globalThis.__initializeMonitorDetailToggle = initializeMonitorDetailToggle; globalThis.__refreshEnhancementControls = refreshEnhancementControls;`, context);
  return {
    renderImages: context.__renderImages,
    imageRows: context.__imageRows,
    initializeMonitorListToggle: context.__initializeMonitorListToggle,
    initializeMonitorDetailToggle: context.__initializeMonitorDetailToggle,
    refreshEnhancementControls: context.__refreshEnhancementControls,
    elements,
    document,
  };
}

function imageRecord(overrides = {}) {
  return {
    tabId: 7,
    imageId: "image-1",
    operationId: "operation-1",
    imageUrl: "https://protected.example/page-1.jpg",
    status: "preprocessing_queued",
    ...overrides,
  };
}

test("monitor job list is collapsed by default and expands on demand", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "dashboard.html"), "utf8");
  assert.match(html, /id="toggleMonitorList"[^>]*aria-expanded="false"/);
  assert.match(html, /id="monitorListPanel"[^>]*hidden/);

  const { initializeMonitorListToggle, elements } = loadDashboard();
  elements.monitorListPanel.hidden = true;
  initializeMonitorListToggle();
  assert.equal(elements.monitorListPanel.hidden, true);
  assert.equal(elements.monitorListPanel.dataset.collapsed, "true");
  assert.equal(elements.toggleMonitorList.getAttribute("aria-expanded"), "false");
  assert.equal(elements.toggleMonitorList.textContent, "Show processing list");

  elements.toggleMonitorList.dispatch("click");
  assert.equal(elements.monitorListPanel.hidden, false);
  assert.equal(elements.monitorListPanel.dataset.collapsed, "false");
  assert.equal(elements.toggleMonitorList.getAttribute("aria-expanded"), "true");
  assert.equal(elements.toggleMonitorList.textContent, "Hide processing list");
});

test("monitor detail toggle collapses and restores the panel without losing its contents", () => {
  const { initializeMonitorDetailToggle, elements } = loadDashboard();
  const detailContent = new FakeElement("p");
  elements.monitorDetail.appendChild(detailContent);

  initializeMonitorDetailToggle();
  assert.equal(elements.monitorDetail.hidden, false);
  assert.equal(elements.monitorLayout.dataset.detailCollapsed, "false");
  assert.equal(elements.toggleMonitorDetail.getAttribute("aria-expanded"), "true");
  assert.equal(elements.toggleMonitorDetail.textContent, "Hide details");

  elements.toggleMonitorDetail.dispatch("click");
  assert.equal(elements.monitorDetail.hidden, true);
  assert.equal(elements.monitorLayout.dataset.detailCollapsed, "true");
  assert.equal(elements.toggleMonitorDetail.getAttribute("aria-expanded"), "false");
  assert.equal(elements.toggleMonitorDetail.textContent, "Show details");
  assert.equal(elements.monitorDetail.firstElementChild, detailContent);

  elements.toggleMonitorDetail.dispatch("click");
  assert.equal(elements.monitorDetail.hidden, false);
  assert.equal(elements.monitorLayout.dataset.detailCollapsed, "false");
  assert.equal(elements.toggleMonitorDetail.getAttribute("aria-expanded"), "true");
  assert.equal(elements.toggleMonitorDetail.textContent, "Hide details");
  assert.equal(elements.monitorDetail.firstElementChild, detailContent);
});

test("dashboard polling does not reset a focused strength or mode control", () => {
  const { refreshEnhancementControls, elements, document } = loadDashboard();
  elements.level.value = "100";
  elements.levelValue.textContent = "100%";
  elements.mode.value = "artwork";

  document.activeElement = elements.level;
  refreshEnhancementControls({ mode: "manga", enhanceLevel: 0.05 });
  assert.equal(elements.level.value, "100");
  assert.equal(elements.levelValue.textContent, "100%");
  assert.equal(elements.mode.value, "manga");

  elements.mode.value = "artwork";
  document.activeElement = elements.mode;
  refreshEnhancementControls({ mode: "photo", enhanceLevel: 0.35 });
  assert.equal(elements.mode.value, "artwork");
  assert.equal(String(elements.level.value), "35");
  assert.equal(elements.levelValue.textContent, "35%");
});

test("dashboard keyed rendering preserves image nodes when URLs do not change", () => {
  const { renderImages, imageRows } = loadDashboard();
  const record = imageRecord({
    status: "fixed",
    originalImageUrl: "http://127.0.0.1:8765/cache/images/original.webp",
    enhancedImageUrl: "http://127.0.0.1:8765/cache/images/enhanced.webp",
  });

  renderImages([record]);
  const row = [...imageRows.values()][0];
  const originalImage = row.__parts.originalMedia.firstElementChild;
  const enhancedImage = row.__parts.aiMedia.firstElementChild;

  renderImages([{ ...record, status: "cache" }]);

  assert.equal([...imageRows.values()][0], row);
  assert.equal(row.__parts.originalMedia.firstElementChild, originalImage);
  assert.equal(row.__parts.aiMedia.firstElementChild, enhancedImage);
  assert.equal(row.__parts.state.textContent, "cache");
});

test("dashboard shows remote originals before processing and falls back only after preview failure", () => {
  const { renderImages, imageRows } = loadDashboard();
  renderImages([imageRecord()]);
  const row = [...imageRows.values()][0];

  const remotePreview = row.__parts.originalMedia.firstElementChild;
  assert.equal(remotePreview.tagName, "IMG");
  assert.equal(remotePreview.src, "https://protected.example/page-1.jpg");
  assert.equal(remotePreview.loading, "lazy");
  assert.equal(row.__parts.aiMedia.firstElementChild.children[1].textContent, "Waiting for preprocessing slot");

  remotePreview.dispatch("error");
  const failedPreview = row.__parts.originalMedia.firstElementChild;
  assert.equal(failedPreview.dataset.placeholder, "true");
  renderImages([imageRecord()]);
  assert.equal(row.__parts.originalMedia.firstElementChild, failedPreview);

  renderImages([imageRecord({ originalImageUrl: "http://localhost:8765/cache/images/original.webp" })]);
  const preview = row.__parts.originalMedia.firstElementChild;
  assert.equal(preview.tagName, "IMG");
  preview.dispatch("error");
  assert.equal(row.__parts.originalMedia.firstElementChild.dataset.placeholder, "true");
});

test("dashboard recovers a protected pending original through the background preview reader", async () => {
  const messages = [];
  const { renderImages, imageRows } = loadDashboard({
    sendMessage: async (message) => {
      messages.push(message);
      return { ok: true, contentType: "image/png", imageData: "iVBORw0KGgoAAAANSUhEUg==" };
    },
  });
  renderImages([imageRecord({ pageUrl: "https://reader.example/chapter/1" })]);
  const row = [...imageRows.values()][0];
  row.__parts.originalMedia.firstElementChild.dispatch("error");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "GET_ORIGINAL_PREVIEW");
  assert.equal(messages[0].tabId, 7);
  assert.equal(messages[0].imageId, "image-1");
  assert.equal(messages[0].operationId, "operation-1");
  const fallback = row.__parts.originalMedia.firstElementChild;
  assert.equal(fallback.tagName, "IMG");
  assert.equal(fallback.src, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");

  renderImages([imageRecord({ pageUrl: "https://reader.example/chapter/1" })]);
  assert.equal(row.__parts.originalMedia.firstElementChild, fallback);
  assert.equal(messages.length, 1);
});

test("dashboard bans the exact AI result without adding the original URL to the source blacklist", async () => {
  const messages = [];
  const stored = [];
  const { renderImages, imageRows } = loadDashboard({
    sendMessage: async (message) => {
      messages.push(message);
      return { banned: true };
    },
    storageSet: async (value) => stored.push(value),
  });
  const record = imageRecord({
    status: "fixed",
    originalImageUrl: "https://cdn.example.test/original.jpg",
    enhancedImageUrl: "http://127.0.0.1:8766/cache/images/enhanced.webp?key=result-1",
  });

  renderImages([record]);
  const row = [...imageRows.values()][0];
  const banButton = row.__parts.aiActions.children.find((child) => child.className === "ban-result");
  assert.ok(banButton);
  banButton.dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "BAN_IMAGE_RESULT");
  assert.equal(messages[0].tabId, 7);
  assert.equal(messages[0].imageId, "image-1");
  assert.equal(messages[0].operationId, "operation-1");
  assert.equal(messages[0].resultUrl, "http://127.0.0.1:8766/cache/images/enhanced.webp?key=result-1");
  assert.deepEqual(stored, []);
  assert.equal(banButton.textContent, "Banned");
});

test("ERR-422-001 dashboard renders validation field and trace separately from preview state", () => {
  const { renderImages, imageRows } = loadDashboard();
  renderImages([imageRecord({
    status: "error",
    error: "Request validation failed",
    errorCode: "REQUEST_VALIDATION_FAILED",
    errorStatus: 422,
    errorTraceId: "trace-validation-422",
    validationFields: [{
      field: "body.maxOutputWidth",
      type: "greater_than_equal",
      message: "Input should be greater than or equal to 256",
    }],
  })]);
  const row = [...imageRows.values()][0];
  const aiPlaceholder = row.__parts.aiMedia.firstElementChild;
  const originalPreview = row.__parts.originalMedia.firstElementChild;

  assert.equal(aiPlaceholder.children[1].textContent, "Processing failed");
  assert.match(aiPlaceholder.children[2].textContent, /Request validation failed/);
  assert.match(aiPlaceholder.children[2].textContent, /Field: maxOutputWidth/);
  assert.match(aiPlaceholder.children[2].textContent, /Input should be greater than or equal to 256/);
  assert.match(aiPlaceholder.children[2].textContent, /Trace: trace-valida/);
  assert.equal(originalPreview.tagName, "IMG");
  assert.equal(originalPreview.src, "https://protected.example/page-1.jpg");
});

test("dashboard removes keyed rows only when their records disappear", () => {
  const { renderImages, imageRows, elements } = loadDashboard();
  renderImages([imageRecord()]);
  assert.equal(elements.imageList.children.length, 1);

  renderImages([]);

  assert.equal(imageRows.size, 0);
  assert.equal(elements.imageList.querySelector(".image-list-empty").textContent, "No eligible images have been detected on the content tab yet.");
});
