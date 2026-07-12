const labels = { currentPage: "Current page", openPages: "All open tabs", lifetime: "All time" };

async function refresh() {
  const [stats, page] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_STATS" }),
    chrome.runtime.sendMessage({ type: "GET_PAGE_IMAGES" }),
  ]);
  document.getElementById("mode").value = stats.mode || "auto";
  document.getElementById("level").value = Math.round((stats.enhanceLevel ?? 0.35) * 100);
  document.getElementById("levelValue").textContent = `${document.getElementById("level").value}%`;
  document.getElementById("timeout").value = stats.maxProcessingSeconds ?? 60;
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
    original.appendChild(createOpenButton(item.originalImageUrl || item.imageUrl, "Open original image"));
    row.append(ai, original);
    list.appendChild(row);
  });
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

document.getElementById("mode").addEventListener("change", saveSettings);
document.getElementById("level").addEventListener("input", () => document.getElementById("levelValue").textContent = `${document.getElementById("level").value}%`);
document.getElementById("level").addEventListener("change", saveSettings);
document.getElementById("timeout").addEventListener("change", () => chrome.runtime.sendMessage({
  type: "SET_PROCESSING_TIMEOUT", seconds: Number(document.getElementById("timeout").value),
}));
refresh();
setInterval(refresh, 2000);
