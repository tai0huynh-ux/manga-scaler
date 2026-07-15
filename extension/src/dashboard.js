const labels = { currentPage: "Current page", openPages: "All open tabs", lifetime: "All time" };
const imageSettingIds = [
  "sizingMode", "resolutionPreset", "screenOrientation",
  "maxOutputWidthEnabled", "maxOutputHeightEnabled", "maxOutputWidth", "maxOutputHeight",
  "minInputWidthEnabled", "minInputHeightEnabled", "maxInputWidthEnabled", "maxInputHeightEnabled",
  "minInputWidth", "minInputHeight", "maxInputWidth", "maxInputHeight",
  "outputQuality", "preprocessingConcurrency", "upscaleConcurrency",
  "imageSlicingEnabled", "imageSliceMaxHeight", "performanceBoost",
  "textCleanupEnabled", "textTranslateEnabled", "textSourceLanguage", "textTargetLanguage",
];
const limitTogglePairs = {
  maxOutputWidthEnabled: "maxOutputWidth",
  maxOutputHeightEnabled: "maxOutputHeight",
  minInputWidthEnabled: "minInputWidth",
  minInputHeightEnabled: "minInputHeight",
  maxInputWidthEnabled: "maxInputWidth",
  maxInputHeightEnabled: "maxInputHeight",
};
const requestedTabIdValue = new URLSearchParams(window.location.search).get("tabId");
const requestedTabId = requestedTabIdValue === null ? null : Number(requestedTabIdValue);
const contentTabId = Number.isInteger(requestedTabId) && requestedTabId >= 0 ? requestedTabId : null;
const imageRows = new Map();
const statusPresentation = {
  seen: ["Detected", "Detected, not queued for preprocessing."],
  preprocessing_queued: ["Waiting for preprocessing slot", "This image is queued behind images closer to the viewport."],
  preprocessing: ["Preparing image", "Reading and preparing the image before AI processing."],
  waiting: ["Waiting for AI worker", "Preprocessing completed and the backend job is queued."],
  processing: ["Processing with AI", "The backend is enhancing this image."],
  fixed: ["Completed", "Enhancement completed."],
  cache: ["Loaded from cache", "A verified cached result was reused."],
  error: ["Processing failed", "The image could not be processed."],
  timeout: ["Timed out", "Processing exceeded the allowed stage timeout."],
  cancelled: ["Cancelled", "This operation was cancelled."],
  removed: ["No longer available", "The source image is no longer on the page."],
};

async function refresh() {
  const [stats, page] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_STATS", tabId: contentTabId }),
    chrome.runtime.sendMessage({ type: "GET_PAGE_IMAGES", tabId: contentTabId }),
  ]);
  document.getElementById("mode").value = stats.mode || "auto";
  document.getElementById("level").value = Math.round((stats.enhanceLevel ?? 0.35) * 100);
  document.getElementById("levelValue").textContent = `${document.getElementById("level").value}%`;
  document.getElementById("timeout").value = stats.maxProcessingSeconds ?? 60;
  if (!document.querySelector(".settings").contains(document.activeElement)) {
    imageSettingIds.forEach((id) => {
      const element = document.getElementById(id);
      if (element.type === "checkbox") element.checked = Boolean(stats[id]);
      else element.value = stats[id] ?? "";
    });
  }
  renderSizeMode();
  document.getElementById("status").textContent = stats.processing ? `${stats.processing} processing` : "Ready";
  const images = page?.images || [];
  renderImages(images);
  renderQuality([...images].reverse().find((item) => item.quality)?.quality || stats.lastQuality);
  renderScopes(stats.scopes || {});
  renderBlacklist(stats.blacklistRules || []);
}

function renderBlacklist(rules) {
  const target = document.getElementById("blacklist");
  target.replaceChildren();
  if (!rules.length) { target.textContent = "No images are blocked."; return; }
  rules.forEach((rule) => {
    const row = document.createElement("div");
    row.className = "blacklist-row";
    const text = document.createElement("code");
    text.textContent = rule;
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      await chrome.storage.local.set({ blacklistRules: rules.filter((item) => item !== rule) });
      refresh();
    });
    row.append(text, remove);
    target.appendChild(row);
  });
}

function renderImages(images) {
  const list = document.getElementById("imageList");
  document.getElementById("imageCount").textContent = `${images.length} images`;
  const activeKeys = new Set();
  if (!images.length) {
    imageRows.forEach((row) => row.remove());
    imageRows.clear();
    let empty = list.querySelector?.(".image-list-empty");
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "image-list-empty";
      list.appendChild(empty);
    }
    empty.textContent = "No eligible images have been detected on the content tab yet.";
    return;
  }
  list.querySelector?.(".image-list-empty")?.remove();
  images.forEach((item, index) => {
    const key = imageRowKey(item);
    activeKeys.add(key);
    let row = imageRows.get(key);
    if (!row) {
      row = createImageRow();
      row.dataset.imageKey = key;
      imageRows.set(key, row);
    }
    updateImageRow(row, item, index);
    list.appendChild(row);
  });
  for (const [key, row] of imageRows) {
    if (activeKeys.has(key)) continue;
    row.remove();
    imageRows.delete(key);
  }
}

function imageRowKey(item) {
  return `${item.tabId ?? contentTabId ?? "unknown"}:${item.imageId || item.imageUrl || "image"}:${item.operationId || "operation"}`;
}

function createImageRow() {
  const row = document.createElement("article");
  row.className = "image-row";
  const ai = document.createElement("figure");
  const original = document.createElement("figure");
  const aiCaption = document.createElement("figcaption");
  const aiLabel = document.createElement("span");
  const state = document.createElement("span");
  state.className = "state";
  aiCaption.append(aiLabel, state);
  const aiMedia = document.createElement("div");
  aiMedia.className = "image-media ai-media";
  const aiActions = document.createElement("div");
  aiActions.className = "image-actions";
  ai.append(aiCaption, aiMedia, aiActions);

  const originalCaption = document.createElement("figcaption");
  const originalMedia = document.createElement("div");
  originalMedia.className = "image-media original-media";
  const originalActions = document.createElement("div");
  originalActions.className = "image-actions";
  const openOriginal = createOpenButton("", "Open original image");
  const block = createBlockButton("");
  originalActions.append(openOriginal, block);
  original.append(originalCaption, originalMedia, originalActions);
  row.append(ai, original);
  row.__parts = { aiLabel, state, aiMedia, aiActions, originalCaption, originalMedia, openOriginal, block };
  return row;
}

function updateImageRow(row, item, index) {
  const parts = row.__parts;
  const status = item.status || "seen";
  parts.aiLabel.textContent = `AI result #${index + 1} `;
  parts.state.className = `state state-${status}`;
  parts.state.textContent = status;
  parts.originalCaption.textContent = `Original #${index + 1}`;

  if (item.enhancedImageUrl) {
    updateMediaImage(parts.aiMedia, item.enhancedImageUrl, `AI enhanced image ${index + 1}`, "AI result is unavailable.");
    updateSingleOpenButton(parts.aiActions, item.enhancedImageUrl, "Open AI image");
  } else {
    const [title, defaultDetail] = statusPresentation[status] || ["Waiting", "The image operation has not completed yet."];
    updateMediaPlaceholder(parts.aiMedia, title, item.error || item.reason || defaultDetail, ["error", "timeout", "cancelled", "removed", "seen"].includes(status));
    parts.aiActions.replaceChildren();
  }

  const previewUrl = isStablePreviewUrl(item.originalImageUrl) ? item.originalImageUrl : null;
  if (previewUrl) {
    updateMediaImage(parts.originalMedia, previewUrl, `Original image ${index + 1}`, "Original preview is not available yet");
  } else {
    updateMediaPlaceholder(parts.originalMedia, "Original preview is not available yet", "Open the original image to view the website source.", true);
  }
  const originalUrl = item.imageUrl || item.originalImageUrl || "";
  parts.openOriginal.href = originalUrl;
  parts.openOriginal.hidden = !originalUrl;
  parts.block.dataset.source = originalUrl;
  parts.block.disabled = !originalUrl;
}

function updateMediaImage(host, source, alt, failureText) {
  const current = host.firstElementChild;
  if (current?.tagName === "IMG" && current.dataset.source === source) {
    current.alt = alt;
    return current;
  }
  const image = createImage(source, alt);
  image.dataset.source = source;
  image.addEventListener("error", () => {
    if (host.firstElementChild !== image) return;
    updateMediaPlaceholder(host, failureText, "The preview URL could not be loaded.", true);
  }, { once: true });
  host.replaceChildren(image);
  return image;
}

function updateMediaPlaceholder(host, titleText, detailText, withoutSpinner = false) {
  let placeholder = host.firstElementChild;
  if (!placeholder || placeholder.dataset?.placeholder !== "true") {
    placeholder = document.createElement("div");
    placeholder.className = "pending";
    placeholder.dataset.placeholder = "true";
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    const title = document.createElement("strong");
    const detail = document.createElement("small");
    placeholder.append(spinner, title, detail);
    host.replaceChildren(placeholder);
  }
  const [spinner, title, detail] = placeholder.children;
  spinner.hidden = withoutSpinner;
  title.textContent = titleText;
  detail.textContent = detailText;
}

function updateSingleOpenButton(host, source, text) {
  let link = host.firstElementChild;
  if (!link || link.tagName !== "A") {
    link = createOpenButton(source, text);
    host.replaceChildren(link);
  }
  link.href = source;
  link.textContent = text;
}

function isStablePreviewUrl(source) {
  if (!source) return false;
  try {
    const url = new URL(source);
    return ["blob:", "data:", "chrome-extension:"].includes(url.protocol) ||
      (["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost"].includes(url.hostname));
  } catch {
    return false;
  }
}

function createBlockButton(source) {
  const button = document.createElement("button");
  button.className = "block-image";
  button.type = "button";
  button.textContent = "Block AI";
  button.title = "Do not upscale this image again";
  button.dataset.source = source;
  button.addEventListener("click", async () => {
    const rule = normalizeImageUrl(button.dataset.source || "");
    const stored = await chrome.storage.local.get({ blacklistRules: [] });
    await chrome.storage.local.set({ blacklistRules: [...new Set([...(stored.blacklistRules || []), rule])] });
    button.disabled = true;
    button.textContent = "Blocked";
    refresh();
  });
  return button;
}

function normalizeImageUrl(source) {
  try {
    const url = new URL(source);
    return `${url.origin}${url.pathname}`;
  } catch {
    return source;
  }
}

function createOpenButton(source, text) {
  const link = document.createElement("a");
  link.className = "open-image";
  link.href = source;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = text;
  return link;
}

function createImage(source, alt) {
  const image = document.createElement("img");
  image.loading = "lazy";
  image.src = source;
  image.alt = alt;
  return image;
}

function renderQuality(quality) {
  const target = document.getElementById("quality");
  if (!quality) { target.textContent = "No verified result yet."; return; }
  const entries = [
    ["Changed pixels", `${quality.changedPixelPercent}%`],
    ["Mean pixel difference", `${quality.pixelDifferencePercent}%`],
    ["Sharpness gain", `x${quality.sharpnessGain}`],
    ["Original contrast", quality.originalContrast],
    ["Enhanced contrast", quality.enhancedContrast],
  ];
  target.innerHTML = entries.map(([key, value]) => `<div><span>${key}</span><strong>${value}</strong></div>`).join("");
}

function renderScopes(scopes) {
  document.getElementById("scopes").innerHTML = Object.entries(scopes).map(([name, value]) => `
    <article><h3>${labels[name]}</h3><dl>
      <div><dt>Seen</dt><dd>${value.seen ?? 0}</dd></div><div><dt>Fixed</dt><dd>${value.fixed ?? 0}</dd></div>
      <div><dt>Working</dt><dd>${value.processing ?? 0}</dd></div><div><dt>Errors</dt><dd>${value.errors ?? 0}</dd></div>
      <div><dt>Cache</dt><dd>${value.cache ?? 0}</dd></div>
    </dl></article>`).join("");
}

async function saveSettings() {
  const mode = document.getElementById("mode").value;
  const enhanceLevel = Number(document.getElementById("level").value) / 100;
  await chrome.runtime.sendMessage({ type: "SET_ENHANCEMENT", mode, enhanceLevel });
  document.getElementById("levelValue").textContent = `${Math.round(enhanceLevel * 100)}%`;
}

async function saveImageSettings() {
  const value = (id) => document.getElementById(id).value;
  const checked = (id) => document.getElementById(id).checked;
  renderSizeMode();
  await chrome.runtime.sendMessage({
    type: "SET_IMAGE_LIMITS", sizingMode: value("sizingMode"),
    resolutionPreset: value("resolutionPreset"), screenOrientation: value("screenOrientation"),
    maxOutputWidth: Number(value("maxOutputWidth")), maxOutputHeight: Number(value("maxOutputHeight")),
    minInputWidth: Number(value("minInputWidth")), minInputHeight: Number(value("minInputHeight")),
    maxInputWidth: Number(value("maxInputWidth")), maxInputHeight: Number(value("maxInputHeight")),
    maxOutputWidthEnabled: checked("maxOutputWidthEnabled"), maxOutputHeightEnabled: checked("maxOutputHeightEnabled"),
    minInputWidthEnabled: checked("minInputWidthEnabled"), minInputHeightEnabled: checked("minInputHeightEnabled"),
    maxInputWidthEnabled: checked("maxInputWidthEnabled"), maxInputHeightEnabled: checked("maxInputHeightEnabled"),
    outputQuality: Number(value("outputQuality")), performanceBoost: document.getElementById("performanceBoost").checked,
    imageSlicingEnabled: checked("imageSlicingEnabled"), imageSliceMaxHeight: Number(value("imageSliceMaxHeight")),
    preprocessingConcurrency: Number(value("preprocessingConcurrency")), upscaleConcurrency: Number(value("upscaleConcurrency")),
    textCleanupEnabled: checked("textCleanupEnabled"), textTranslateEnabled: checked("textTranslateEnabled"),
    textSourceLanguage: value("textSourceLanguage"), textTargetLanguage: value("textTargetLanguage"),
  });
}

function renderSizeMode() {
  const mode = document.getElementById("sizingMode").value;
  document.getElementById("autoSizePanel").hidden = mode !== "auto";
  document.getElementById("pixelSizePanel").hidden = mode !== "pixel";
  document.getElementById("screenSizePanel").hidden = mode !== "screen";
  Object.entries(limitTogglePairs).forEach(([toggleId, inputId]) => {
    document.getElementById(inputId).disabled = !document.getElementById(toggleId).checked;
  });
}

document.getElementById("mode").addEventListener("change", saveSettings);
document.getElementById("level").addEventListener("input", () => document.getElementById("levelValue").textContent = `${document.getElementById("level").value}%`);
document.getElementById("level").addEventListener("change", saveSettings);
document.getElementById("timeout").addEventListener("change", () => chrome.runtime.sendMessage({
  type: "SET_PROCESSING_TIMEOUT", seconds: Number(document.getElementById("timeout").value),
}));
imageSettingIds.forEach((id) => {
  document.getElementById(id).addEventListener("change", saveImageSettings);
});
refresh();
setInterval(refresh, 2000);
