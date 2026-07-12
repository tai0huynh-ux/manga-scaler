/**
 * Popup controller that renders backend health, counters, and enable state.
 */
class PopupController {
  constructor(documentRef) {
    this.document = documentRef;
    this.backendStatus = this.document.getElementById("backendStatus");
    this.enabledToggle = this.document.getElementById("enabledToggle");
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

  setBackendStatus(text, isOnline) {
    this.backendStatus.textContent = text;
    this.backendStatus.classList.toggle("status-ok", isOnline);
    this.backendStatus.classList.toggle("status-error", !isOnline);
    this.backendStatus.classList.remove("status-muted");
  }
}

new PopupController(document).start();
