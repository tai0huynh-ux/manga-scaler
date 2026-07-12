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
    this.modeDescription = this.document.getElementById("modeDescription");
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
    this.refresh();
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
      this.setBackendStatus("Backend offline", false);
    }
  }

  async refreshStats() {
    const stats = await chrome.runtime.sendMessage({ type: "GET_STATS" });
    this.enabledToggle.checked = Boolean(stats.enabled);
    this.modeSelect.value = stats.mode || "auto";
    this.enhanceLevel.value = String(Math.round((stats.enhanceLevel ?? 0.35) * 100));
    this.renderEnhancementSettings();
    this.processedCount.textContent = String(stats.processed ?? 0);
    this.cacheHitCount.textContent = String(stats.cacheHits ?? 0);
    this.errorCount.textContent = String(stats.errors ?? 0);
    this.queueSizeCount.textContent = String(stats.queueSize ?? 0);
    this.processingCount.textContent = String(stats.processing ?? 0);
    this.waitingCount.textContent = String(stats.waiting ?? 0);
    this.averageLatency.textContent = `${stats.averageLatencyMs ?? 0} ms`;
    this.cacheHitRatio.textContent = `${Math.round((stats.cacheHitRatio ?? 0) * 100)}%`;
  }

  async setEnabled(enabled) {
    await chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled });
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
