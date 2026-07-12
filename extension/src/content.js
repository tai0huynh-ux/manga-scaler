const trackedImages = new Map();
const trackedImageKeys = new Map();
const completedImageKeys = new Set();

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
    return (
      (this.limits.minInputWidthEnabled === false || width >= this.limits.minInputWidth) &&
      (this.limits.minInputHeightEnabled === false || height >= this.limits.minInputHeight) &&
      (this.limits.maxInputWidthEnabled === false || width <= this.limits.maxInputWidth) &&
      (this.limits.maxInputHeightEnabled === false || height <= this.limits.maxInputHeight)
    );
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

    if (typeof previousObjectUrl === "string") {
      URL.revokeObjectURL(previousObjectUrl);
    }
  }

  installRawSlices(image, metadata, segments) {
    const wrapper = document.createElement("div");
    wrapper.className = "ai-enhancer-slice-wrapper";
    if (metadata.width > 0) {
      wrapper.style.width = `${metadata.width}px`;
      wrapper.style.maxWidth = "100%";
    }
    image.parentNode.insertBefore(wrapper, image);
    image.style.display = "none";
    image.dataset.aiEnhancerSliced = "true";

    return segments.map((segment) => {
      const raw = new Image();
      raw.className = "ai-enhancer-raw-slice";
      raw.dataset.aiEnhancerRawSlice = "true";
      raw.alt = image.alt || "";
      raw.decoding = "async";
      raw.src = segment.objectUrl;
      raw.style.width = metadata.width > 0 ? `${metadata.width}px` : "100%";
      raw.style.height = `${segment.renderedHeight}px`;
      raw.style.display = "block";
      raw.style.objectFit = "fill";
      wrapper.appendChild(raw);
      this.activeObjectUrls.set(raw, segment.objectUrl);
      return raw;
    });
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
      } else if (typeof enhancedUrl === "string") {
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

      .ai-enhancer-slice-wrapper {
        display: block !important;
      }

      .ai-enhancer-raw-slice {
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
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
    this.blacklist = new Set();
    this.preprocessingActive = 0;
    this.preprocessingWaiters = [];
    this.preprocessingConcurrency = AI_MANGA_UPSCALER_CONFIG.queue.preprocessingConcurrency;
    this.imageSlicingEnabled = AI_MANGA_UPSCALER_CONFIG.images.slicingEnabled;
    this.imageSliceMaxHeight = AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx;
    this.pageGeneration = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.pageOrder = 0;
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
      minInputWidthEnabled: true,
      minInputHeightEnabled: true,
      maxInputWidthEnabled: true,
      maxInputHeightEnabled: true,
      imageSlicingEnabled: AI_MANGA_UPSCALER_CONFIG.images.slicingEnabled,
      imageSliceMaxHeight: AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx,
      preprocessingConcurrency: AI_MANGA_UPSCALER_CONFIG.queue.preprocessingConcurrency,
    });
    this.enabled = stored.enabled;
    this.blacklist = new Set(stored.blacklistRules || []);
    this.imageProvider.updateLimits(stored);
    this.imageSlicingEnabled = stored.imageSlicingEnabled !== false;
    this.imageSliceMaxHeight = Number(stored.imageSliceMaxHeight) || AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx;
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
    trackedImageKeys.clear();
    completedImageKeys.clear();
    document.querySelectorAll("img").forEach((image) => this.schedule(image));
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
      for (const node of mutation.removedNodes) {
        this.cleanupRemovedNode(node);
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
    if (image.dataset.aiEnhancerRawSlice === "true" || image.dataset.aiEnhancerSliced === "true") {
      return;
    }
    if (image.dataset.aiMangaUpscalerObserved === "true") {
      return;
    }

    image.dataset.aiMangaUpscalerObserved = "true";
    const reportSeen = () => {
      if (image.dataset.aiMangaOriginalSrc || image.dataset.aiEnhancerSliced === "true") {
        return;
      }
      if (!this.imageProvider.canProcess(image)) {
        return;
      }
      const metadata = this.imageProvider.read(image);
      if (this.isBlacklisted(metadata.imageUrl)) return;
      const imageKey = this.imageKey(metadata, image);
      if (image.dataset.aiEnhancerSeen === "true" && image.dataset.aiEnhancerKey === imageKey) {
        return;
      }
      if (image.dataset.aiEnhancerImageId && image.dataset.aiEnhancerKey && image.dataset.aiEnhancerKey !== imageKey) {
        const oldEntry = trackedImages.get(image.dataset.aiEnhancerImageId);
        if (oldEntry) this.cancel(oldEntry);
        trackedImageKeys.delete(image.dataset.aiEnhancerKey);
      }
      const existing = trackedImageKeys.get(imageKey);
      if (existing && existing.image !== image && document.documentElement.contains(existing.image)) {
        image.dataset.aiEnhancerSeen = "true";
        image.dataset.aiEnhancerImageId = existing.imageId;
        image.dataset.aiEnhancerKey = imageKey;
        return;
      }
      const imageId = existing?.imageId || this.createImageId(imageKey);
      image.dataset.aiEnhancerImageId = imageId;
      image.dataset.aiEnhancerPageOrder = image.dataset.aiEnhancerPageOrder || String(this.pageOrder++);
      image.dataset.aiEnhancerKey = imageKey;
      image.dataset.aiEnhancerSeen = "true";
      chrome.runtime.sendMessage({
        type: "IMAGE_SEEN",
        imageId,
        imageUrl: metadata.imageUrl,
        width: metadata.width,
        height: metadata.height,
        pageOrder: Number(image.dataset.aiEnhancerPageOrder) || 0,
      });
      this.schedule(image);
    };
    reportSeen();
    image.addEventListener("load", reportSeen);
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
        this.updateImagePriority(image);
      } else {
        const existing = this.findByImage(image);
        if (existing) this.updateImagePriority(image);
      }
    }
  }

  async schedule(image, allowSegments = true) {
    if (image.dataset.aiEnhancerRawSlice === "true" || image.dataset.aiEnhancerSliced === "true") {
      return;
    }
    const metadata = this.imageProvider.read(image);
    if (!metadata.imageUrl || this.isBlacklisted(metadata.imageUrl) || !this.imageProvider.canProcess(image)) {
      return;
    }

    const existing = this.findByImage(image);
    const baseKey = this.imageKey(metadata, image);
    const existingByKey = trackedImageKeys.get(baseKey);
    if (existingByKey && existingByKey.image !== image && document.documentElement.contains(existingByKey.image)) {
      return;
    }
    if (completedImageKeys.has(baseKey)) {
      return;
    }
    const imageId = existing?.imageId || existingByKey?.imageId || image.dataset.aiEnhancerImageId || this.createImageId(baseKey);
    image.dataset.aiEnhancerImageId = imageId;
    image.dataset.aiEnhancerKey = baseKey;
    image.dataset.aiEnhancerPageOrder = image.dataset.aiEnhancerPageOrder || String(this.pageOrder++);
    const pageOrder = Number(image.dataset.aiEnhancerPageOrder) || 0;
    trackedImageKeys.set(baseKey, {
      imageId,
      image,
      metadata,
      state: "preprocessing",
      baseKey,
      isSegment: false,
      pageOrder,
    });
    if (allowSegments && this.shouldSliceImage(image)) {
      await this.scheduleSegments(image, metadata, imageId, baseKey);
      return;
    }

    trackedImages.set(imageId, {
      imageId,
      image,
      metadata,
      state: "waiting",
      baseKey,
      isSegment: false,
      pageOrder,
    });
    chrome.runtime.sendMessage({ type: "PREPROCESSING_STARTED", imageId, pageOrder });

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
      cacheVariant: "full",
      pageOrder,
      viewportDistance: this.viewportDistance(image),
      displayMetrics: this.displayMetrics(image),
    });
  }

  async scheduleSegments(image, metadata, imageId, baseKey) {
    chrome.runtime.sendMessage({ type: "PREPROCESSING_STARTED", imageId, pageOrder: Number(image.dataset.aiEnhancerPageOrder) || 0 });
    await this.acquirePreprocessingSlot();
    let segments = [];
    try {
      if (!trackedImageKeys.has(baseKey)) return;
      const imageData = await this.readDisplayedImage(metadata.imageUrl);
      if (!imageData) {
        trackedImageKeys.delete(baseKey);
        await this.schedule(image, false);
        return;
      }
      segments = await this.cropImageSegments(imageData, image);
    } finally {
      this.releasePreprocessingSlot();
    }

    if (!segments.length) {
      trackedImageKeys.delete(baseKey);
      await this.schedule(image, false);
      return;
    }

    const rawImages = this.renderer.installRawSlices(image, metadata, segments);
    await Promise.all(rawImages.map((rawImage) => this.renderer.waitForImageLoad(rawImage)));
    for (const segment of segments) {
      const segmentId = `${imageId}-seg-${segment.index}`;
      const rawImage = rawImages[segment.index];
      const segmentKey = `${baseKey}#segment:${segment.index}:${segment.sourceY}:${segment.sourceHeight}`;
      const segmentOrder = (Number(image.dataset.aiEnhancerPageOrder) || 0) + (segment.index / 1000);
      const segmentMetadata = {
        ...metadata,
        imageUrl: `${metadata.imageUrl}#ai-segment-${segment.index}`,
        src: segment.objectUrl,
        srcset: null,
        sizes: null,
        width: metadata.width,
        height: segment.renderedHeight,
        pictureSources: [],
      };
      trackedImageKeys.set(segmentKey, {
        imageId: segmentId,
        image: rawImage,
        metadata: segmentMetadata,
        state: "waiting",
        baseKey: segmentKey,
        parentKey: baseKey,
        isSegment: true,
        pageOrder: segmentOrder,
      });
      trackedImages.set(segmentId, {
        imageId: segmentId,
        image: rawImage,
        metadata: segmentMetadata,
        state: "waiting",
        baseKey: segmentKey,
        parentKey: baseKey,
        isSegment: true,
        pageOrder: segmentOrder,
      });
      chrome.runtime.sendMessage({
        type: "PREPROCESSING_STARTED",
        imageId: segmentId,
        pageOrder: segmentOrder,
      });
      chrome.runtime.sendMessage({
        type: "ENQUEUE_IMAGE",
        imageId: segmentId,
        imageUrl: metadata.imageUrl,
        imageData: segment.imageData,
        cacheVariant: `segment-${segment.index}-${segment.sourceY}-${segment.sourceHeight}`,
        pageOrder: segmentOrder,
        viewportDistance: this.viewportDistance(rawImage) + segment.index,
        displayMetrics: {
          ...this.displayMetrics(rawImage),
          sourceHeight: segment.sourceHeight,
          renderedHeight: segment.renderedHeight,
        },
      });
    }
  }

  shouldSliceImage(image) {
    if (!this.imageSlicingEnabled) return false;
    const sourceHeight = image.naturalHeight || 0;
    const renderedHeight = image.getBoundingClientRect().height || image.clientHeight || 0;
    return sourceHeight > this.imageSliceMaxHeight || renderedHeight > window.innerHeight * 1.8;
  }

  async cropImageSegments(imageData, image) {
    const source = await this.decodeBase64Image(imageData);
    const renderedHeight = image.getBoundingClientRect().height || image.clientHeight || source.height;
    const sourcePerRenderedPixel = source.height / Math.max(renderedHeight, 1);
    const screenSourceHeight = Math.round((window.innerHeight || 900) * 1.25 * sourcePerRenderedPixel);
    const segmentSourceHeight = Math.min(Math.max(screenSourceHeight, 512), this.imageSliceMaxHeight);
    const renderedPerSourcePixel = renderedHeight / source.height;
    const segments = [];
    for (let sourceY = 0, index = 0; sourceY < source.height; sourceY += segmentSourceHeight, index += 1) {
      const sourceHeight = Math.min(segmentSourceHeight, source.height - sourceY);
      const canvas = document.createElement("canvas");
      canvas.width = source.width;
      canvas.height = sourceHeight;
      const context = canvas.getContext("2d", { alpha: false });
      context.drawImage(source, 0, sourceY, source.width, sourceHeight, 0, 0, source.width, sourceHeight);
      segments.push({
        index,
        sourceY,
        sourceHeight,
        renderedTop: sourceY * renderedPerSourcePixel,
        renderedHeight: sourceHeight * renderedPerSourcePixel,
        ...(await this.canvasToSegmentPayload(canvas)),
      });
    }
    return segments;
  }

  decodeBase64Image(imageData) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to decode displayed image for segmentation."));
      image.src = `data:${this.detectImageMime(imageData)};base64,${imageData}`;
    });
  }

  detectImageMime(imageData) {
    if (imageData.startsWith("/9j/")) return "image/jpeg";
    if (imageData.startsWith("iVBOR")) return "image/png";
    if (imageData.startsWith("UklGR")) return "image/webp";
    if (imageData.startsWith("R0lG")) return "image/gif";
    return "image/png";
  }

  canvasToSegmentPayload(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Unable to encode image segment."));
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        const reader = new FileReader();
        reader.onload = () => resolve({
          objectUrl,
          imageData: String(reader.result).split(",", 2)[1] || "",
        });
        reader.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("Unable to read image segment."));
        };
        reader.readAsDataURL(blob);
      }, "image/png");
    });
  }

  processingKey(imageUrl) {
    try {
      const url = new URL(imageUrl, document.baseURI);
      const segment = url.hash.startsWith("#ai-segment-") ? url.hash : "";
      return `${url.origin}${url.pathname}${segment}`;
    } catch {
      return imageUrl;
    }
  }

  imageKey(metadata, image) {
    const normalizedUrl = this.processingKey(metadata.imageUrl);
    const rect = image.getBoundingClientRect();
    const width = Math.round(metadata.width || rect.width || image.naturalWidth || 0);
    const height = Math.round(metadata.height || rect.height || image.naturalHeight || 0);
    const sourceWidth = image.naturalWidth || width;
    const sourceHeight = image.naturalHeight || height;
    return `${this.pageGeneration}|${normalizedUrl}|${sourceWidth}x${sourceHeight}|render:${width}x${height}`;
  }

  createImageId(imageKey) {
    let hash = 0;
    for (let index = 0; index < imageKey.length; index += 1) {
      hash = ((hash << 5) - hash + imageKey.charCodeAt(index)) | 0;
    }
    return `ai-image-${Math.abs(hash).toString(36)}-${this.sequence++}`;
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
      this.updateImagePriority(entry.image, entry.imageId);
    });
  }

  updateImagePriority(image, imageId = null) {
    const targetId = imageId || image.dataset.aiEnhancerImageId;
    if (!targetId) return;
    chrome.runtime.sendMessage({
      type: "UPDATE_PRIORITY",
      imageId: targetId,
      viewportDistance: this.viewportDistance(image),
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
    if (entry.baseKey) {
      trackedImageKeys.delete(entry.baseKey);
      completedImageKeys.add(entry.baseKey);
    }
  }

  fail(imageId, permanent = false) {
    const entry = trackedImages.get(imageId);
    if (entry && !permanent) {
      trackedImageKeys.delete(entry.baseKey || this.processingKey(entry.metadata.imageUrl));
    }
    if (entry && permanent && entry.baseKey) completedImageKeys.add(entry.baseKey);
    trackedImages.delete(imageId);
  }

  cancel(entry) {
    chrome.runtime.sendMessage({
      type: "CANCEL_IMAGE",
      imageId: entry.imageId,
    });
    trackedImageKeys.delete(entry.baseKey || this.processingKey(entry.metadata.imageUrl));
    trackedImages.delete(entry.imageId);
  }

  cleanupRemovedNode(node) {
    if (!(node instanceof Node)) return;
    const removedImages = [];
    if (node instanceof HTMLImageElement) removedImages.push(node);
    if (node instanceof HTMLElement) {
      removedImages.push(...node.querySelectorAll("img"));
    }
    for (const image of removedImages) {
      const entry = this.findByImage(image);
      if (entry) {
        this.cancel(entry);
      }
      for (const [key, keyedEntry] of trackedImageKeys.entries()) {
        if (keyedEntry.image === image) {
          chrome.runtime.sendMessage({ type: "REMOVE_IMAGE", imageId: keyedEntry.imageId }).catch(() => {});
          trackedImageKeys.delete(key);
          completedImageKeys.delete(key);
        }
      }
      if (image.dataset?.aiEnhancerKey) {
        completedImageKeys.delete(image.dataset.aiEnhancerKey);
      }
      if (image.dataset?.aiEnhancerImageId) {
        const byId = trackedImages.get(image.dataset.aiEnhancerImageId);
        if (byId) this.cancel(byId);
      }
    }
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
    minInputWidthEnabled: true,
    minInputHeightEnabled: true,
    maxInputWidthEnabled: true,
    maxInputHeightEnabled: true,
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
  if (areaName === "local" && (
    changes.minInputWidth || changes.minInputHeight || changes.maxInputWidth || changes.maxInputHeight ||
    changes.minInputWidthEnabled || changes.minInputHeightEnabled || changes.maxInputWidthEnabled || changes.maxInputHeightEnabled
  )) {
    chrome.storage.local.get({
      minInputWidth: AI_MANGA_UPSCALER_CONFIG.images.minWidthPx,
      minInputHeight: AI_MANGA_UPSCALER_CONFIG.images.minHeightPx,
      maxInputWidth: AI_MANGA_UPSCALER_CONFIG.images.maxWidthPx,
      maxInputHeight: AI_MANGA_UPSCALER_CONFIG.images.maxHeightPx,
      minInputWidthEnabled: true,
      minInputHeightEnabled: true,
      maxInputWidthEnabled: true,
      maxInputHeightEnabled: true,
    }).then((limits) => {
      viewportProvider.imageProvider.updateLimits(limits);
      viewportProvider.reprocessVisibleImages();
    });
  }
  if (areaName === "local" && changes.preprocessingConcurrency) {
    viewportProvider.preprocessingConcurrency = Number(changes.preprocessingConcurrency.newValue) || AI_MANGA_UPSCALER_CONFIG.queue.preprocessingConcurrency;
  }
  if (areaName === "local" && (changes.imageSlicingEnabled || changes.imageSliceMaxHeight)) {
    chrome.storage.local.get({
      imageSlicingEnabled: AI_MANGA_UPSCALER_CONFIG.images.slicingEnabled,
      imageSliceMaxHeight: AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx,
    }).then((settings) => {
      viewportProvider.imageSlicingEnabled = settings.imageSlicingEnabled !== false;
      viewportProvider.imageSliceMaxHeight = Number(settings.imageSliceMaxHeight) || AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx;
      viewportProvider.reprocessVisibleImages();
    });
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
    viewportProvider.fail(message.imageId, Boolean(message.permanent));
  }

  if (message.type === "SET_PREVIEW_ORIGINAL") {
    renderer.setPreviewOriginal(Boolean(message.enabled));
  }

  if (message.type === "SET_ENABLED") {
    viewportProvider.setEnabled(Boolean(message.enabled));
    sendResponse({ enabled: Boolean(message.enabled) });
    return false;
  }
});

viewportProvider.start();
