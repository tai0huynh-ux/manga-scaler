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
    this.imageSettingIds = [
      "sizingMode", "resolutionPreset", "screenOrientation",
      "maxOutputWidthEnabled", "maxOutputHeightEnabled", "maxOutputWidth", "maxOutputHeight",
      "minInputWidthEnabled", "minInputHeightEnabled", "maxInputWidthEnabled", "maxInputHeightEnabled",
      "minInputWidth", "minInputHeight", "maxInputWidth", "maxInputHeight",
      "outputQuality", "preprocessingConcurrency", "upscaleConcurrency",
      "aheadProcessingEnabled", "aheadProcessingImageLimit", "prefetchMarginPx",
      "imageSlicingEnabled", "imageSliceMaxWidth", "imageSliceMaxHeight", "performanceBoost",
      "textCleanupEnabled", "textTranslateEnabled", "textSourceLanguage", "textTargetLanguage",
    ];
    this.limitTogglePairs = {
      maxOutputWidthEnabled: "maxOutputWidth",
      maxOutputHeightEnabled: "maxOutputHeight",
      minInputWidthEnabled: "minInputWidth",
      minInputHeightEnabled: "minInputHeight",
      maxInputWidthEnabled: "maxInputWidth",
      maxInputHeightEnabled: "maxInputHeight",
      aheadProcessingEnabled: "aheadProcessingImageLimit",
    };
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
    this.imageSettingIds.forEach((id) => this.document.getElementById(id).addEventListener("change", () => this.saveImageSettings()));
    this.previewOriginal.addEventListener("change", () => {
      chrome.runtime.sendMessage({ type: "SET_PREVIEW_ORIGINAL", enabled: this.previewOriginal.checked });
    });
    this.openDashboard.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const dashboardUrl = new URL(chrome.runtime.getURL("dashboard.html"));
      if (Number.isInteger(tab?.id)) dashboardUrl.searchParams.set("tabId", String(tab.id));
      await chrome.tabs.create({ url: dashboardUrl.toString() });
    });
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
    if (this.document.activeElement !== this.modeSelect) this.modeSelect.value = stats.mode || "auto";
    if (this.document.activeElement !== this.enhanceLevel) {
      this.enhanceLevel.value = String(Math.round((stats.enhanceLevel ?? 0.35) * 100));
    }
    this.processingTimeout.value = String(stats.maxProcessingSeconds ?? 60);
    if (!this.imageSettingIds.includes(this.document.activeElement?.id)) {
      this.imageSettingIds.forEach((id) => {
        const element = this.document.getElementById(id);
        if (element.type === "checkbox") element.checked = Boolean(stats[id]);
        else element.value = String(stats[id] ?? "");
      });
    }
    this.renderSizeSettings();
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

  async saveImageSettings() {
    const value = (id) => this.document.getElementById(id).value;
    const checked = (id) => this.document.getElementById(id).checked;
    this.renderSizeSettings();
    await chrome.runtime.sendMessage({
      type: "SET_IMAGE_LIMITS",
      sizingMode: value("sizingMode"), resolutionPreset: value("resolutionPreset"),
      screenOrientation: value("screenOrientation"),
      maxOutputWidth: Number(value("maxOutputWidth")), maxOutputHeight: Number(value("maxOutputHeight")),
      minInputWidth: Number(value("minInputWidth")), minInputHeight: Number(value("minInputHeight")),
      maxInputWidth: Number(value("maxInputWidth")), maxInputHeight: Number(value("maxInputHeight")),
      maxOutputWidthEnabled: checked("maxOutputWidthEnabled"),
      maxOutputHeightEnabled: checked("maxOutputHeightEnabled"),
      minInputWidthEnabled: checked("minInputWidthEnabled"),
      minInputHeightEnabled: checked("minInputHeightEnabled"),
      maxInputWidthEnabled: checked("maxInputWidthEnabled"),
      maxInputHeightEnabled: checked("maxInputHeightEnabled"),
      outputQuality: Number(value("outputQuality")),
      preprocessingConcurrency: Number(value("preprocessingConcurrency")),
      upscaleConcurrency: Number(value("upscaleConcurrency")),
      aheadProcessingEnabled: checked("aheadProcessingEnabled"),
      aheadProcessingImageLimit: Number(value("aheadProcessingImageLimit")),
      prefetchMarginPx: Number(value("prefetchMarginPx")),
      imageSlicingEnabled: checked("imageSlicingEnabled"),
      imageSliceMaxWidth: Number(value("imageSliceMaxWidth")),
      imageSliceMaxHeight: Number(value("imageSliceMaxHeight")),
      performanceBoost: this.document.getElementById("performanceBoost").checked,
      textCleanupEnabled: checked("textCleanupEnabled"),
      textTranslateEnabled: checked("textTranslateEnabled"),
      textSourceLanguage: value("textSourceLanguage"),
      textTargetLanguage: value("textTargetLanguage"),
    });
  }

  renderSizeSettings() {
    const mode = this.document.getElementById("sizingMode").value;
    this.document.getElementById("autoSizePanel").hidden = mode !== "auto";
    this.document.getElementById("pixelSizePanel").hidden = mode !== "pixel";
    this.document.getElementById("screenSizePanel").hidden = mode !== "screen";
    Object.entries(this.limitTogglePairs).forEach(([toggleId, inputId]) => {
      this.document.getElementById(inputId).disabled = !this.document.getElementById(toggleId).checked;
    });
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
