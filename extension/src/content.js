const trackedImages = new Map();
const processedImageUrls = new Set();

/**
 * Extracts stable image metadata from normal images and picture elements.
 */
class ImageProvider {
  constructor(limits) {
    this.updateLimits(limits);
  }

  updateLimits(limits) {
    this.limits = limits;
  }

  canProcess(image) {
    const width = image.naturalWidth || image.width || image.clientWidth;
    const height = image.naturalHeight || image.height || image.clientHeight;
    return width >= this.limits.minInputWidth && height >= this.limits.minInputHeight &&
      width <= this.limits.maxInputWidth && height <= this.limits.maxInputHeight;
  }

  read(image) {
    const originalSource = image.dataset.aiMangaOriginalSrc;
    const stableUrl = originalSource ? new URL(originalSource, document.baseURI).href : image.currentSrc || image.src;
    return {
      imageUrl: stableUrl,
      src: originalSource || image.getAttribute("src"),
      srcset: image.dataset.aiMangaOriginalSrcset || image.getAttribute("srcset"),
      sizes: image.dataset.aiMangaOriginalSizes || image.getAttribute("sizes"),
      width: image.width || image.clientWidth,
      height: image.height || image.clientHeight,
      pictureSources: this.readPictureSources(image),
    };
  }

  readPictureSources(image) {
    const picture = image.closest("picture");
    if (!picture) {
      return [];
    }

    return [...picture.querySelectorAll("source")].map((source) => ({
      source,
      srcset: source.getAttribute("srcset"),
      sizes: source.getAttribute("sizes"),
      media: source.getAttribute("media"),
      type: source.getAttribute("type"),
    }));
  }
}

/**
 * Replaces an image with a Blob URL while preserving layout and original metadata.
 */
class Renderer {
  constructor() {
    this.activeObjectUrls = new WeakMap();
    this.installStyles();
  }

  async render(image, payload) {
    if (!image || !payload?.imageBase64) {
      return;
    }

    const metadata = trackedImages.get(payload.imageId)?.metadata;
    if (!metadata) {
      return;
    }

    this.freezeLayout(image, metadata);
    this.preserveResponsiveAttributes(image, metadata);

    const blob = new Blob([this.base64ToUint8Array(payload.imageBase64)], {
      type: payload.contentType || "image/png",
    });
    const objectUrl = URL.createObjectURL(blob);
    const previousObjectUrl = this.activeObjectUrls.get(image);
    this.activeObjectUrls.set(image, objectUrl);

    await this.fadeOut(image);
    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    image.src = objectUrl;
    await this.waitForImageLoad(image);
    image.classList.add("ai-manga-upscaler-ready");

    if (previousObjectUrl) {
      URL.revokeObjectURL(previousObjectUrl);
    }
  }

  freezeLayout(image, metadata) {
    if (metadata.width > 0) {
      image.style.width = `${metadata.width}px`;
    }
    if (metadata.height > 0) {
      image.style.height = `${metadata.height}px`;
    }
  }

  setPreviewOriginal(enabled) {
    document.querySelectorAll("img[data-ai-manga-original-src]").forEach((image) => {
      const enhancedUrl = this.activeObjectUrls.get(image);
      if (enabled) {
        image.src = image.dataset.aiMangaOriginalSrc;
      } else if (enhancedUrl) {
        image.src = enhancedUrl;
      }
    });
  }

  preserveResponsiveAttributes(image, metadata) {
    image.dataset.aiMangaOriginalSrc = metadata.src || "";
    image.dataset.aiMangaOriginalSrcset = metadata.srcset || "";
    image.dataset.aiMangaOriginalSizes = metadata.sizes || "";

    metadata.pictureSources.forEach(({ source, srcset, sizes }) => {
      source.dataset.aiMangaOriginalSrcset = srcset || "";
      source.dataset.aiMangaOriginalSizes = sizes || "";
      source.removeAttribute("srcset");
      source.removeAttribute("sizes");
    });
  }

  fadeOut(image) {
    return new Promise((resolve) => {
      image.classList.add("ai-manga-upscaler-fading");
      setTimeout(resolve, AI_MANGA_UPSCALER_CONFIG.render.fadeMs);
    });
  }

  waitForImageLoad(image) {
    if (image.complete) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }

  installStyles() {
    if (document.getElementById("ai-manga-upscaler-styles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "ai-manga-upscaler-styles";
    style.textContent = `
      img.ai-manga-upscaler-fading {
        opacity: 0.2 !important;
        transition: opacity ${AI_MANGA_UPSCALER_CONFIG.render.fadeMs}ms ease !important;
      }

      img.ai-manga-upscaler-ready {
        opacity: 1 !important;
      }

      .ai-enhancer-blacklist-button {
        position: absolute !important;
        z-index: 2147483647 !important;
        padding: 4px 7px !important;
        border: 1px solid #fff8 !important;
        border-radius: 6px !important;
        background: #9b271ee8 !important;
        color: #fff !important;
        font: 600 11px/1.2 system-ui, sans-serif !important;
        cursor: pointer !important;
        opacity: .78 !important;
      }

      .ai-enhancer-blacklist-button:hover { opacity: 1 !important; }
    `;
    document.documentElement.appendChild(style);
  }

  base64ToUint8Array(base64Value) {
    const binary = atob(base64Value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
}

/**
 * Observes candidate images and only schedules work as they approach the viewport.
 */
class ViewportImageProvider {
  constructor({ imageProvider, renderer }) {
    this.imageProvider = imageProvider;
    this.renderer = renderer;
    this.enabled = true;
    this.sequence = 0;
    this.blacklist = new Set();
    this.blacklistButtons = new WeakMap();
    this.preprocessingActive = 0;
    this.preprocessingWaiters = [];
    this.preprocessingConcurrency = AI_MANGA_UPSCALER_CONFIG.queue.preprocessingConcurrency;
    this.mutationObserver = new MutationObserver((mutations) => this.handleMutations(mutations));
    this.intersectionObserver = new IntersectionObserver(
      (entries) => this.handleIntersections(entries),
      {
        root: null,
        rootMargin: `${AI_MANGA_UPSCALER_CONFIG.images.prefetchMarginPx}px 0px`,
        threshold: [0, 0.01],
      },
    );
    this.onScroll = this.throttle(() => this.refreshPriorities(), 250);
  }

  async start() {
    const stored = await chrome.storage.local.get({
      enabled: true, blacklistRules: [],
      minInputWidth: AI_MANGA_UPSCALER_CONFIG.images.minWidthPx,
      minInputHeight: AI_MANGA_UPSCALER_CONFIG.images.minHeightPx,
      maxInputWidth: AI_MANGA_UPSCALER_CONFIG.images.maxWidthPx,
      maxInputHeight: AI_MANGA_UPSCALER_CONFIG.images.maxHeightPx,
      preprocessingConcurrency: AI_MANGA_UPSCALER_CONFIG.queue.preprocessingConcurrency,
    });
    this.enabled = stored.enabled;
    this.blacklist = new Set(stored.blacklistRules || []);
    this.imageProvider.updateLimits(stored);
    this.preprocessingConcurrency = Number(stored.preprocessingConcurrency) || AI_MANGA_UPSCALER_CONFIG.queue.preprocessingConcurrency;
    this.observeExistingImages();
    this.mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onScroll, { passive: true });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.observeExistingImages();
      this.refreshPriorities();
    } else {
      trackedImages.forEach((entry) => this.cancel(entry));
    }
  }

  reprocessVisibleImages() {
    processedImageUrls.clear();
    document.querySelectorAll("img").forEach((image) => {
      if (this.viewportDistance(image) <= AI_MANGA_UPSCALER_CONFIG.images.prefetchMarginPx) {
        this.schedule(image);
      }
    });
  }

  observeExistingImages() {
    document.querySelectorAll("img").forEach((image) => this.observeImage(image));
  }

  handleMutations(mutations) {
    if (!this.enabled) {
      return;
    }

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        this.observeNode(node);
      }
    }
  }

  observeNode(node) {
    if (node instanceof HTMLImageElement) {
      this.observeImage(node);
      return;
    }

    if (node instanceof HTMLElement) {
      node.querySelectorAll("img").forEach((image) => this.observeImage(image));
    }
  }

  observeImage(image) {
    if (image.dataset.aiMangaUpscalerObserved === "true") {
      return;
    }

    image.dataset.aiMangaUpscalerObserved = "true";
    const reportSeen = () => {
      if (image.dataset.aiEnhancerSeen !== "true" && this.imageProvider.canProcess(image)) {
        const imageId = image.dataset.aiEnhancerImageId || `ai-image-${Date.now()}-${this.sequence++}`;
        image.dataset.aiEnhancerImageId = imageId;
        image.dataset.aiEnhancerSeen = "true";
        const metadata = this.imageProvider.read(image);
        if (this.isBlacklisted(metadata.imageUrl)) return;
        this.addBlacklistButton(image, metadata.imageUrl);
        chrome.runtime.sendMessage({
          type: "IMAGE_SEEN",
          imageId,
          imageUrl: metadata.imageUrl,
          width: metadata.width,
          height: metadata.height,
        });
      }
    };
    reportSeen();
    image.addEventListener("load", reportSeen, { once: true });
    this.intersectionObserver.observe(image);
  }

  handleIntersections(entries) {
    if (!this.enabled) {
      return;
    }

    for (const entry of entries) {
      const image = entry.target;
      if (!(image instanceof HTMLImageElement)) {
        continue;
      }

      if (entry.isIntersecting) {
        this.schedule(image);
      } else {
        const existing = this.findByImage(image);
        if (existing && this.viewportDistance(image) > AI_MANGA_UPSCALER_CONFIG.images.cancelDistancePx) {
          this.cancel(existing);
        }
      }
    }
  }

  async schedule(image) {
    const metadata = this.imageProvider.read(image);
    if (!metadata.imageUrl || this.isBlacklisted(metadata.imageUrl) || processedImageUrls.has(metadata.imageUrl) || !this.imageProvider.canProcess(image)) {
      return;
    }

    const existing = this.findByImage(image);
    const imageId = existing?.imageId || image.dataset.aiEnhancerImageId || `ai-image-${Date.now()}-${this.sequence++}`;
    image.dataset.aiEnhancerImageId = imageId;
    processedImageUrls.add(metadata.imageUrl);
    trackedImages.set(imageId, {
      imageId,
      image,
      metadata,
      state: "waiting",
    });
    chrome.runtime.sendMessage({ type: "PREPROCESSING_STARTED", imageId });

    await this.acquirePreprocessingSlot();
    let imageData = null;
    try {
      if (!trackedImages.has(imageId)) return;
      imageData = await this.readDisplayedImage(metadata.imageUrl);
    } finally {
      this.releasePreprocessingSlot();
    }
    if (!trackedImages.has(imageId)) return;
    chrome.runtime.sendMessage({
      type: "ENQUEUE_IMAGE",
      imageId,
      imageUrl: metadata.imageUrl,
      imageData,
      viewportDistance: this.viewportDistance(image),
      displayMetrics: this.displayMetrics(image),
    });
  }

  acquirePreprocessingSlot() {
    if (this.preprocessingActive < this.preprocessingConcurrency) {
      this.preprocessingActive += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.preprocessingWaiters.push(resolve));
  }

  releasePreprocessingSlot() {
    const next = this.preprocessingWaiters.shift();
    if (next) next();
    else this.preprocessingActive = Math.max(0, this.preprocessingActive - 1);
  }

  displayMetrics(image) {
    const rect = image.getBoundingClientRect();
    return {
      sourceWidth: image.naturalWidth || image.width || 0,
      sourceHeight: image.naturalHeight || image.height || 0,
      renderedWidth: Math.max(rect.width, image.clientWidth || 0),
      renderedHeight: Math.max(rect.height, image.clientHeight || 0),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      screenWidth: window.screen?.availWidth || window.innerWidth,
      screenHeight: window.screen?.availHeight || window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      left: rect.left,
      top: rect.top,
      rightMargin: window.innerWidth - rect.right,
      bottomMargin: window.innerHeight - rect.bottom,
    };
  }

  normalizeBlacklistUrl(imageUrl) {
    try {
      const url = new URL(imageUrl, document.baseURI);
      return `${url.origin}${url.pathname}`;
    } catch {
      return imageUrl;
    }
  }

  isBlacklisted(imageUrl) {
    return this.blacklist.has(this.normalizeBlacklistUrl(imageUrl));
  }

  addBlacklistButton(image, imageUrl) {
    if (this.blacklistButtons.has(image)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-enhancer-blacklist-button";
    button.textContent = "Block AI";
    button.title = "Never upscale this image URL again";
    const position = () => {
      const rect = image.getBoundingClientRect();
      button.style.left = `${Math.max(4, rect.right + window.scrollX - button.offsetWidth)}px`;
      button.style.top = `${Math.max(4, rect.top + window.scrollY + 4)}px`;
    };
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rule = this.normalizeBlacklistUrl(imageUrl);
      this.blacklist.add(rule);
      const stored = await chrome.storage.local.get({ blacklistRules: [] });
      await chrome.storage.local.set({ blacklistRules: [...new Set([...(stored.blacklistRules || []), rule])] });
      const tracked = this.findByImage(image);
      if (tracked) this.cancel(tracked);
      button.remove();
    });
    document.body.appendChild(button);
    this.blacklistButtons.set(image, button);
    position();
    window.addEventListener("scroll", position, { passive: true });
    window.addEventListener("resize", position, { passive: true });
  }

  async readDisplayedImage(imageUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_MANGA_UPSCALER_CONFIG.images.browserReadTimeoutMs);
    try {
      const response = await fetch(imageUrl, {
        cache: "force-cache",
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }
      const buffer = await response.arrayBuffer();
      if (!this.isImageBuffer(buffer)) {
        return null;
      }
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      let binary = "";
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      }
      return btoa(binary);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  isImageBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    return (
      (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
      (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ||
      (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) ||
      (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) ||
      (bytes.length > 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)
    );
  }

  refreshPriorities() {
    if (!this.enabled) {
      return;
    }

    trackedImages.forEach((entry) => {
      const distance = this.viewportDistance(entry.image);
      if (distance > AI_MANGA_UPSCALER_CONFIG.images.cancelDistancePx) {
        this.cancel(entry);
        return;
      }

      chrome.runtime.sendMessage({
        type: "UPDATE_PRIORITY",
        imageId: entry.imageId,
        viewportDistance: distance,
      });
    });
  }

  async complete(message) {
    const entry = trackedImages.get(message.imageId);
    if (!entry) {
      return;
    }

    entry.state = "processing";
    await this.renderer.render(entry.image, message);
    trackedImages.delete(message.imageId);
  }

  fail(imageId) {
    const entry = trackedImages.get(imageId);
    if (entry) {
      processedImageUrls.delete(entry.metadata.imageUrl);
    }
    trackedImages.delete(imageId);
  }

  cancel(entry) {
    chrome.runtime.sendMessage({
      type: "CANCEL_IMAGE",
      imageId: entry.imageId,
    });
    processedImageUrls.delete(entry.metadata.imageUrl);
    trackedImages.delete(entry.imageId);
  }

  findByImage(image) {
    return [...trackedImages.values()].find((entry) => entry.image === image) || null;
  }

  viewportDistance(image) {
    const rect = image.getBoundingClientRect();
    if (rect.bottom >= 0 && rect.top <= window.innerHeight) {
      return 0;
    }
    if (rect.top > window.innerHeight) {
      return rect.top - window.innerHeight;
    }
    return Math.abs(rect.bottom);
  }

  throttle(callback, waitMs) {
    let lastRun = 0;
    let timeoutId = null;
    return () => {
      const now = Date.now();
      const remaining = waitMs - (now - lastRun);
      if (remaining <= 0) {
        lastRun = now;
        callback();
        return;
      }

      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        lastRun = Date.now();
        callback();
      }, remaining);
    };
  }
}

const renderer = new Renderer();
const viewportProvider = new ViewportImageProvider({
  imageProvider: new ImageProvider({
    minInputWidth: AI_MANGA_UPSCALER_CONFIG.images.minWidthPx,
    minInputHeight: AI_MANGA_UPSCALER_CONFIG.images.minHeightPx,
    maxInputWidth: AI_MANGA_UPSCALER_CONFIG.images.maxWidthPx,
    maxInputHeight: AI_MANGA_UPSCALER_CONFIG.images.maxHeightPx,
  }),
  renderer,
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.enabled) {
    viewportProvider.setEnabled(Boolean(changes.enabled.newValue));
  }
  if (areaName === "local" && (changes.mode || changes.enhanceLevel)) {
    viewportProvider.reprocessVisibleImages();
  }
  if (areaName === "local" && changes.blacklistRules) {
    viewportProvider.blacklist = new Set(changes.blacklistRules.newValue || []);
  }
  if (areaName === "local" && (changes.minInputWidth || changes.minInputHeight || changes.maxInputWidth || changes.maxInputHeight)) {
    chrome.storage.local.get({
      minInputWidth: AI_MANGA_UPSCALER_CONFIG.images.minWidthPx,
      minInputHeight: AI_MANGA_UPSCALER_CONFIG.images.minHeightPx,
      maxInputWidth: AI_MANGA_UPSCALER_CONFIG.images.maxWidthPx,
      maxInputHeight: AI_MANGA_UPSCALER_CONFIG.images.maxHeightPx,
    }).then((limits) => {
      viewportProvider.imageProvider.updateLimits(limits);
      viewportProvider.reprocessVisibleImages();
    });
  }
  if (areaName === "local" && changes.preprocessingConcurrency) {
    viewportProvider.preprocessingConcurrency = Number(changes.preprocessingConcurrency.newValue) || AI_MANGA_UPSCALER_CONFIG.queue.preprocessingConcurrency;
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "AI_ENHANCER_PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "UPSCALE_COMPLETE") {
    viewportProvider.complete(message);
  }

  if (message.type === "UPSCALE_FAILED") {
    viewportProvider.fail(message.imageId);
  }

  if (message.type === "SET_PREVIEW_ORIGINAL") {
    renderer.setPreviewOriginal(Boolean(message.enabled));
  }
});

viewportProvider.start();
