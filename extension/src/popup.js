/**
 * Popup controller that renders backend health, counters, and enable state.
 */
class PopupController {
  constructor(documentRef) {
    this.document = documentRef;
    this.backendStatus = this.document.getElementById("backendStatus");
    this.enabledToggle = this.document.getElementById("enabledToggle");
    this.modeSelect = this.document.getElementById("modeSelect");
    this.enhanceLevel = this.document.getElementById("enhanceLevel");
    this.enhanceLevelValue = this.document.getElementById("enhanceLevelValue");
    this.processingTimeout = this.document.getElementById("processingTimeout");
    this.modeDescription = this.document.getElementById("modeDescription");
    this.previewOriginal = this.document.getElementById("previewOriginal");
    this.qualitySummary = this.document.getElementById("qualitySummary");
    this.qualityDetails = this.document.getElementById("qualityDetails");
    this.openDashboard = this.document.getElementById("openDashboard");
    this.processedCount = this.document.getElementById("processedCount");
    this.cacheHitCount = this.document.getElementById("cacheHitCount");
    this.errorCount = this.document.getElementById("errorCount");
    this.queueSizeCount = this.document.getElementById("queueSizeCount");
    this.processingCount = this.document.getElementById("processingCount");
    this.waitingCount = this.document.getElementById("waitingCount");
    this.averageLatency = this.document.getElementById("averageLatency");
    this.cacheHitRatio = this.document.getElementById("cacheHitRatio");
  }

  start() {
    this.enabledToggle.addEventListener("change", () => this.setEnabled(this.enabledToggle.checked));
    this.modeSelect.addEventListener("change", () => this.saveEnhancementSettings());
    this.enhanceLevel.addEventListener("input", () => this.renderEnhancementSettings());
    this.enhanceLevel.addEventListener("change", () => this.saveEnhancementSettings());
    this.processingTimeout.addEventListener("change", () => chrome.runtime.sendMessage({
      type: "SET_PROCESSING_TIMEOUT", seconds: Number(this.processingTimeout.value),
    }));
    this.previewOriginal.addEventListener("change", () => {
      chrome.runtime.sendMessage({ type: "SET_PREVIEW_ORIGINAL", enabled: this.previewOriginal.checked });
    });
    this.openDashboard.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }));
    this.refresh();
    this.refreshTimer = setInterval(() => this.refreshStats(), 2000);
  }

  async refresh() {
    await Promise.all([this.refreshBackendHealth(), this.refreshStats()]);
  }

  async refreshBackendHealth() {
    try {
      const response = await fetch(`${AI_MANGA_UPSCALER_CONFIG.backend.baseUrl}/health`);
      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const payload = await response.json();
      this.setBackendStatus(payload.status === "ok" ? "Backend online" : "Backend unavailable", true);
    } catch {
      const launch = await chrome.storage.local.get({ backendLaunchError: null });
      this.setBackendStatus(launch.backendLaunchError ? "Backend start failed" : "Backend offline", false);
      this.backendStatus.title = launch.backendLaunchError || "Backend is not reachable.";
    }
  }

  async refreshStats() {
    const stats = await chrome.runtime.sendMessage({ type: "GET_STATS" });
    this.enabledToggle.checked = Boolean(stats.enabled);
    this.modeSelect.value = stats.mode || "auto";
    this.enhanceLevel.value = String(Math.round((stats.enhanceLevel ?? 0.35) * 100));
    this.processingTimeout.value = String(stats.maxProcessingSeconds ?? 60);
    this.renderEnhancementSettings();
    this.processedCount.textContent = String(stats.processed ?? 0);
    this.cacheHitCount.textContent = String(stats.cacheHits ?? 0);
    this.errorCount.textContent = String(stats.errors ?? 0);
    this.queueSizeCount.textContent = String(stats.queueSize ?? 0);
    this.processingCount.textContent = String(stats.processing ?? 0);
    this.waitingCount.textContent = String(stats.waiting ?? 0);
    this.averageLatency.textContent = `${stats.averageLatencyMs ?? 0} ms`;
    this.cacheHitRatio.textContent = `${Math.round((stats.cacheHitRatio ?? 0) * 100)}%`;
    const quality = stats.lastQuality;
    if (quality) {
      this.qualitySummary.textContent = `${quality.changedPixelPercent}% pixels changed`;
      this.qualityDetails.textContent = `Sharpness ×${quality.sharpnessGain} · ${stats.lastDetectedMode || "unknown"} mode`;
    }
    this.renderScopes(stats.scopes || {});
  }

  renderScopes(scopes) {
    for (const [name, values] of Object.entries(scopes)) {
      const row = this.document.querySelector(`[data-scope="${name}"]`);
      if (!row) continue;
      const cells = row.querySelectorAll("td");
      [values.seen, values.fixed, values.processing, values.errors, values.cache].forEach((value, index) => {
        cells[index].textContent = String(value ?? 0);
      });
    }
  }

  async setEnabled(enabled) {
    const result = await chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled });
    if (enabled && result?.launch && !result.launch.ok) {
      this.setBackendStatus("Backend start failed", false);
      this.backendStatus.title = result.launch.error || "Native launcher failed.";
    }
  }

  async saveEnhancementSettings() {
    const mode = this.modeSelect.value;
    const enhanceLevel = Number(this.enhanceLevel.value) / 100;
    await chrome.runtime.sendMessage({ type: "SET_ENHANCEMENT", mode, enhanceLevel });
    this.renderEnhancementSettings();
  }

  renderEnhancementSettings() {
    const descriptions = {
      auto: "Detects each image and selects Manga, Artwork, or Photo automatically.",
      manga: "Preserves grayscale while strengthening line art and dialogue text.",
      artwork: "Optimized for colored anime, illustrations, and digital artwork.",
      photo: "Uses the general Real-ESRGAN model for photographic detail.",
    };
    this.enhanceLevelValue.textContent = `${this.enhanceLevel.value}%`;
    this.modeDescription.textContent = descriptions[this.modeSelect.value] || descriptions.auto;
  }

  setBackendStatus(text, isOnline) {
    this.backendStatus.textContent = text;
    this.backendStatus.classList.toggle("status-ok", isOnline);
    this.backendStatus.classList.toggle("status-error", !isOnline);
    this.backendStatus.classList.remove("status-muted");
  }
}

new PopupController(document).start();
