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

function loadDashboard() {
  const root = path.resolve(__dirname, "..", "..");
  const source = fs.readFileSync(path.join(root, "extension", "src", "dashboard.js"), "utf8");
  const prefix = source.slice(0, source.indexOf('document.getElementById("mode").addEventListener'));
  const elements = {
    imageList: new FakeElement("div"),
    imageCount: new FakeElement("span"),
  };
  const document = {
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
      runtime: { sendMessage: async () => ({}) },
      storage: { local: { get: async () => ({ blacklistRules: [] }), set: async () => undefined } },
    },
  });
  vm.runInContext(`${prefix}\nglobalThis.__renderImages = renderImages; globalThis.__imageRows = imageRows;`, context);
  return { renderImages: context.__renderImages, imageRows: context.__imageRows, elements };
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

test("dashboard uses a placeholder for remote-only originals and failed local previews", () => {
  const { renderImages, imageRows } = loadDashboard();
  renderImages([imageRecord()]);
  const row = [...imageRows.values()][0];

  assert.equal(row.__parts.originalMedia.firstElementChild.dataset.placeholder, "true");
  assert.equal(row.__parts.originalMedia.querySelector("img"), null);
  assert.equal(row.__parts.aiMedia.firstElementChild.children[1].textContent, "Waiting for preprocessing slot");

  renderImages([imageRecord({ originalImageUrl: "http://localhost:8765/cache/images/original.webp" })]);
  const preview = row.__parts.originalMedia.firstElementChild;
  assert.equal(preview.tagName, "IMG");
  preview.dispatch("error");
  assert.equal(row.__parts.originalMedia.firstElementChild.dataset.placeholder, "true");
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
  const originalPlaceholder = row.__parts.originalMedia.firstElementChild;

  assert.equal(aiPlaceholder.children[1].textContent, "Processing failed");
  assert.match(aiPlaceholder.children[2].textContent, /Request validation failed/);
  assert.match(aiPlaceholder.children[2].textContent, /Field: maxOutputWidth/);
  assert.match(aiPlaceholder.children[2].textContent, /Input should be greater than or equal to 256/);
  assert.match(aiPlaceholder.children[2].textContent, /Trace: trace-valida/);
  assert.equal(originalPlaceholder.children[1].textContent, "Original preview is not available yet");
  assert.doesNotMatch(originalPlaceholder.children[2].textContent, /validation/i);
});

test("dashboard removes keyed rows only when their records disappear", () => {
  const { renderImages, imageRows, elements } = loadDashboard();
  renderImages([imageRecord()]);
  assert.equal(elements.imageList.children.length, 1);

  renderImages([]);

  assert.equal(imageRows.size, 0);
  assert.equal(elements.imageList.querySelector(".image-list-empty").textContent, "No eligible images have been detected on the content tab yet.");
});
