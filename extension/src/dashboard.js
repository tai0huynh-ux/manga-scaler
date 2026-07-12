const labels = { currentPage: "Current page", openPages: "All open tabs", lifetime: "All time" };
const imageSettingIds = [
  "sizingMode", "resolutionPreset", "screenOrientation",
  "maxOutputWidthEnabled", "maxOutputHeightEnabled", "maxOutputWidth", "maxOutputHeight",
  "minInputWidthEnabled", "minInputHeightEnabled", "maxInputWidthEnabled", "maxInputHeightEnabled",
  "minInputWidth", "minInputHeight", "maxInputWidth", "maxInputHeight",
  "outputQuality", "preprocessingConcurrency", "upscaleConcurrency",
  "imageSlicingEnabled", "imageSliceMaxHeight", "performanceBoost",
];
const limitTogglePairs = {
  maxOutputWidthEnabled: "maxOutputWidth",
  maxOutputHeightEnabled: "maxOutputHeight",
  minInputWidthEnabled: "minInputWidth",
  minInputHeightEnabled: "minInputHeight",
  maxInputWidthEnabled: "maxInputWidth",
  maxInputHeightEnabled: "maxInputHeight",
};

async function refresh() {
  const [stats, page] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_STATS" }),
    chrome.runtime.sendMessage({ type: "GET_PAGE_IMAGES" }),
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
  list.replaceChildren();
  if (!images.length) {
    const empty = document.createElement("p");
    empty.textContent = "No eligible images have been detected on the content tab yet.";
    list.appendChild(empty);
    return;
  }
  images.forEach((item, index) => {
    const row = document.createElement("article");
    row.className = "image-row";
    const ai = document.createElement("figure");
    const original = document.createElement("figure");
    const aiCaption = document.createElement("figcaption");
    aiCaption.textContent = `AI result #${index + 1} `;
    const state = document.createElement("span");
    state.className = `state state-${item.status}`;
    state.textContent = item.status;
    aiCaption.appendChild(state);
    ai.appendChild(aiCaption);
    const originalCaption = document.createElement("figcaption");
    originalCaption.textContent = `Original #${index + 1}`;
    original.appendChild(originalCaption);

    if (item.enhancedImageUrl) {
      ai.appendChild(createImage(item.enhancedImageUrl, `AI enhanced image ${index + 1}`));
      ai.appendChild(createOpenButton(item.enhancedImageUrl, "Open AI image"));
    } else {
      const pending = document.createElement("div");
      pending.className = "pending";
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      const title = document.createElement("strong");
      title.textContent = item.status === "error" ? "Processing failed" : "Waiting for AI";
      const detail = document.createElement("small");
      detail.textContent = item.error || "The original remains visible until enhancement finishes.";
      pending.append(spinner, title, detail);
      ai.appendChild(pending);
    }
    original.appendChild(createImage(item.originalImageUrl || item.imageUrl, `Original image ${index + 1}`));
    const actions = document.createElement("div");
    actions.className = "image-actions";
    actions.append(
      createOpenButton(item.originalImageUrl || item.imageUrl, "Open original image"),
      createBlockButton(item.imageUrl || item.originalImageUrl),
    );
    original.appendChild(actions);
    row.append(ai, original);
    list.appendChild(row);
  });
}

function createBlockButton(source) {
  const button = document.createElement("button");
  button.className = "block-image";
  button.type = "button";
  button.textContent = "Block AI";
  button.title = "Do not upscale this image again";
  button.addEventListener("click", async () => {
    const rule = normalizeImageUrl(source);
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
