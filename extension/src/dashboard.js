const labels = { currentPage: "Current page", openPages: "All open tabs", lifetime: "All time" };

async function refresh() {
  const stats = await chrome.runtime.sendMessage({ type: "GET_STATS" });
  document.getElementById("mode").value = stats.mode || "auto";
  document.getElementById("level").value = Math.round((stats.enhanceLevel ?? 0.35) * 100);
  document.getElementById("levelValue").textContent = `${document.getElementById("level").value}%`;
  document.getElementById("status").textContent = stats.processing ? `${stats.processing} processing` : "Ready";
  renderComparison(stats.lastComparison);
  renderQuality(stats.lastQuality);
  renderScopes(stats.scopes || {});
}

function renderComparison(comparison) {
  if (!comparison?.originalImageUrl || !comparison?.enhancedImageUrl) return;
  const original = document.getElementById("original");
  const enhanced = document.getElementById("enhanced");
  original.src = comparison.originalImageUrl;
  enhanced.src = comparison.enhancedImageUrl;
  document.getElementById("originalEmpty").hidden = true;
  document.getElementById("enhancedEmpty").hidden = true;
}

function renderQuality(quality) {
  const target = document.getElementById("quality");
  if (!quality) { target.textContent = "No verified result yet."; return; }
  const entries = [
    ["Changed pixels", `${quality.changedPixelPercent}%`],
    ["Mean pixel difference", `${quality.pixelDifferencePercent}%`],
    ["Sharpness gain", `×${quality.sharpnessGain}`],
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
refresh();
setInterval(refresh, 2000);
