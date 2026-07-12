const trackedImages = new Map();
const processedImageUrls = new Set();

/**
 * Extracts stable image metadata from normal images and picture elements.
 */
class ImageProvider {
  constructor(minDimensionPx) {
    this.minDimensionPx = minDimensionPx;
  }

  canProcess(image) {
    const width = image.naturalWidth || image.width || image.clientWidth;
    const height = image.naturalHeight || image.height || image.clientHeight;
    return width >= this.minDimensionPx || height >= this.minDimensionPx;
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
    const stored = await chrome.storage.local.get({ enabled: true });
    this.enabled = stored.enabled;
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
    if (!metadata.imageUrl || processedImageUrls.has(metadata.imageUrl) || !this.imageProvider.canProcess(image)) {
      return;
    }

    const existing = this.findByImage(image);
    const imageId = existing?.imageId || `ai-manga-image-${Date.now()}-${this.sequence++}`;
    processedImageUrls.add(metadata.imageUrl);
    trackedImages.set(imageId, {
      imageId,
      image,
      metadata,
      state: "waiting",
    });

    const imageData = await this.readDisplayedImage(metadata.imageUrl);
    if (!trackedImages.has(imageId)) {
      return;
    }
    chrome.runtime.sendMessage({
      type: "ENQUEUE_IMAGE",
      imageId,
      imageUrl: metadata.imageUrl,
      imageData,
      viewportDistance: this.viewportDistance(image),
    });
  }

  async readDisplayedImage(imageUrl) {
    try {
      const response = await fetch(imageUrl, {
        cache: "force-cache",
        credentials: "include",
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
  imageProvider: new ImageProvider(AI_MANGA_UPSCALER_CONFIG.images.minDimensionPx),
  renderer,
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.enabled) {
    viewportProvider.setEnabled(Boolean(changes.enabled.newValue));
  }
  if (areaName === "local" && (changes.mode || changes.enhanceLevel)) {
    viewportProvider.reprocessVisibleImages();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "UPSCALE_COMPLETE") {
    viewportProvider.complete(message);
  }

  if (message.type === "UPSCALE_FAILED") {
    viewportProvider.fail(message.imageId);
  }
});

viewportProvider.start();
