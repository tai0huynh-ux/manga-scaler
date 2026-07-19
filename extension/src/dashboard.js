const labels = { currentPage: "Current page", openPages: "All open tabs", lifetime: "All time" };
const imageSettingIds = [
  "sizingMode", "resolutionPreset", "screenOrientation",
  "maxOutputWidthEnabled", "maxOutputHeightEnabled", "maxOutputWidth", "maxOutputHeight",
  "minInputWidthEnabled", "minInputHeightEnabled", "maxInputWidthEnabled", "maxInputHeightEnabled",
  "minInputWidth", "minInputHeight", "maxInputWidth", "maxInputHeight",
  "outputQuality", "preprocessingConcurrency", "upscaleConcurrency",
  "imageSlicingEnabled", "imageSliceMaxWidth", "imageSliceMaxHeight", "performanceBoost",
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
let monitorSnapshot = null;
let selectedMonitorKey = null;
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
  const [stats, page, monitor] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_STATS", tabId: contentTabId }),
    chrome.runtime.sendMessage({ type: "GET_PAGE_IMAGES", tabId: contentTabId }),
    chrome.runtime.sendMessage({ type: "GET_PROCESSING_MONITOR", tabId: contentTabId }),
  ]);
  monitorSnapshot = monitor || { jobs: [], summary: {} };
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
  renderMonitor(monitorSnapshot, images, stats);
}

function monitorJobKey(job) {
  return job.key || `${job.tabId}:${job.imageId}:${job.operationId}`;
}

function monitorFilterValue(id) {
  return document.getElementById(id)?.value || "ALL";
}

function renderMonitor(snapshot, pageImages = [], stats = {}) {
  const jobs = Array.isArray(snapshot?.jobs) ? snapshot.jobs : [];
  const summary = snapshot?.summary || {};
  const summaryTarget = document.getElementById("monitorSummary");
  if (!summaryTarget) return;
  summaryTarget.replaceChildren();
  const cards = [
    ["active", "Active"], ["queued", "Queued"], ["deferred", "Deferred"],
    ["completed", "Completed"], ["failed", "Failed"], ["timedOut", "Timed out"],
    ["cancelled", "Cancelled"], ["skipped", "Skipped"], ["cacheHits", "Cache hits"],
    ["averageDurationMs", "Average duration"],
  ];
  cards.forEach(([key, label]) => {
    const card = document.createElement("article");
    const value = document.createElement("strong");
    const caption = document.createElement("span");
    value.textContent = summary[key] === null || summary[key] === undefined
      ? "Unavailable"
      : key === "averageDurationMs" ? `${summary[key]} ms` : String(summary[key] ?? 0);
    caption.textContent = label;
    card.append(value, caption);
    summaryTarget.appendChild(card);
  });
  [["backend", "Backend status", stats.backendLaunchStatus || "Unavailable"], ["model", "Model", stats.lastModel || "Unavailable"], ["provider", "Provider", stats.lastProvider || "Unavailable"]].forEach(([, label, value]) => {
    const card = document.createElement("article");
    const strong = document.createElement("strong");
    const caption = document.createElement("span");
    strong.textContent = value;
    caption.textContent = label;
    card.append(strong, caption);
    summaryTarget.appendChild(card);
  });
  const stageValues = [...new Set(jobs.map((job) => job.stage).filter(Boolean))].sort();
  const modeValues = [...new Set(jobs.map((job) => job.mode).filter(Boolean))].sort();
  const providerValues = [...new Set(jobs.map((job) => job.provider).filter(Boolean))].sort();
  const siteValues = [...new Set(jobs.map((job) => job.source?.hostname).filter(Boolean))].sort();
  const tabValues = [...new Set(jobs.map((job) => String(job.tabId)).filter(Boolean))].sort((left, right) => Number(left) - Number(right));
  updateMonitorOptions("monitorStageFilter", stageValues);
  updateMonitorOptions("monitorModeFilter", modeValues);
  updateMonitorOptions("monitorProviderFilter", providerValues);
  updateMonitorOptions("monitorSiteFilter", siteValues);
  updateMonitorOptions("monitorTabFilter", tabValues);
  const filtered = jobs.filter((job) => {
    const statusFilter = monitorFilterValue("monitorStatusFilter");
    const stageFilter = monitorFilterValue("monitorStageFilter");
    const modeFilter = monitorFilterValue("monitorModeFilter");
    const providerFilter = monitorFilterValue("monitorProviderFilter");
    const cacheFilter = monitorFilterValue("monitorCacheFilter");
    const siteFilter = monitorFilterValue("monitorSiteFilter");
    const tabFilter = monitorFilterValue("monitorTabFilter");
    const searchFilter = String(document.getElementById("monitorSearchFilter")?.value || "").trim().toLowerCase();
    const searchableIdentity = [job.jobId, job.imageId, job.operationId, job.traceId].filter(Boolean).join(" ").toLowerCase();
    return (statusFilter === "ALL" || (statusFilter === "ACTIVE" ? job.status !== "TERMINAL" : job.stage === statusFilter)) &&
      (stageFilter === "ALL" || job.stage === stageFilter) &&
      (modeFilter === "ALL" || job.mode === modeFilter) &&
      (providerFilter === "ALL" || job.provider === providerFilter) &&
      (cacheFilter === "ALL" || job.cache === cacheFilter) &&
      (siteFilter === "ALL" || job.source?.hostname === siteFilter) &&
      (tabFilter === "ALL" || String(job.tabId) === tabFilter) &&
      (!searchFilter || searchableIdentity.includes(searchFilter));
  });
  const table = document.getElementById("monitorJobs");
  const empty = document.getElementById("monitorEmpty");
  table.replaceChildren();
  empty.hidden = filtered.length > 0;
  const pageByKey = new Map((pageImages || []).map((item) => [imageRowKey(item), item]));
  filtered.forEach((job) => {
    const row = document.createElement("tr");
    row.dataset.key = monitorJobKey(job);
    row.dataset.selected = String(selectedMonitorKey === monitorJobKey(job));
    row.addEventListener("click", () => {
      selectedMonitorKey = monitorJobKey(job);
      renderMonitor(monitorSnapshot, pageImages, stats);
    });
    const pageImage = pageByKey.get(`${job.tabId}:${job.imageId}:${job.operationId}`) || pageByKey.get(`${job.tabId}:${job.imageId}:operation`);
    const cells = [
      `${job.imageId || "unknown"}${job.segmentIndex === null || job.segmentIndex === undefined ? "" : ` [${job.segmentIndex + 1}/${job.segmentCount || "?"}]`}`,
      job.stage || "UNKNOWN",
      job.status || "UNKNOWN",
      formatMonitorElapsed(job),
      formatMonitorInput(job),
      job.cache || "UNKNOWN",
      job.error?.errorCode || "",
    ];
    cells.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 1) cell.className = "monitor-stage";
      if (index === 2) {
        cell.className = `monitor-status ${job.stage === "FAILED" ? "monitor-status-failed" : job.stage === "TIMED_OUT" ? "monitor-status-timeout" : job.stage === "CANCELLED" ? "monitor-status-cancelled" : job.status === "TERMINAL" ? "monitor-status-terminal" : ""}`;
      }
      row.appendChild(cell);
    });
    const actions = document.createElement("td");
    const terminal = job.status === "TERMINAL";
    if (!terminal) actions.appendChild(createMonitorAction("cancel", "Cancel", job));
    if (terminal && job.error?.retryable) actions.appendChild(createMonitorAction("retry", "Retry", job));
    if (pageImage?.enhancedImageUrl && isStablePreviewUrl(pageImage.enhancedImageUrl)) actions.appendChild(createMonitorAction("show", "Show enhanced", job, pageImage.enhancedImageUrl));
    row.appendChild(actions);
    table.appendChild(row);
  });
  const selected = jobs.find((job) => monitorJobKey(job) === selectedMonitorKey) || filtered[0];
  if (selected) {
    selectedMonitorKey = monitorJobKey(selected);
    renderMonitorDetail(selected);
  }
}

function updateMonitorOptions(id, values) {
  const select = document.getElementById(id);
  if (!select) return;
  const current = select.value;
  select.replaceChildren(new Option("All", "ALL"));
  values.forEach((value) => select.appendChild(new Option(value, value)));
  select.value = values.includes(current) ? current : "ALL";
}

function formatMonitorElapsed(job) {
  const start = Date.parse(job.createdAt || "");
  const end = Date.parse(job.updatedAt || "") || Date.now();
  if (!Number.isFinite(start)) return "Unavailable";
  return `${Math.max(0, Math.round(end - start))} ms`;
}

function formatMonitorInput(job) {
  const width = job.input?.width;
  const height = job.input?.height;
  return Number.isFinite(width) && Number.isFinite(height) ? `${width}x${height}` : "Unavailable";
}

function createMonitorAction(action, text, job, href = null) {
  const button = document.createElement(href ? "a" : "button");
  button.type = "button";
  button.dataset.action = action;
  button.textContent = text;
  if (href) {
    button.href = href;
    button.target = "_blank";
    button.rel = "noopener";
  } else {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (action === "cancel") await chrome.runtime.sendMessage({ type: "CANCEL_IMAGE", tabId: job.tabId, imageId: job.imageId, operationId: job.operationId });
      if (action === "retry") await chrome.runtime.sendMessage({ type: "RETRY_IMAGE", tabId: job.tabId, imageId: job.imageId, operationId: job.operationId });
      await refresh();
    });
  }
  return button;
}

function renderMonitorDetail(job) {
  const target = document.getElementById("monitorDetail");
  if (!target) return;
  target.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = `${job.imageId || "Image"} - ${job.stage}`;
  target.appendChild(heading);
  const dl = document.createElement("dl");
  [["Operation", job.operationId], ["Job", job.jobId], ["Trace", job.traceId], ["Source", formatMonitorSource(job.source)], ["Fingerprint", job.sourceFingerprint], ["Mode", job.mode], ["Model", job.model], ["Provider", job.provider], ["Input", formatMonitorInput(job)], ["Cache", job.cache], ["Render commit", job.renderCommit?.confirmed ? "Confirmed" : "Not confirmed"]].forEach(([label, value]) => {
    const wrapper = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value || "Unavailable";
    wrapper.append(term, detail);
    dl.appendChild(wrapper);
  });
  target.appendChild(dl);
  if (job.traceId) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy trace ID";
    copy.addEventListener("click", () => navigator.clipboard?.writeText(job.traceId));
    target.appendChild(copy);
  }
  if (job.error) {
    const error = document.createElement("div");
    error.className = "monitor-error";
    error.textContent = `${job.error.errorCode}: ${job.error.message}${job.error.field ? ` (${job.error.field})` : ""}`;
    target.appendChild(error);
  }
  const timeline = document.createElement("ol");
  timeline.className = "monitor-timeline";
  (job.timeline || []).forEach((event) => {
    const item = document.createElement("li");
    const stage = document.createElement("strong");
    const time = document.createElement("small");
    stage.textContent = `${event.stage} - ${event.status}`;
    time.textContent = `${event.timestamp}${event.durationMs === null ? "" : ` (${event.durationMs} ms)`}`;
    item.append(stage, time);
    timeline.appendChild(item);
  });
  target.appendChild(timeline);
}

function formatMonitorSource(source) {
  if (!source) return "Unavailable";
  return `${source.scheme}://${source.hostname}${source.path || "/"}${source.queryKeys?.length ? ` ?${source.queryKeys.join(", ")}` : ""}`;
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
    updateMediaPlaceholder(
      parts.aiMedia,
      title,
      formatImageError(item, item.error || item.reason || defaultDetail),
      ["error", "timeout", "cancelled", "removed", "seen"].includes(status),
    );
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

function formatImageError(item, fallback) {
  if (item.errorCode !== "REQUEST_VALIDATION_FAILED") return fallback;
  const validation = Array.isArray(item.validationFields) ? item.validationFields[0] : null;
  const field = typeof validation?.field === "string"
    ? validation.field.replace(/^body\./, "")
    : null;
  const reason = typeof validation?.message === "string" ? validation.message : null;
  const trace = typeof item.errorTraceId === "string" && item.errorTraceId
    ? item.errorTraceId.slice(0, 12)
    : null;
  return [
    "Request validation failed",
    field ? `Field: ${field}` : null,
    reason ? `Reason: ${reason}` : null,
    trace ? `Trace: ${trace}` : null,
  ].filter(Boolean).join("\n");
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
    imageSlicingEnabled: checked("imageSlicingEnabled"), imageSliceMaxWidth: Number(value("imageSliceMaxWidth")), imageSliceMaxHeight: Number(value("imageSliceMaxHeight")),
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
[
  "monitorStatusFilter", "monitorStageFilter", "monitorModeFilter", "monitorProviderFilter", "monitorCacheFilter",
  "monitorSiteFilter", "monitorTabFilter",
].forEach((id) => document.getElementById(id).addEventListener("change", () => renderMonitor(monitorSnapshot || { jobs: [] })));
document.getElementById("monitorSearchFilter").addEventListener("input", () => renderMonitor(monitorSnapshot || { jobs: [] }));
document.getElementById("refreshMonitor").addEventListener("click", refresh);
[["clearMonitorCompleted", "COMPLETED"], ["clearMonitorFailed", "FAILED"]].forEach(([id, stage]) => {
  document.getElementById(id).addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CLEAR_PROCESSING_HISTORY", stage });
    selectedMonitorKey = null;
    await refresh();
  });
});
document.getElementById("exportMonitor").addEventListener("click", () => {
  const payload = JSON.stringify(monitorSnapshot || { jobs: [] }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "processing-monitor-diagnostic.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
refresh();
setInterval(refresh, 2000);
