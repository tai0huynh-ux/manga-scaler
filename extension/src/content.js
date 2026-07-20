{
const trackedImages = new Map();
const trackedImageKeys = new Map();
const completedImageKeys = new Set();
const contentInstanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function isActiveContentInstance() {
  return document.documentElement?.dataset?.aiMangaUpscalerInstance === contentInstanceId;
}

document.documentElement.dataset.aiMangaUpscalerInstance = contentInstanceId;
document.querySelectorAll("img[data-ai-manga-upscaler-observed]").forEach((image) => {
  delete image.dataset.aiMangaUpscalerObserved;
  delete image.dataset.aiEnhancerSeen;
});

function newTraceId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto?.getRandomValues?.(bytes);
    if (bytes.some((value) => value !== 0)) {
      return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // Test harnesses may not expose browser crypto.
  }
  return `trace-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function sanitizeTraceMetadata(metadata = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    const lower = key.toLowerCase();
    if (lower.includes("imagedata") || lower.includes("base64") || lower.includes("authorization")) continue;
    if (typeof value === "string") sanitized[key] = value.length > 256 ? `${value.slice(0, 253)}...` : value;
    else if (typeof value === "number" || typeof value === "boolean" || value === null) sanitized[key] = value;
  }
  return sanitized;
}

function emitTrace({ event, traceId, component = "content", stage = "content", status, attempt = null, metadata = {} }) {
  try {
    const payload = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      event,
      traceId: traceId || newTraceId(),
      component,
      stage,
      status,
      attempt,
      metadata: sanitizeTraceMetadata(metadata),
    };
    if (Array.isArray(globalThis.__AI_MANGA_UPSCALER_TRACE_EVENTS__)) {
      globalThis.__AI_MANGA_UPSCALER_TRACE_EVENTS__.push(payload);
    }
    if (globalThis.__AI_MANGA_UPSCALER_DEBUG__ === true) {
      console.debug("[AI Enhancer][trace]", payload);
    }
    return payload;
  } catch {
    return null;
  }
}

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

  canProcess(image, options = {}) {
    const width = image.naturalWidth || image.width || image.clientWidth;
    const height = image.naturalHeight || image.height || image.clientHeight;
    const allowTallImage = options.allowTallImage === true;
    return (
      !this.isInterfaceOrAdvertisement(image) &&
      (this.limits.minInputWidthEnabled === false || width >= this.limits.minInputWidth) &&
      (this.limits.minInputHeightEnabled === false || height >= this.limits.minInputHeight) &&
      (this.limits.maxInputWidthEnabled === false || width <= this.limits.maxInputWidth) &&
      (allowTallImage || this.limits.maxInputHeightEnabled === false || height <= this.limits.maxInputHeight)
    );
  }

  isInterfaceOrAdvertisement(image) {
    const reader = image?.closest?.(".reading-detail.box_doc") || image?.parentElement;
    const isReaderChrome = Boolean(
      reader?.classList?.contains?.("reading-detail") &&
      reader?.classList?.contains?.("box_doc") &&
      reader?.querySelector?.(".page-chapter img") &&
      !image?.closest?.(".page-chapter")
    );
    // Some reader mirrors place a promotional image beside, rather than inside, page containers.
    if (isReaderChrome) return true;
    const source = image?.currentSrc || image?.src || "";
    if (/^data:image\/gif;base64,R0lGODlhAQABA/i.test(source)) return true;
    const attributes = [
      image?.alt,
      image?.title,
      image?.id,
      image?.className,
      image?.getAttribute?.("aria-label"),
      image?.currentSrc,
      image?.src,
    ].filter((value) => typeof value === "string").join(" ").toLowerCase();
    const explicitAssetPattern = /(^|[\s_./-])(advert(?:isement|ising)?|ads?|adserver|adservice|doubleclick|googleads|avatar|badge|emoji|icon|logo|sprite)(?=$|[\s_./-])|noavatar/i;
    if (explicitAssetPattern.test(attributes)) return true;
    if (typeof image?.closest !== "function") return false;
    return Boolean(image.closest([
      "header", "nav", "aside", "footer",
      '[role="banner"]', '[role="navigation"]', '[role="complementary"]',
      '[aria-label*="advert" i]', '[data-ad]', '[data-ad-slot]',
      '[class*="advert" i]', '[id*="advert" i]',
      ".avartar-comment", ".avatar-comment", ".comment-avatar", ".user-avatar",
    ].join(",")));
  }

  read(image) {
    const originalSource = image.dataset.aiMangaOriginalSrc;
    const stableUrl = originalSource ? new URL(originalSource, document.baseURI).href : image.currentSrc || image.src;
    const rect = image.getBoundingClientRect?.() || {};
    return {
      imageUrl: stableUrl,
      src: originalSource || image.getAttribute("src"),
      srcset: image.dataset.aiMangaOriginalSrcset || image.getAttribute("srcset"),
      sizes: image.dataset.aiMangaOriginalSizes || image.getAttribute("sizes"),
      width: rect.width || image.clientWidth || image.width || image.naturalWidth || 0,
      height: rect.height || image.clientHeight || image.height || image.naturalHeight || 0,
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
    this.renderTransactions = new WeakMap();
    this.sliceTransactions = new WeakMap();
    this.revokedObjectUrls = new Set();
    this.transactionSequence = 0;
    this.installStyles();
  }

  async render(image, payload, isCurrent = () => true) {
    if (!image || !payload?.imageBase64) {
      return "load-error";
    }
    if (!isCurrent()) {
      return "stale";
    }

    const metadata = trackedImages.get(payload.imageId)?.metadata;
    if (!metadata) {
      return "stale";
    }
    if (!isCurrent()) {
      return "stale";
    }

    const previousTransaction = this.renderTransactions.get(image);
    if (previousTransaction?.state === "prepared") {
      previousTransaction.rollback();
    }

    let objectUrl;
    try {
      const blob = new Blob([this.base64ToUint8Array(payload.imageBase64)], {
        type: payload.contentType || "image/png",
      });
      objectUrl = URL.createObjectURL(blob);
    } catch {
      return "load-error";
    }

    const snapshot = this.captureRenderState(image, metadata);
    const transaction = {
      token: `render-${this.transactionSequence++}`,
      state: "prepared",
      image,
      metadata,
      objectUrl,
      abortController: this.createCancellationController(),
      previousObjectUrl: this.activeObjectUrls.get(image),
      snapshot,
      applied: null,
      rollback: () => this.rollbackRenderTransaction(transaction),
    };
    this.renderTransactions.set(image, transaction);

    await this.fadeOut(image);
    if (!isCurrent() || this.renderTransactions.get(image) !== transaction) {
      transaction.rollback();
      return "stale";
    }

    this.freezeLayout(image, metadata);
    this.preserveResponsiveAttributes(image, metadata);
    transaction.applied = this.capturePreparedRenderState(image, metadata);
    if (!isCurrent() || this.renderTransactions.get(image) !== transaction) {
      transaction.rollback();
      return "stale";
    }

    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    if (!isCurrent() || this.renderTransactions.get(image) !== transaction) {
      transaction.rollback();
      return "stale";
    }

    this.activeObjectUrls.set(image, objectUrl);
    image.src = objectUrl;
    try {
      await this.waitForImageLoad(image, transaction.abortController.signal);
    } catch {
      const stale = !isCurrent() || this.renderTransactions.get(image) !== transaction;
      transaction.rollback();
      return stale ? "stale" : "load-error";
    }

    if (!isCurrent() || this.renderTransactions.get(image) !== transaction) {
      transaction.rollback();
      return "stale";
    }

    transaction.state = "committed";
    image.classList.remove?.("ai-manga-upscaler-fading");
    image.classList.add?.("ai-manga-upscaler-ready");
    if (this.renderTransactions.get(image) === transaction) {
      this.renderTransactions.delete(image);
    }
    if (typeof transaction.previousObjectUrl === "string" && transaction.previousObjectUrl !== objectUrl) {
      this.revokeObjectUrl(transaction.previousObjectUrl);
    }
    return "rendered";
  }

  prepareRawSlices(image, metadata, segments, identity = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "ai-enhancer-slice-wrapper";
    wrapper.hidden = true;
    const token = `${identity.operationId || "slice"}-${this.transactionSequence++}`;
    wrapper.dataset.aiEnhancerSliceToken = token;
    wrapper.dataset.aiEnhancerParentOperationId = identity.operationId || "";
    wrapper.style.position = "relative";
    wrapper.style.height = "auto";
    wrapper.style.maxWidth = "100%";
    wrapper.style.overflow = "hidden";
    wrapper.style.contain = "layout paint style";
    wrapper.style.isolation = "isolate";
    const previousDisplay = image.style.display;
    const slicedDataset = this.captureDatasetValue(image, "aiEnhancerSliced");
    const segmentUrls = new Set(segments.map((segment) => segment?.objectUrl).filter((objectUrl) => typeof objectUrl === "string"));
    let sequentialTop = 0;
    const layouts = segments.map((segment) => {
      const renderedLeft = Number(segment.renderedLeft) || 0;
      const renderedTop = Number.isFinite(Number(segment.renderedTop)) ? Number(segment.renderedTop) : sequentialTop;
      const renderedWidth = Number(segment.renderedWidth) || Number(metadata.width) || 0;
      const renderedHeight = Number(segment.renderedHeight) || 0;
      sequentialTop = Math.max(sequentialTop, renderedTop + renderedHeight);
      return { renderedLeft, renderedTop, renderedWidth, renderedHeight };
    });
    const wrapperWidth = Math.max(
      Number(metadata.width) || 0,
      ...layouts.map((layout) => layout.renderedLeft + layout.renderedWidth),
    );
    const wrapperHeight = Math.max(Number(metadata.height) || 0, ...layouts.map((layout) => layout.renderedTop + layout.renderedHeight));
    if (wrapperWidth > 0) wrapper.style.width = `${wrapperWidth}px`;
    if (wrapperWidth > 0 && wrapperHeight > 0) wrapper.style.aspectRatio = `${wrapperWidth} / ${wrapperHeight}`;
    const asPercent = (value, total) => {
      if (!(total > 0)) return "0%";
      return `${Number(((Number(value) || 0) * 100 / total).toFixed(6))}%`;
    };
    const rawImages = segments.map((segment, position) => {
      const layout = layouts[position];
      const raw = new Image();
      raw.className = "ai-enhancer-raw-slice";
      raw.dataset.aiEnhancerRawSlice = "true";
      raw.dataset.aiEnhancerSliceToken = token;
      raw.dataset.aiEnhancerParentOperationId = identity.operationId || "";
      raw.dataset.aiEnhancerSegmentIndex = String(segment.index);
      raw.dataset.aiEnhancerSourceX = String(segment.sourceX ?? 0);
      raw.dataset.aiEnhancerSourceY = String(segment.sourceY ?? 0);
      raw.dataset.aiEnhancerSourceWidth = String(segment.sourceWidth ?? 0);
      raw.dataset.aiEnhancerSourceHeight = String(segment.sourceHeight ?? 0);
      raw.alt = image.alt || "";
      raw.decoding = "async";
      raw.src = segment.objectUrl;
      raw.style.position = "absolute";
      raw.style.left = asPercent(layout.renderedLeft, wrapperWidth);
      raw.style.top = asPercent(layout.renderedTop, wrapperHeight);
      raw.style.width = layout.renderedWidth > 0 ? asPercent(layout.renderedWidth, wrapperWidth) : "100%";
      raw.style.height = asPercent(layout.renderedHeight, wrapperHeight);
      raw.style.display = "block";
      raw.style.objectFit = "contain";
      raw.style.objectPosition = "left top";
      wrapper.appendChild(raw);
      this.activeObjectUrls.set(raw, segment.objectUrl);
      return raw;
    });
    const transaction = {
      token,
      state: "prepared",
      wrapper,
      image,
      identity,
      rawImages,
      segments,
      active: false,
      commit: () => {
        if (transaction.state === "committed") return true;
        if (transaction.state !== "prepared" || !image.parentNode) return false;
        const previousOwner = this.sliceTransactions.get(image);
        if (previousOwner && previousOwner !== transaction) {
          previousOwner.rollback();
        }
        this.sliceTransactions.set(image, transaction);
        image.parentNode.insertBefore(wrapper, image);
        image.dataset.aiEnhancerSliced = "true";
        transaction.state = "committed";
        return true;
      },
      activate: () => {
        if (transaction.state !== "committed") return false;
        if (transaction.active) return true;
        wrapper.hidden = false;
        image.style.display = "none";
        transaction.active = true;
        return true;
      },
      rollback: () => {
        if (transaction.state === "rolledBack") return false;
        const wasCommitted = transaction.state === "committed";
        transaction.state = "rolledBack";
        if (typeof wrapper.remove === "function") {
          wrapper.remove();
        } else if (wrapper.parentNode?.removeChild) {
          wrapper.parentNode.removeChild(wrapper);
        }
        if (wasCommitted && this.sliceTransactions.get(image) === transaction) {
          image.style.display = previousDisplay;
          this.restoreDatasetValue(image, "aiEnhancerSliced", slicedDataset);
          this.sliceTransactions.delete(image);
        }
        for (const raw of rawImages) {
          const activeUrl = this.activeObjectUrls.get(raw);
          if (typeof activeUrl === "string") this.revokeObjectUrl(activeUrl);
          this.activeObjectUrls.delete(raw);
        }
        for (const objectUrl of segmentUrls) {
          this.revokeObjectUrl(objectUrl);
        }
        return true;
      },
    };
    return transaction;
  }

  installRawSlices(image, metadata, segments) {
    const transaction = this.prepareRawSlices(image, metadata, segments);
    if (transaction.commit()) transaction.activate();
    return transaction.rawImages;
  }

  captureAttribute(element, name) {
    const value = typeof element?.getAttribute === "function" ? element.getAttribute(name) : null;
    const present = typeof element?.hasAttribute === "function" ? element.hasAttribute(name) : value !== null;
    return { present, value };
  }

  restoreAttribute(element, name, snapshot) {
    if (!element || !snapshot) return;
    if (snapshot.present) element.setAttribute?.(name, snapshot.value ?? "");
    else element.removeAttribute?.(name);
  }

  captureDatasetValue(element, name) {
    return {
      present: Boolean(element?.dataset && Object.prototype.hasOwnProperty.call(element.dataset, name)),
      value: element?.dataset?.[name],
    };
  }

  restoreDatasetValue(element, name, snapshot) {
    if (!element?.dataset || !snapshot) return;
    if (snapshot.present) element.dataset[name] = snapshot.value;
    else delete element.dataset[name];
  }

  captureRenderState(image, metadata) {
    return {
      src: this.captureAttribute(image, "src"),
      srcProperty: metadata.src || null,
      displayedSrc: image.currentSrc || image.src || metadata.imageUrl || "",
      srcset: this.captureAttribute(image, "srcset"),
      sizes: this.captureAttribute(image, "sizes"),
      width: image.style.width,
      height: image.style.height,
      maxWidth: image.style.maxWidth,
      aspectRatio: image.style.aspectRatio,
      objectFit: image.style.objectFit,
      originalSrc: this.captureDatasetValue(image, "aiMangaOriginalSrc"),
      originalSrcset: this.captureDatasetValue(image, "aiMangaOriginalSrcset"),
      originalSizes: this.captureDatasetValue(image, "aiMangaOriginalSizes"),
      fading: Boolean(image.classList.contains?.("ai-manga-upscaler-fading")),
      ready: Boolean(image.classList.contains?.("ai-manga-upscaler-ready")),
      pictureSources: (metadata.pictureSources || []).map(({ source }) => ({
        source,
        srcset: this.captureAttribute(source, "srcset"),
        sizes: this.captureAttribute(source, "sizes"),
        originalSrcset: this.captureDatasetValue(source, "aiMangaOriginalSrcset"),
        originalSizes: this.captureDatasetValue(source, "aiMangaOriginalSizes"),
      })),
    };
  }

  capturePreparedRenderState(image, metadata) {
    return {
      width: image.style.width,
      height: image.style.height,
      maxWidth: image.style.maxWidth,
      aspectRatio: image.style.aspectRatio,
      objectFit: image.style.objectFit,
      originalSrc: image.dataset.aiMangaOriginalSrc,
      originalSrcset: image.dataset.aiMangaOriginalSrcset,
      originalSizes: image.dataset.aiMangaOriginalSizes,
      pictureSources: (metadata.pictureSources || []).map(({ source }) => ({
        source,
        originalSrcset: source.dataset.aiMangaOriginalSrcset,
        originalSizes: source.dataset.aiMangaOriginalSizes,
      })),
    };
  }

  rollbackRenderTransaction(transaction) {
    if (!transaction || transaction.state === "rolledBack") return false;
    transaction.state = "rolledBack";
    const { image, snapshot, objectUrl, applied } = transaction;
    const ownsDom = this.renderTransactions.get(image) === transaction;
    if (!transaction.abortController?.signal?.aborted) {
      transaction.abortController?.abort("stale");
    }
    if (ownsDom) {
      if (image.src === objectUrl || image.currentSrc === objectUrl) {
        this.restoreAttribute(image, "src", snapshot.src);
        if (snapshot.src.present) {
          image.src = snapshot.src.value ?? "";
        } else if (snapshot.srcProperty) {
          image.src = snapshot.srcProperty;
          image.removeAttribute?.("src");
        }
      }
      if (!image.hasAttribute?.("srcset")) this.restoreAttribute(image, "srcset", snapshot.srcset);
      if (!image.hasAttribute?.("sizes")) this.restoreAttribute(image, "sizes", snapshot.sizes);
      if (!applied || image.style.width === applied.width) image.style.width = snapshot.width;
      if (!applied || image.style.height === applied.height) image.style.height = snapshot.height;
      if (!applied || image.style.maxWidth === applied.maxWidth) this.restoreStyleValue(image.style, "maxWidth", snapshot.maxWidth);
      if (!applied || image.style.aspectRatio === applied.aspectRatio) this.restoreStyleValue(image.style, "aspectRatio", snapshot.aspectRatio);
      if (!applied || image.style.objectFit === applied.objectFit) this.restoreStyleValue(image.style, "objectFit", snapshot.objectFit);
      if (!applied || image.dataset.aiMangaOriginalSrc === applied.originalSrc) {
        this.restoreDatasetValue(image, "aiMangaOriginalSrc", snapshot.originalSrc);
      }
      if (!applied || image.dataset.aiMangaOriginalSrcset === applied.originalSrcset) {
        this.restoreDatasetValue(image, "aiMangaOriginalSrcset", snapshot.originalSrcset);
      }
      if (!applied || image.dataset.aiMangaOriginalSizes === applied.originalSizes) {
        this.restoreDatasetValue(image, "aiMangaOriginalSizes", snapshot.originalSizes);
      }
      snapshot.pictureSources.forEach((sourceSnapshot, index) => {
        const source = sourceSnapshot.source;
        const appliedSource = applied?.pictureSources?.[index];
        if (!source.hasAttribute?.("srcset")) this.restoreAttribute(source, "srcset", sourceSnapshot.srcset);
        if (!source.hasAttribute?.("sizes")) this.restoreAttribute(source, "sizes", sourceSnapshot.sizes);
        if (!appliedSource || source.dataset.aiMangaOriginalSrcset === appliedSource.originalSrcset) {
          this.restoreDatasetValue(source, "aiMangaOriginalSrcset", sourceSnapshot.originalSrcset);
        }
        if (!appliedSource || source.dataset.aiMangaOriginalSizes === appliedSource.originalSizes) {
          this.restoreDatasetValue(source, "aiMangaOriginalSizes", sourceSnapshot.originalSizes);
        }
      });
      if (snapshot.fading) image.classList.add?.("ai-manga-upscaler-fading");
      else image.classList.remove?.("ai-manga-upscaler-fading");
      if (snapshot.ready) image.classList.add?.("ai-manga-upscaler-ready");
      else image.classList.remove?.("ai-manga-upscaler-ready");
      if (this.activeObjectUrls.get(image) === objectUrl) {
        if (typeof transaction.previousObjectUrl === "string") {
          this.activeObjectUrls.set(image, transaction.previousObjectUrl);
        } else {
          this.activeObjectUrls.delete(image);
        }
      }
      this.renderTransactions.delete(image);
    }
    this.revokeObjectUrl(objectUrl);
    return true;
  }

  restoreStyleValue(style, name, value) {
    if (value === undefined) {
      try {
        delete style[name];
      } catch {
        style[name] = "";
      }
      return;
    }
    style[name] = value;
  }

  revokeObjectUrl(objectUrl) {
    if (typeof objectUrl !== "string" || this.revokedObjectUrls.has(objectUrl)) return false;
    this.revokedObjectUrls.add(objectUrl);
    URL.revokeObjectURL(objectUrl);
    return true;
  }

  createCancellationController() {
    if (typeof AbortController === "function") {
      return new AbortController();
    }
    const listeners = new Set();
    const signal = {
      aborted: false,
      reason: null,
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
    };
    return {
      signal,
      abort(reason = "cancelled") {
        if (signal.aborted) return;
        signal.aborted = true;
        signal.reason = reason;
        for (const listener of [...listeners]) listener({ type: "abort" });
        listeners.clear();
      },
    };
  }

  isOwnedSource(image) {
    const objectUrl = this.activeObjectUrls.get(image);
    return typeof objectUrl === "string" && (image?.src === objectUrl || image?.currentSrc === objectUrl);
  }

  releaseImageOwnership(image) {
    const objectUrl = this.activeObjectUrls.get(image);
    if (typeof objectUrl === "string") {
      this.revokeObjectUrl(objectUrl);
      this.activeObjectUrls.delete(image);
    }
    delete image.dataset.aiMangaOriginalSrc;
    delete image.dataset.aiMangaOriginalSrcset;
    delete image.dataset.aiMangaOriginalSizes;
  }

  freezeLayout(image, metadata) {
    if (image?.dataset?.aiEnhancerRawSlice === "true") return;
    if (metadata.width > 0) {
      image.style.width = `${metadata.width}px`;
      image.style.maxWidth = "100%";
    }
    image.style.height = "auto";
    if (metadata.width > 0 && metadata.height > 0) {
      image.style.aspectRatio = `${metadata.width} / ${metadata.height}`;
    }
    image.style.objectFit = "contain";
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
    image.dataset.aiMangaOriginalSrc = metadata.src || metadata.imageUrl || image.currentSrc || image.src || "";
    image.dataset.aiMangaOriginalSrcset = metadata.srcset || "";
    image.dataset.aiMangaOriginalSizes = metadata.sizes || "";

    (metadata.pictureSources || []).forEach(({ source, srcset, sizes }) => {
      source.dataset.aiMangaOriginalSrcset = srcset || "";
      source.dataset.aiMangaOriginalSizes = sizes || "";
      source.removeAttribute("srcset");
      source.removeAttribute("sizes");
    });
  }

  fadeOut(image) {
    if (image?.dataset?.aiEnhancerRawSlice === "true") return Promise.resolve();
    return new Promise((resolve) => {
      image.classList.add("ai-manga-upscaler-fading");
      setTimeout(resolve, AI_MANGA_UPSCALER_CONFIG.render.fadeMs);
    });
  }

  waitForImageLoad(image, signal = null, timeoutMs = AI_MANGA_UPSCALER_CONFIG.images.browserReadTimeoutMs) {
    if (signal?.aborted) {
      return Promise.reject(new Error("Image load cancelled."));
    }
    if (image.complete) {
      if ((image.naturalWidth || 0) <= 0) {
        return Promise.reject(new Error("Image failed to load."));
      }
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId = null;
      const cleanup = () => {
        image.removeEventListener?.("load", onLoad);
        image.removeEventListener?.("error", onError);
        signal?.removeEventListener?.("abort", onAbort);
        if (timeoutId !== null) clearTimeout(timeoutId);
      };
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onLoad = () => settle(resolve);
      const onError = () => settle(reject, new Error("Image failed to load."));
      const onAbort = () => settle(reject, new Error("Image load cancelled."));
      const onTimeout = () => settle(reject, new Error("Image load timed out."));
      image.addEventListener("load", onLoad, { once: true });
      image.addEventListener("error", onError, { once: true });
      signal?.addEventListener?.("abort", onAbort, { once: true });
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timeoutId = setTimeout(onTimeout, timeoutMs);
      }
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

      .ai-enhancer-slice-wrapper[hidden] {
        display: none !important;
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
    this.aheadProcessingEnabled = AI_MANGA_UPSCALER_CONFIG.images.aheadProcessingEnabled;
    this.aheadProcessingImageLimit = AI_MANGA_UPSCALER_CONFIG.images.aheadProcessingImageLimit;
    this.prefetchMarginPx = AI_MANGA_UPSCALER_CONFIG.images.prefetchMarginPx;
    this.aheadProcessingKeys = new Map();
    this.initialAheadQueue = [];
    this.sourceOwners = new Map();
    this.sourceOwnerKeysByImage = new WeakMap();
    this.aheadProcessingCompleted = false;
    this.pageLoadHandled = false;
    this.pageHidden = false;
    this.imageSlicingEnabled = AI_MANGA_UPSCALER_CONFIG.images.slicingEnabled;
    this.imageSliceMaxWidth = AI_MANGA_UPSCALER_CONFIG.images.sliceMaxWidthPx;
    this.imageSliceMaxHeight = AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx;
    this.sliceGroups = new Map();
    this.sliceGroupsByParent = new WeakMap();
    this.imageLoadListeners = new WeakMap();
    this.pageGeneration = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.pageOrder = 0;
    this.mutationObserver = new MutationObserver((mutations) => this.handleMutations(mutations));
    this.intersectionObserver = new IntersectionObserver(
      (entries) => this.handleIntersections(entries),
      {
        root: null,
        rootMargin: `${this.prefetchMarginPx}px 0px`,
        threshold: [0, 0.01],
      },
    );
    this.onScroll = this.throttle(() => this.refreshPriorities(), 250);
    this.onWindowLoad = () => this.handlePageLoaded();
    this.onPageHide = () => {
      this.pageHidden = true;
      this.initialAheadQueue = [];
      [...trackedImages.values()].forEach((entry) => this.cancel(entry));
      this.aheadProcessingKeys.clear();
    };
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
      imageSliceMaxWidth: AI_MANGA_UPSCALER_CONFIG.images.sliceMaxWidthPx,
      imageSliceMaxHeight: AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx,
      preprocessingConcurrency: AI_MANGA_UPSCALER_CONFIG.queue.preprocessingConcurrency,
      aheadProcessingEnabled: AI_MANGA_UPSCALER_CONFIG.images.aheadProcessingEnabled,
      aheadProcessingImageLimit: AI_MANGA_UPSCALER_CONFIG.images.aheadProcessingImageLimit,
      prefetchMarginPx: AI_MANGA_UPSCALER_CONFIG.images.prefetchMarginPx,
      storageSchemaVersion: 0,
    });
    if (!isActiveContentInstance()) return;
    this.enabled = stored.enabled;
    this.blacklist = new Set(stored.blacklistRules || []);
    this.imageProvider.updateLimits(stored);
    this.imageSlicingEnabled = stored.imageSlicingEnabled !== false;
    this.imageSliceMaxWidth = Number(stored.imageSliceMaxWidth) || AI_MANGA_UPSCALER_CONFIG.images.sliceMaxWidthPx;
    this.imageSliceMaxHeight = Number(stored.imageSliceMaxHeight) || AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx;
    this.preprocessingConcurrency = Number(stored.preprocessingConcurrency) || AI_MANGA_UPSCALER_CONFIG.queue.preprocessingConcurrency;
    this.aheadProcessingEnabled = Number(stored.storageSchemaVersion) < 4
      ? true
      : stored.aheadProcessingEnabled !== false;
    this.aheadProcessingImageLimit = Number(stored.aheadProcessingImageLimit) || AI_MANGA_UPSCALER_CONFIG.images.aheadProcessingImageLimit;
    this.prefetchMarginPx = Number.isFinite(Number(stored.prefetchMarginPx))
      ? Number(stored.prefetchMarginPx)
      : AI_MANGA_UPSCALER_CONFIG.images.prefetchMarginPx;
    if (this.enabled && document.readyState !== "complete") this.observeExistingImages();
    this.mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onScroll, { passive: true });
    window.addEventListener("load", this.onWindowLoad, { once: true });
    window.addEventListener("pagehide", this.onPageHide, { once: true });
    if (document.readyState === "complete") this.handlePageLoaded();
  }

  setEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    if (this.enabled === nextEnabled) return false;
    this.enabled = nextEnabled;
    if (nextEnabled) {
      if (document.readyState === "complete") this.handlePageLoaded();
      else this.observeExistingImages();
    } else {
      this.initialAheadQueue = [];
      [...this.sliceGroups.values()].forEach((group) => this.rollbackSliceGroup(group, "disabled"));
      [...trackedImages.values()].forEach((entry) => this.cancel(entry));
      document.querySelectorAll("img[data-ai-manga-upscaler-observed]")
        .forEach((image) => this.stopObservingImage(image));
    }
    return true;
  }

  reprocessVisibleImages() {
    [...this.sliceGroups.values()].forEach((group) => this.rollbackSliceGroup(group, "reprocess"));
    [...trackedImages.values()].forEach((entry) => this.cancel(entry));
    trackedImageKeys.clear();
    trackedImages.clear();
    completedImageKeys.clear();
    this.aheadProcessingKeys.clear();
    this.initialAheadQueue = [];
    this.sourceOwners.clear();
    this.sourceOwnerKeysByImage = new WeakMap();
    document.querySelectorAll("img").forEach((image) => this.schedule(image));
  }

  observeExistingImages() {
    document.querySelectorAll("img").forEach((image) => this.observeImage(image));
  }

  stopObservingImage(image) {
    const loadListener = this.imageLoadListeners.get(image);
    if (loadListener) image.removeEventListener("load", loadListener);
    this.imageLoadListeners.delete(image);
    this.intersectionObserver.unobserve?.(image);
    delete image.dataset.aiMangaUpscalerObserved;
    delete image.dataset.aiEnhancerSeen;
  }

  handleMutations(mutations) {
    if (!this.enabled || !isActiveContentInstance()) {
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
    if (!this.enabled || !isActiveContentInstance()) return;
    if (image.dataset.aiEnhancerRawSlice === "true" || image.dataset.aiEnhancerSliced === "true") {
      return;
    }
    if (image.dataset.aiMangaUpscalerObserved === "true") {
      return;
    }

    image.dataset.aiMangaUpscalerObserved = "true";
    const reportSeen = (event = null) => {
      if (!this.enabled || !isActiveContentInstance()) return;
      if (image.dataset.aiMangaOriginalSrc) {
        if (this.renderer?.isOwnedSource?.(image)) return;
        this.renderer?.releaseImageOwnership?.(image);
      }
      if (image.dataset.aiEnhancerSliced === "true") {
        const group = this.sliceGroupsByParent.get(image);
        if (!group) return;
        const currentMetadata = this.imageProvider.read(image);
        const currentKey = currentMetadata.imageUrl ? this.imageKey(currentMetadata, image) : null;
        if (currentKey === group.sourceRevision) return;
        this.rollbackSliceGroup(group, "superseded");
      }
      if (event?.type === "load") {
        const currentGeneration = Number(image.dataset.aiEnhancerSourceGeneration || "0");
        image.dataset.aiEnhancerSourceGeneration = String(currentGeneration + 1);
      }
      if (!this.canProcessCandidate(image, { allowPrefetch: true })) {
        return;
      }
      const metadata = this.imageProvider.read(image);
      if (this.isBlacklisted(metadata.imageUrl)) return;
      const imageKey = this.imageKey(metadata, image);
      if (image.dataset.aiEnhancerSeen === "true" && image.dataset.aiEnhancerKey === imageKey) {
        return;
      }
      if (completedImageKeys.has(imageKey)) {
        image.dataset.aiEnhancerSeen = "true";
        image.dataset.aiEnhancerKey = imageKey;
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
      const operationId = existing?.operationId || this.createOperationId(imageId);
      const traceId = existing?.traceId || newTraceId();
      image.dataset.aiEnhancerImageId = imageId;
      image.dataset.aiEnhancerOperationId = operationId;
      image.dataset.aiEnhancerTraceId = traceId;
      image.dataset.aiEnhancerPageOrder = image.dataset.aiEnhancerPageOrder || String(this.pageOrder++);
      image.dataset.aiEnhancerKey = imageKey;
      image.dataset.aiEnhancerSeen = "true";
      if (!existing) {
        trackedImageKeys.set(imageKey, {
          imageId,
          operationId,
          traceId,
          sourceRevision: imageKey,
          image,
          metadata,
          state: "seen",
          baseKey: imageKey,
          isSegment: false,
          pageOrder: Number(image.dataset.aiEnhancerPageOrder) || 0,
        });
        emitTrace({
          event: "content.operation.created",
          traceId,
          status: "created",
          metadata: { input_width: metadata.width, input_height: metadata.height },
        });
      }
      chrome.runtime.sendMessage({
        type: "IMAGE_SEEN",
        imageId,
        operationId,
        traceId,
        sourceRevision: imageKey,
        imageUrl: metadata.imageUrl,
        width: metadata.width,
        height: metadata.height,
        pageOrder: Number(image.dataset.aiEnhancerPageOrder) || 0,
      });
      if (event?.type === "load" && this.isWithinPrefetch(image)) {
        this.schedule(image, true, { allowPrefetch: true });
      }
    };
    reportSeen();
    this.imageLoadListeners.set(image, reportSeen);
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

      if (entry.isIntersecting && this.isWithinPrefetch(image)) {
        this.schedule(image, true, { allowPrefetch: true });
        this.updateImagePriority(image);
      } else {
        const existing = this.findByImage(image);
        if (existing) {
          this.updateImagePriority(image);
          if (
            existing.state === "preprocessing_queued" &&
            existing.aheadProcessing !== true &&
            this.viewportDistance(image) > AI_MANGA_UPSCALER_CONFIG.images.cancelDistancePx
          ) {
            this.deferPreprocessingOperation(existing, "cancelled-outside-prefetch");
          }
        }
      }
    }
  }

  async schedule(image, allowSegments = true, options = {}) {
    if (image.dataset.aiEnhancerRawSlice === "true") {
      return;
    }
    const metadata = this.imageProvider.read(image);
    const activeSliceGroup = this.sliceGroupsByParent.get(image);
    if (image.dataset.aiEnhancerSliced === "true") {
      const nextKey = metadata.imageUrl ? this.imageKey(metadata, image) : null;
      if (!activeSliceGroup || activeSliceGroup.sourceRevision === nextKey) return;
      this.rollbackSliceGroup(activeSliceGroup, "superseded");
    }
    if (!metadata.imageUrl || this.isBlacklisted(metadata.imageUrl) || !this.canProcessCandidate(image, options)) {
      return;
    }

    let existing = this.findByImage(image);
    const baseKey = this.imageKey(metadata, image);
    const existingKeyEntry = this.findKeyEntryByImage(image);
    if (existingKeyEntry && existingKeyEntry.baseKey !== baseKey) {
      this.cancelPreprocessingSignal(existingKeyEntry.entry.preprocessingSignal, "superseded");
      trackedImageKeys.delete(existingKeyEntry.baseKey);
    }
    if (existing && existing.baseKey !== baseKey) {
      this.cancel(existing);
      existing = null;
    }
    const existingByKey = trackedImageKeys.get(baseKey);
    if (existingByKey?.image === image && options.aheadProcessing !== true) {
      this.releaseAheadProcessing(existingByKey);
    }
    if (existingByKey && existingByKey.image !== image && document.documentElement.contains(existingByKey.image)) {
      return;
    }
    if (
      existingByKey?.image === image &&
      ["preprocessing_queued", "preprocessing", "waiting", "processing", "sliced"].includes(existingByKey.state)
    ) {
      return;
    }
    if (completedImageKeys.has(baseKey)) {
      return;
    }
    const imageId = existing?.imageId || existingByKey?.imageId || this.createImageId(baseKey);
    const operationId = existing?.operationId || existingByKey?.operationId || this.createOperationId(imageId);
    const traceId = existing?.traceId || existingByKey?.traceId || image.dataset.aiEnhancerTraceId || newTraceId();
    image.dataset.aiEnhancerImageId = imageId;
    image.dataset.aiEnhancerOperationId = operationId;
    image.dataset.aiEnhancerTraceId = traceId;
    image.dataset.aiEnhancerKey = baseKey;
    image.dataset.aiEnhancerPageOrder = image.dataset.aiEnhancerPageOrder || String(this.pageOrder++);
    const pageOrder = Number(image.dataset.aiEnhancerPageOrder) || 0;
    const operationEntry = {
      imageId,
      image,
      operationId,
      traceId,
      sourceRevision: baseKey,
      metadata,
      state: "seen",
      baseKey,
      isSegment: false,
      pageOrder,
      aheadProcessing: options.aheadProcessing === true,
    };
    if (!this.claimSourceOwner(operationEntry)) {
      trackedImageKeys.set(baseKey, operationEntry);
      return;
    }
    if (operationEntry.aheadProcessing) this.aheadProcessingKeys.set(baseKey, image);
    trackedImageKeys.set(baseKey, operationEntry);
    trackedImages.set(imageId, operationEntry);
    emitTrace({
      event: "content.operation.created",
      traceId,
      status: "created",
      metadata: { input_width: metadata.width, input_height: metadata.height },
    });
    if (allowSegments && this.shouldSliceImage(image)) {
      await this.scheduleSegments(image, metadata, imageId, operationId, baseKey, options);
      return;
    }

    const signal = this.createPreprocessingSignal();
    operationEntry.preprocessingSignal = signal;
    operationEntry.state = "preprocessing_queued";
    this.sendPreprocessingStatus(operationEntry, "PREPROCESSING_QUEUED", "preprocessing_queued");
    const release = await this.acquirePreprocessingSlot(operationEntry);
    if (!release) return;
    let readResult = { ok: false, imageData: null, reason: "read-fetch-error" };
    let sourceFingerprint = null;
    try {
      if (!this.isCurrentImageEntry(operationEntry)) return;
      operationEntry.state = "preprocessing";
      await this.sendPreprocessingStatus(operationEntry, "PREPROCESSING_STARTED", "preprocessing");
      readResult = this.normalizeReadResult(await this.readDisplayedImage(metadata.imageUrl));
      if (!this.isCurrentImageEntry(operationEntry)) return;
      const sourceDimensions = readResult.ok ? this.encodedImageDimensions(readResult.imageData) : null;
      if (allowSegments && this.shouldSliceSourceDimensions(sourceDimensions)) {
        emitTrace({
          event: "content.slicing.promoted",
          traceId,
          status: "promoted",
          metadata: {
            input_width: sourceDimensions.width,
            input_height: sourceDimensions.height,
            rendered_width: metadata.width,
            rendered_height: metadata.height,
          },
        });
        await this.scheduleSegments(image, metadata, imageId, operationId, baseKey, options, {
          readResult,
          signal,
          release,
        });
        return;
      }
      sourceFingerprint = readResult.ok
        ? await this.withTimeout(
            Promise.resolve(this.sourceFingerprint(readResult.imageData)),
            AI_MANGA_UPSCALER_CONFIG.images.sliceFingerprintTimeoutMs,
            "slice-fingerprint-timeout",
          )
        : null;
      if (!this.isCurrentImageEntry(operationEntry)) return;
      operationEntry.sourceFingerprint = sourceFingerprint;
      const enqueueResponse = await this.sendRuntimeMessage({
        type: "ENQUEUE_IMAGE",
        imageId,
        operationId,
        traceId,
        sourceRevision: baseKey,
        sourceFingerprint,
        imageUrl: metadata.imageUrl,
        imageData: readResult.ok ? readResult.imageData : null,
        cacheVariant: "full",
        pageOrder,
        viewportDistance: this.viewportDistance(image),
        displayMetrics: this.displayMetrics(image),
      }, "segment-enqueue-timeout").catch((error) => ({ accepted: false, error }));
      if (enqueueResponse?.accepted === false && this.isCurrentImageEntry(operationEntry)) {
        this.failPreprocessingOperation(operationEntry, this.reasonFromError(enqueueResponse.error, enqueueResponse.reason || "segment-enqueue-error"));
        return;
      }
      if (this.isCurrentImageEntry(operationEntry)) operationEntry.state = "waiting";
    } catch (error) {
      if (this.isCurrentImageEntry(operationEntry)) {
        this.failPreprocessingOperation(operationEntry, this.reasonFromError(error, "preprocessing-error"));
      }
      return;
    } finally {
      release();
    }
  }

  async scheduleSegments(image, metadata, imageId, operationId, baseKey, options = {}, prepared = null) {
    const operation = trackedImageKeys.get(baseKey);
    if (!operation || operation.operationId !== operationId || trackedImages.get(imageId) !== operation) return;
    operation.aheadProcessing = options.aheadProcessing === true;
    if (operation.aheadProcessing) this.aheadProcessingKeys.set(baseKey, image);
    const signal = prepared?.signal || this.createPreprocessingSignal();
    operation.preprocessingSignal = signal;
    let release = prepared?.release || null;
    if (!release) {
      operation.state = "preprocessing_queued";
      this.sendPreprocessingStatus(operation, "PREPROCESSING_QUEUED", "preprocessing_queued");
      release = await this.acquirePreprocessingSlot(operation);
    }
    if (!release) return;
    try {
      if (!this.isCurrentKeyOperation(baseKey, operation)) return;
      if (operation.state !== "preprocessing") {
        operation.state = "preprocessing";
        await this.sendPreprocessingStatus(operation, "PREPROCESSING_STARTED", "preprocessing");
      }
      emitTrace({
        event: "content.slicing.started",
        traceId: operation.traceId,
        status: "running",
        metadata: { input_width: metadata.width, input_height: metadata.height },
      });
      let outcome = { type: "cancel" };
      try {
      if (!this.isCurrentKeyOperation(baseKey, operation)) {
        this.cancelPreprocessingSignal(signal, "superseded");
        return;
      }
      const readResult = prepared?.readResult
        ? this.normalizeReadResult(prepared.readResult)
        : this.normalizeReadResult(await this.readDisplayedImage(metadata.imageUrl));
      if (!readResult.ok) {
        this.logSliceFailure(readResult.reason, {
          imageUrl: metadata.imageUrl,
          operationId,
          imageWidth: metadata.width,
          imageHeight: metadata.height,
        });
        outcome = { type: "fallback", reason: readResult.reason, imageData: null };
      } else {
        const parentSourceFingerprint = await this.withTimeout(
          Promise.resolve(this.sourceFingerprint(readResult.imageData)),
          AI_MANGA_UPSCALER_CONFIG.images.sliceFingerprintTimeoutMs,
          "slice-fingerprint-timeout",
        );
        const segmentsPromise = Promise.resolve(this.cropImageSegments(readResult.imageData, image, signal));
        const segments = await this.withTimeout(
          segmentsPromise,
          AI_MANGA_UPSCALER_CONFIG.images.sliceCropTimeoutMs,
          "slice-crop-timeout",
          () => {
            this.cancelPreprocessingSignal(signal, "slice-crop-timeout");
            segmentsPromise.then(
              (lateSegments) => this.discardSegments(lateSegments),
              () => {},
            );
          },
        );
        if (!this.isCurrentKeyOperation(baseKey, operation)) {
          throw this.preprocessingError("superseded");
        }
        outcome = segments.length
          ? { type: "segments", segments, parentSourceFingerprint, imageData: readResult.imageData }
          : { type: "fallback", reason: "slice-encode-error", imageData: readResult.imageData, parentSourceFingerprint };
      }
      } catch (error) {
      const reason = this.reasonFromError(error, "slice-encode-error");
      if (reason === "cancelled" || reason === "superseded") {
        outcome = { type: "cancel", reason };
      } else {
        this.logSliceFailure(reason, {
          imageUrl: metadata.imageUrl,
          operationId,
          imageWidth: metadata.width,
          imageHeight: metadata.height,
          error,
        });
        outcome = { type: "fallback", reason, imageData: null };
      }
      }

    if (!this.isCurrentKeyOperation(baseKey, operation)) {
      this.cancelPreprocessingSignal(signal, "superseded");
      this.discardSegments(outcome.segments);
      this.removeTrackedEntry(operation);
      return;
    }

    if (outcome.type === "fallback") {
      await this.enqueueFullImageFallback(image, metadata, imageId, operationId, baseKey, operation, outcome);
      return;
    }

    if (outcome.type !== "segments") {
      if (outcome.type === "cancel") this.cancel(operation);
      return;
    }

    const segments = outcome.segments;
    const transaction = typeof this.renderer.prepareRawSlices === "function"
      ? this.renderer.prepareRawSlices(image, metadata, segments, { operationId, sourceRevision: baseKey })
      : {
          state: "prepared",
          rawImages: this.renderer.installRawSlices(image, metadata, segments),
          commit() { this.state = "committed"; return true; },
          rollback: () => this.discardSegments(segments),
        };
    try {
      await this.withTimeout(
        Promise.all(transaction.rawImages.map((rawImage) => this.renderer.waitForImageLoad(rawImage, signal))),
        AI_MANGA_UPSCALER_CONFIG.images.sliceLoadTimeoutMs,
        "slice-load-timeout",
        () => this.cancelPreprocessingSignal(signal, "slice-load-timeout"),
      );
    } catch (error) {
      const loadReason = /timed out|timeout/i.test(error?.message || "")
        ? "slice-load-timeout"
        : this.reasonFromError(error, "slice-load-error");
      this.logSliceFailure(loadReason, {
        imageUrl: metadata.imageUrl,
        operationId,
        imageWidth: metadata.width,
        imageHeight: metadata.height,
        segmentCount: segments.length,
        error,
      });
      transaction.rollback();
      await this.enqueueFullImageFallback(image, metadata, imageId, operationId, baseKey, operation, {
        reason: loadReason,
        imageData: outcome.imageData,
        parentSourceFingerprint: outcome.parentSourceFingerprint,
      });
      return;
    }
    if (!this.isCurrentKeyOperation(baseKey, operation)) {
      this.cancelPreprocessingSignal(signal, "superseded");
      transaction.rollback();
      await this.enqueueFullImageFallback(image, metadata, imageId, operationId, baseKey, operation, {
        reason: "slice-encode-error",
        imageData: outcome.imageData,
        parentSourceFingerprint: outcome.parentSourceFingerprint,
      });
      return;
    }

    let segmentFingerprints;
    try {
      segmentFingerprints = await this.withTimeout(
        Promise.all(segments.map((segment) => this.sourceFingerprint(segment.imageData))),
        AI_MANGA_UPSCALER_CONFIG.images.sliceFingerprintTimeoutMs,
        "slice-fingerprint-timeout",
      );
    } catch (error) {
      const fingerprintReason = this.reasonFromError(error, "slice-fingerprint-error");
      this.logSliceFailure(fingerprintReason, {
        imageUrl: metadata.imageUrl,
        operationId,
        imageWidth: metadata.width,
        imageHeight: metadata.height,
        segmentCount: segments.length,
        error,
      });
      transaction.rollback();
      this.failPreprocessingOperation(operation, fingerprintReason);
      return;
    }
    if (!this.isCurrentKeyOperation(baseKey, operation)) {
      this.cancelPreprocessingSignal(signal, "superseded");
      transaction.rollback();
      this.removeTrackedEntry(operation);
      return;
    }

    const records = segments.map((segment, position) => {
      segment.sourceX = Number(segment.sourceX) || 0;
      segment.sourceY = Number(segment.sourceY) || 0;
      segment.sourceWidth = Number(segment.sourceWidth) || Number(image.naturalWidth) || Number(metadata.width) || 0;
      segment.sourceHeight = Number(segment.sourceHeight) || Number(image.naturalHeight) || Number(metadata.height) || 0;
      segment.renderedLeft = Number(segment.renderedLeft) || 0;
      segment.renderedTop = Number(segment.renderedTop) || 0;
      segment.renderedWidth = Number(segment.renderedWidth) || Number(metadata.width) || 0;
      segment.renderedHeight = Number(segment.renderedHeight) || Number(metadata.height) || 0;
      const segmentId = `${imageId}-seg-${segment.index}`;
      const segmentOperationId = `${operationId}-seg-${segment.index}-${segment.sourceX}-${segment.sourceY}-${segment.sourceWidth}-${segment.sourceHeight}`;
      const segmentSourceFingerprint = segmentFingerprints[position];
      const rawImage = transaction.rawImages[position];
      const segmentKey = `${baseKey}#segment:${segment.index}:${segment.sourceX}:${segment.sourceY}:${segment.sourceWidth}:${segment.sourceHeight}`;
      const segmentOrder = (Number(image.dataset.aiEnhancerPageOrder) || 0) + (segment.index / 1000);
      const segmentMetadata = {
        ...metadata,
        imageUrl: `${metadata.imageUrl}#ai-segment-${segment.index}`,
        src: segment.objectUrl,
        srcset: null,
        sizes: null,
        width: segment.renderedWidth,
        height: segment.renderedHeight,
        pictureSources: [],
      };
      return {
        segment,
        rawImage,
        imageId: segmentId,
        operationId: segmentOperationId,
        sourceRevision: segmentKey,
        sourceFingerprint: segmentSourceFingerprint,
        requiredSliceToken: rawImage?.dataset?.aiEnhancerSliceToken || null,
        metadata: segmentMetadata,
        pageOrder: segmentOrder,
      };
    });
    if (records.some((record) => !record.rawImage)) {
      transaction.rollback();
      await this.enqueueFullImageFallback(image, metadata, imageId, operationId, baseKey, operation, {
        reason: "slice-load-error",
        imageData: outcome.imageData,
        parentSourceFingerprint: outcome.parentSourceFingerprint,
      });
      return;
    }

    const group = {
      token: transaction.token || `${operationId}|${baseKey}`,
      state: "prepared",
      parent: image,
      parentEntry: operation,
      parentImageId: imageId,
      operationId,
      sourceRevision: baseKey,
      parentSourceFingerprint: outcome.parentSourceFingerprint || null,
      transaction,
      records,
      completed: new Set(),
    };
    if (transaction.commit() === false) {
      transaction.rollback();
      await this.enqueueFullImageFallback(image, metadata, imageId, operationId, baseKey, operation, {
        reason: "slice-commit-error",
        imageData: outcome.imageData,
        parentSourceFingerprint: outcome.parentSourceFingerprint,
      });
      return;
    }
    if (!this.isCurrentKeyOperation(baseKey, operation)) {
      this.cancelPreprocessingSignal(signal, "superseded");
      transaction.rollback();
      this.removeTrackedEntry(operation);
      return;
    }

    group.state = "committed";
    operation.state = "sliced";
    operation.sliceGroup = group;
    this.sliceGroups.set(group.token, group);
    this.sliceGroupsByParent.set(image, group);
    try {
      for (const record of records) {
        const { segment, rawImage, imageId: segmentId, operationId: segmentOperationId, sourceRevision: segmentKey, metadata: segmentMetadata, pageOrder: segmentOrder } = record;
        rawImage.dataset.aiEnhancerImageId = segmentId;
        rawImage.dataset.aiEnhancerOperationId = segmentOperationId;
        rawImage.dataset.aiEnhancerKey = segmentKey;
        rawImage.dataset.aiEnhancerParentOperationId = operationId;
        rawImage.dataset.aiEnhancerSegmentIndex = String(segment.index);
        rawImage.dataset.aiEnhancerSourceX = String(segment.sourceX);
        rawImage.dataset.aiEnhancerSourceY = String(segment.sourceY);
        rawImage.dataset.aiEnhancerSourceWidth = String(segment.sourceWidth);
        rawImage.dataset.aiEnhancerSourceHeight = String(segment.sourceHeight);
      const segmentEntry = {
          imageId: segmentId,
          operationId: segmentOperationId,
          traceId: operation.traceId,
          sourceRevision: segmentKey,
          sourceFingerprint: record.sourceFingerprint,
          parentSourceFingerprint: group.parentSourceFingerprint,
          parentJobId: operationId,
          image: rawImage,
          metadata: segmentMetadata,
          state: "waiting",
          baseKey: segmentKey,
          parentKey: baseKey,
          isSegment: true,
          pageOrder: segmentOrder,
          sliceGroup: group,
          segmentRecord: record,
        };
        record.entry = segmentEntry;
        trackedImageKeys.set(segmentKey, segmentEntry);
        trackedImages.set(segmentId, segmentEntry);
        const enqueueResponse = await this.sendRuntimeMessage({
          type: "ENQUEUE_IMAGE",
          imageId: segmentId,
          operationId: segmentOperationId,
          traceId: operation.traceId,
          sourceRevision: segmentKey,
          sourceFingerprint: record.sourceFingerprint,
          parentSourceFingerprint: group.parentSourceFingerprint,
          imageUrl: metadata.imageUrl,
          imageData: segment.imageData,
          cacheVariant: `segment-${segment.index}-${segment.sourceX}-${segment.sourceY}-${segment.sourceWidth}-${segment.sourceHeight}`,
          pageOrder: segmentOrder,
          viewportDistance: this.viewportDistance(image) + segment.index,
          displayMetrics: {
            ...this.displayMetrics(rawImage),
            sourceWidth: segment.sourceWidth,
            sourceHeight: segment.sourceHeight,
            renderedWidth: segment.renderedWidth,
            renderedHeight: segment.renderedHeight,
          },
        }, "segment-enqueue-timeout");
        if (enqueueResponse?.accepted === false) {
          throw this.preprocessingError("segment-enqueue-error", enqueueResponse.reason || "Segment enqueue was rejected.");
        }
      }
    } catch (error) {
      this.logSliceFailure("segment-enqueue-error", {
        imageUrl: metadata.imageUrl,
        operationId,
        imageWidth: metadata.width,
        imageHeight: metadata.height,
        segmentCount: segments.length,
        error,
      });
      this.rollbackSliceGroup(group, "segment-registration-failed");
      return;
    }
    if (group.transaction?.activate?.() === false) {
      this.logSliceFailure("slice-activate-error", {
        imageUrl: metadata.imageUrl,
        operationId,
        imageWidth: metadata.width,
        imageHeight: metadata.height,
        segmentCount: segments.length,
      });
      this.rollbackSliceGroup(group, "slice-activate-error");
      return;
    }
    chrome.runtime.sendMessage({ type: "REMOVE_IMAGE", imageId, operationId }).catch(() => {});
    emitTrace({
      event: "content.slicing.completed",
      traceId: operation.traceId,
      status: "completed",
      metadata: { segment_count: records.length, input_width: metadata.width, input_height: metadata.height },
    });
    } finally {
      release();
    }
  }

  isCurrentKeyOperation(baseKey, operation) {
    return isActiveContentInstance() && operation && trackedImageKeys.get(baseKey) === operation;
  }

  isCurrentImageEntry(entry) {
    return Boolean(
      isActiveContentInstance() &&
      entry &&
      trackedImages.get(entry.imageId) === entry &&
      trackedImageKeys.get(entry.baseKey) === entry
    );
  }

  removeTrackedEntry(entry) {
    if (!entry) return false;
    let removed = false;
    if (trackedImages.get(entry.imageId) === entry) {
      trackedImages.delete(entry.imageId);
      removed = true;
    }
    if (entry.baseKey && trackedImageKeys.get(entry.baseKey) === entry) {
      trackedImageKeys.delete(entry.baseKey);
      removed = true;
    }
    this.releaseAheadProcessing(entry);
    return removed;
  }

  isCurrentSegmentEntry(entry) {
    if (!entry?.isSegment || !this.isCurrentImageEntry(entry)) return false;
    const group = entry.sliceGroup;
    const record = entry.segmentRecord;
    if (
      !group ||
      group.state !== "committed" ||
      group.transaction?.state !== "committed" ||
      this.sliceGroups.get(group.token) !== group ||
      this.sliceGroupsByParent.get(group.parent) !== group ||
      record?.entry !== entry ||
      record?.rawImage !== entry.image
    ) {
      return false;
    }
    const rawToken = entry.image.dataset?.aiEnhancerSliceToken;
    const requiredToken = record?.requiredSliceToken || null;
    if (requiredToken) return rawToken === requiredToken;
    return !rawToken || rawToken === group.token || rawToken === group.transaction?.token;
  }

  rollbackSliceGroup(group, reason = "cancelled", options = {}) {
    if (!group || group.state === "rolledBack") return false;
    group.state = "rolledBack";
    group.reason = reason;
    group.transaction?.rollback?.();
    const cancelJobs = options.cancelJobs !== false;
    for (const record of group.records || []) {
      const entry = record.entry;
      if (entry && this.isCurrentImageEntry(entry)) {
        if (cancelJobs) {
          try {
            chrome.runtime.sendMessage({
              type: "CANCEL_IMAGE",
              imageId: entry.imageId,
              operationId: entry.operationId,
              sourceRevision: entry.sourceRevision,
            });
          } catch {
            // Rollback must finish even when cancellation transport is unavailable.
          }
        }
        this.removeTrackedEntry(entry);
      }
      if (entry?.baseKey) completedImageKeys.delete(entry.baseKey);
    }
    try {
      const cleanup = chrome.runtime.sendMessage({
        type: "REMOVE_IMAGE",
        imageId: group.parentImageId,
        operationId: group.operationId,
      });
      cleanup?.catch?.(() => {});
    } catch {
      // Local rollback must still settle if the extension context is gone.
    }
    this.removeTrackedEntry(group.parentEntry);
    this.sliceGroups.delete(group.token);
    if (this.sliceGroupsByParent.get(group.parent) === group) {
      this.sliceGroupsByParent.delete(group.parent);
    }
    const parent = group.parent;
    if (parent?.dataset?.aiEnhancerOperationId === group.operationId) {
      parent.dataset.aiEnhancerSeen = "false";
      delete parent.dataset.aiEnhancerImageId;
      delete parent.dataset.aiEnhancerOperationId;
      delete parent.dataset.aiEnhancerKey;
    }
    return true;
  }

  isCurrentImageOperation(imageId, operationId, sourceRevision) {
    const entry = trackedImages.get(imageId);
    return Boolean(entry && entry.operationId === operationId && entry.sourceRevision === sourceRevision);
  }

  async enqueueFullImageFallback(image, metadata, imageId, operationId, baseKey, operation, outcome = {}) {
    if (!this.isCurrentKeyOperation(baseKey, operation)) {
      return;
    }

    const pageOrder = Number(image.dataset.aiEnhancerPageOrder) || 0;
    const fallbackEntry = {
      imageId,
      operationId,
      traceId: operation.traceId,
      sourceRevision: baseKey,
      image,
      metadata,
      state: "waiting",
      baseKey,
      isSegment: false,
      pageOrder,
      aheadProcessing: operation.aheadProcessing === true,
      sourceKey: operation.sourceKey || this.processingKey(metadata.imageUrl),
    };
    trackedImageKeys.set(baseKey, fallbackEntry);
    trackedImages.set(imageId, fallbackEntry);
    await this.sendRuntimeMessage({
      type: "PREPROCESSING_FALLBACK",
      imageId,
      operationId,
      traceId: operation.traceId,
      sourceRevision: baseKey,
      pageOrder,
      reason: outcome.reason || "read-fetch-error",
    }, "extension-context-invalidated").catch(() => null);
    if (trackedImages.get(imageId) !== fallbackEntry || trackedImageKeys.get(baseKey) !== fallbackEntry) return;
    let sourceFingerprint = outcome.parentSourceFingerprint || null;
    if (!sourceFingerprint && outcome.imageData) {
      try {
        sourceFingerprint = await this.withTimeout(
          Promise.resolve(this.sourceFingerprint(outcome.imageData)),
          AI_MANGA_UPSCALER_CONFIG.images.sliceFingerprintTimeoutMs,
          "slice-fingerprint-timeout",
        );
      } catch (error) {
        this.failPreprocessingOperation(fallbackEntry, this.reasonFromError(error, "slice-fingerprint-error"));
        return;
      }
    }
    if (trackedImages.get(imageId) !== fallbackEntry || trackedImageKeys.get(baseKey) !== fallbackEntry) return;
    fallbackEntry.sourceFingerprint = sourceFingerprint;
    const enqueueResponse = await this.sendRuntimeMessage({
      type: "ENQUEUE_IMAGE",
      imageId,
      operationId,
      traceId: fallbackEntry.traceId,
      sourceRevision: baseKey,
      sourceFingerprint,
      imageUrl: metadata.imageUrl,
      imageData: outcome.imageData || null,
      cacheVariant: "full",
      pageOrder,
      viewportDistance: this.viewportDistance(image),
      displayMetrics: this.displayMetrics(image),
    }, "segment-enqueue-timeout").catch((error) => ({ accepted: false, error }));
    if (enqueueResponse?.accepted === false) {
      this.failPreprocessingOperation(fallbackEntry, this.reasonFromError(enqueueResponse.error, enqueueResponse.reason || "segment-enqueue-error"));
      return;
    }
    if (this.isCurrentImageEntry(fallbackEntry)) fallbackEntry.state = "waiting";
  }

  createPreprocessingSignal() {
    const listeners = new Set();
    return {
      cancelled: false,
      aborted: false,
      reason: null,
      objectUrls: new Set(),
      addEventListener(type, listener) {
        if (type === "abort") listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === "abort") listeners.delete(listener);
      },
      dispatchAbort() {
        [...listeners].forEach((listener) => listener({ type: "abort" }));
        listeners.clear();
      },
    };
  }

  cancelPreprocessingSignal(signal, reason) {
    if (!signal || signal.cancelled) return;
    signal.cancelled = true;
    signal.aborted = true;
    signal.reason = reason;
    signal.dispatchAbort?.();
  }

  sendPreprocessingStatus(operation, type, state, reason = null) {
    const message = {
      type,
      imageId: operation.imageId,
      operationId: operation.operationId,
      traceId: operation.traceId,
      sourceRevision: operation.sourceRevision,
      imageUrl: operation.metadata?.imageUrl || "",
      pageOrder: operation.pageOrder,
      viewportDistance: this.viewportDistance(operation.image),
      status: state,
      reason,
    };
    if (state === "preprocessing" || ["error", "timeout", "cancelled"].includes(state)) {
      emitTrace({
        event: state === "preprocessing" ? "content.preprocessing.started" : "content.preprocessing.failed",
        traceId: operation.traceId,
        status: state === "preprocessing" ? "running" : state,
        metadata: { reason },
      });
    }
    this.logPreprocessing(state, operation, reason);
    return this.sendRuntimeMessage(message, "extension-context-invalidated").catch(() => null);
  }

  sendRuntimeMessage(message, timeoutReason, timeoutMs = AI_MANGA_UPSCALER_CONFIG.images.segmentEnqueueTimeoutMs) {
    let transport;
    try {
      transport = chrome.runtime.sendMessage(message);
    } catch (error) {
      return Promise.reject(this.preprocessingError("extension-context-invalidated", error?.message || "Extension context is unavailable."));
    }
    return this.withTimeout(Promise.resolve(transport), timeoutMs, timeoutReason);
  }

  failPreprocessingOperation(operation, reason, status = null) {
    if (!operation || !this.isCurrentImageEntry(operation)) return false;
    const terminalStatus = status || (String(reason).includes("timeout") ? "timeout" : "error");
    operation.state = terminalStatus;
    this.cancelPreprocessingSignal(operation.preprocessingSignal, reason);
    this.sendPreprocessingStatus(operation, "PREPROCESSING_FAILED", terminalStatus, reason);
    this.removeTrackedEntry(operation);
    return true;
  }

  deferPreprocessingOperation(operation, reason = "cancelled-outside-prefetch") {
    if (!operation || operation.state !== "preprocessing_queued") return false;
    const waiter = operation.preprocessingWaiter;
    if (waiter) this.cancelPreprocessingWaiter(waiter, reason);
    if (!this.isCurrentImageEntry(operation)) return true;
    operation.state = "seen";
    this.releaseAheadProcessing(operation);
    operation.preprocessingSignal = null;
    this.sendPreprocessingStatus(operation, "PREPROCESSING_DEFERRED", "seen", reason);
    return true;
  }

  logPreprocessing(state, operation, reason = null) {
    if (!reason && globalThis.__AI_MANGA_UPSCALER_DEBUG__ !== true) return;
    console.debug("[AI Enhancer][preprocessing]", {
      imageId: operation?.imageId,
      operationId: operation?.operationId,
      imageUrl: operation?.metadata?.imageUrl,
      state,
      reason,
      pageOrder: operation?.pageOrder,
      viewportDistance: operation?.image ? this.viewportDistance(operation.image) : null,
      queueLength: this.preprocessingWaiters.length,
      activeSlots: this.preprocessingActive,
    });
  }

  isPreprocessingCancelled(signal) {
    return Boolean(signal?.cancelled);
  }

  preprocessingError(reason, message = reason) {
    const error = new Error(message);
    error.reason = reason;
    return error;
  }

  logSliceFailure(reason, details = {}) {
    const payload = {
      imageUrl: details.imageUrl,
      operationId: details.operationId,
      imageWidth: details.imageWidth,
      imageHeight: details.imageHeight,
      sliceIndex: details.sliceIndex,
      segmentCount: details.segmentCount,
      error: this.serializeError(details.error),
    };
    console.warn("[AI Enhancer][slice]", reason, payload);
  }

  serializeError(error) {
    if (!error) return null;
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      reason: error.reason || null,
    };
  }

  reasonFromError(error, fallbackReason) {
    return typeof error?.reason === "string" ? error.reason : fallbackReason;
  }

  normalizeReadResult(result) {
    if (typeof result === "string") {
      return { ok: true, imageData: result };
    }
    if (result?.ok === true) {
      return { ok: true, imageData: result.imageData || "" };
    }
    const rawReason = typeof result?.reason === "string" ? result.reason : "read-fetch-error";
    const reason = rawReason === "read-timeout"
      ? "browser-read-timeout"
      : (rawReason === "read-fetch-error" ? "browser-read-error" : rawReason);
    return {
      ok: false,
      imageData: null,
      reason,
    };
  }

  async sourceFingerprint(imageData) {
    if (!imageData) return null;
    const bytes = this.imageDataToBytes(imageData);
    if (bytes.length <= 4096) {
      return `sha256:${this.sha256Bytes(bytes)}`;
    }
    if (globalThis.crypto?.subtle) {
      try {
        const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
        return `sha256:${this.bytesToHex(new Uint8Array(digest))}`;
      } catch {
        // Continue with the deterministic implementation below.
      }
    }
    return `sha256:${this.sha256Bytes(bytes)}`;
  }

  imageDataToBytes(imageData) {
    try {
      return this.base64ToBytes(imageData);
    } catch {
      return new TextEncoder().encode(String(imageData));
    }
  }

  base64ToBytes(base64Value) {
    const binary = atob(base64Value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  bytesToHex(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  sha256Bytes(bytes) {
    const constants = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    const bitLength = bytes.length * 8;
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);
    const hash = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const words = new Uint32Array(64);
    const rotateRight = (value, count) => (value >>> count) | (value << (32 - count));
    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
      for (let index = 16; index < 64; index += 1) {
        const left = words[index - 15];
        const right = words[index - 2];
        const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
        const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
        words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temporary1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temporary2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }
    const digest = new Uint8Array(32);
    const digestView = new DataView(digest.buffer);
    hash.forEach((value, index) => digestView.setUint32(index * 4, value, false));
    return this.bytesToHex(digest);
  }

  discardSegments(segments) {
    if (!Array.isArray(segments)) return;
    for (const segment of segments) {
      if (typeof segment?.objectUrl === "string") {
        if (typeof this.renderer?.revokeObjectUrl === "function") this.renderer.revokeObjectUrl(segment.objectUrl);
        else URL.revokeObjectURL(segment.objectUrl);
      }
    }
  }

  shouldSliceImage(image) {
    if (!this.imageSlicingEnabled) return false;
    const sourceHeight = image.naturalHeight || 0;
    const renderedHeight = image.getBoundingClientRect().height || image.clientHeight || 0;
    const sourceWidth = image.naturalWidth || 0;
    return sourceWidth > this.imageSliceMaxWidth || sourceHeight > this.imageSliceMaxHeight || renderedHeight > window.innerHeight * 1.8;
  }

  shouldSliceSourceDimensions(dimensions) {
    if (!this.imageSlicingEnabled || !dimensions) return false;
    return dimensions.width > this.imageSliceMaxWidth || dimensions.height > this.imageSliceMaxHeight;
  }

  encodedImageDimensions(imageData) {
    if (typeof imageData !== "string" || !imageData) return null;
    try {
      const bytes = this.base64PrefixToBytes(imageData, 256 * 1024);
      const readUint16Be = (offset) => (bytes[offset] << 8) | bytes[offset + 1];
      const readUint16Le = (offset) => bytes[offset] | (bytes[offset + 1] << 8);
      const readUint24Le = (offset) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
      const readUint32Be = (offset) => (
        (bytes[offset] * 0x1000000) +
        (bytes[offset + 1] << 16) +
        (bytes[offset + 2] << 8) +
        bytes[offset + 3]
      );
      const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));

      if (bytes.length >= 24 && ascii(1, 3) === "PNG") {
        return { width: readUint32Be(16), height: readUint32Be(20) };
      }
      if (bytes.length >= 10 && (ascii(0, 3) === "GIF")) {
        return { width: readUint16Le(6), height: readUint16Le(8) };
      }
      if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
        const chunk = ascii(12, 4);
        if (chunk === "VP8X") {
          return { width: readUint24Le(24) + 1, height: readUint24Le(27) + 1 };
        }
        if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
          return { width: readUint16Le(26) & 0x3fff, height: readUint16Le(28) & 0x3fff };
        }
        if (chunk === "VP8L" && bytes[20] === 0x2f) {
          return {
            width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
            height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
          };
        }
      }
      if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        let offset = 2;
        const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
        while (offset + 8 < bytes.length) {
          while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
          while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
          if (offset >= bytes.length) break;
          const marker = bytes[offset];
          if (sofMarkers.has(marker)) {
            return { width: readUint16Be(offset + 6), height: readUint16Be(offset + 4) };
          }
          if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 1;
            continue;
          }
          if (offset + 2 >= bytes.length) break;
          const segmentLength = readUint16Be(offset + 1);
          if (segmentLength < 2) break;
          offset += segmentLength + 1;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  base64PrefixToBytes(base64Value, maxBytes) {
    const comma = base64Value.indexOf(",");
    const payload = comma >= 0 ? base64Value.slice(comma + 1) : base64Value;
    const requestedCharacters = Math.ceil(maxBytes / 3) * 4;
    const prefixLength = Math.min(payload.length, requestedCharacters);
    const alignedLength = prefixLength - (prefixLength % 4);
    const binary = atob(payload.slice(0, alignedLength || prefixLength));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  canProcessCandidate(image, options = {}) {
    if (!this.isVisibleCandidate(image, options)) {
      return false;
    }
    return this.imageProvider.canProcess(image, {
      allowTallImage: this.imageSlicingEnabled && this.shouldSliceImage(image),
    });
  }

  isVisibleCandidate(image, options = {}) {
    if (!image || image.dataset?.aiEnhancerRawSlice === "true" || image.dataset?.aiEnhancerSliced === "true") {
      return false;
    }
    if (
      image.hidden ||
      (typeof image.getAttribute === "function" && image.getAttribute("hidden") !== null) ||
      (typeof image.getAttribute === "function" && image.getAttribute("aria-hidden") === "true")
    ) {
      return false;
    }
    if (document.documentElement?.contains && !document.documentElement.contains(image)) {
      return false;
    }
    const rect = image.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    const style = typeof getComputedStyle === "function" ? getComputedStyle(image) : image.style || {};
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity ?? 1) <= 0.05) {
      return false;
    }
    const position = style.position || "";
    const viewportArea = Math.max(window.innerWidth || 0, 1) * Math.max(window.innerHeight || 0, 1);
    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth || rect.right) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight || rect.bottom) - Math.max(rect.top, 0));
    const visibleArea = visibleWidth * visibleHeight;
    if (visibleArea <= 0 && options.allowPrefetch !== true) {
      return false;
    }
    if ((position === "fixed" || position === "sticky") && visibleArea / viewportArea > 0.35) {
      return false;
    }
    if (visibleArea <= 0) {
      return true;
    }
    return this.visibleByHitTesting(image, rect);
  }

  visibleByHitTesting(image, rect) {
    if (typeof document.elementsFromPoint !== "function") {
      return true;
    }
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, window.innerWidth || rect.right);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight || rect.bottom);
    const points = [
      [left + (right - left) * 0.5, top + (bottom - top) * 0.2],
      [left + (right - left) * 0.5, top + (bottom - top) * 0.5],
      [left + (right - left) * 0.5, top + (bottom - top) * 0.8],
      [left + (right - left) * 0.25, top + (bottom - top) * 0.5],
      [left + (right - left) * 0.75, top + (bottom - top) * 0.5],
    ];
    let visible = 0;
    for (const [x, y] of points) {
      const stack = document.elementsFromPoint(x, y);
      const relatedIndex = stack.findIndex((element) => (
        element === image || image.contains?.(element) || element?.contains?.(image)
      ));
      if (relatedIndex < 0) continue;
      const blocked = stack.slice(0, relatedIndex).some((element) => {
        if (element === image || image.contains?.(element) || element?.contains?.(image)) return false;
        const style = typeof getComputedStyle === "function" ? getComputedStyle(element) : element?.style || {};
        if (style.pointerEvents === "none") return false;
        if (style.display === "none" || style.visibility === "hidden") return false;
        return Number(style.opacity ?? 1) > 0.05;
      });
      if (!blocked) {
        visible += 1;
      }
    }
    return visible / points.length > 0.4;
  }

  async cropImageSegments(imageData, image, signal = null) {
    let source;
    try {
      source = await this.withTimeout(
        Promise.resolve(this.decodeBase64Image(imageData)),
        AI_MANGA_UPSCALER_CONFIG.images.sliceDecodeTimeoutMs,
        "slice-decode-timeout",
      );
    } catch (error) {
      throw this.preprocessingError("slice-decode-error", error?.message || "Unable to decode displayed image for segmentation.");
    }
    if (this.isPreprocessingCancelled(signal)) {
      throw this.preprocessingError(signal.reason || "cancelled");
    }
    const renderedHeight = image.getBoundingClientRect().height || image.clientHeight || source.height;
    const renderedWidth = image.getBoundingClientRect().width || image.clientWidth || source.width;
    const sourcePerRenderedPixel = source.height / Math.max(renderedHeight, 1);
    const screenSourceHeight = Math.round((window.innerHeight || 900) * 1.25 * sourcePerRenderedPixel);
    const segmentSourceHeight = Math.min(Math.max(screenSourceHeight, 512), this.imageSliceMaxHeight);
    const segmentSourceWidth = Math.min(Math.max(this.imageSliceMaxWidth, 512), source.width);
    const renderedPerSourcePixel = renderedHeight / source.height;
    const renderedWidthPerSourcePixel = renderedWidth / source.width;
    const segments = [];
    try {
      let index = 0;
      for (let sourceY = 0; sourceY < source.height; sourceY += segmentSourceHeight) {
        for (let sourceX = 0; sourceX < source.width; sourceX += segmentSourceWidth) {
          if (this.isPreprocessingCancelled(signal)) {
            throw this.preprocessingError(signal.reason || "cancelled");
          }
          const sourceWidth = Math.min(segmentSourceWidth, source.width - sourceX);
          const sourceHeight = Math.min(segmentSourceHeight, source.height - sourceY);
          const canvas = document.createElement("canvas");
          canvas.width = sourceWidth;
          canvas.height = sourceHeight;
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) {
            throw this.preprocessingError("slice-crop-error", "Unable to create image segment canvas.");
          }
          try {
            context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
          } catch (error) {
            throw this.preprocessingError("slice-crop-error", error?.message || "Unable to crop image segment.");
          }
          const payload = await this.withTimeout(
            Promise.resolve(this.canvasToSegmentPayload(canvas, signal)),
            AI_MANGA_UPSCALER_CONFIG.images.sliceEncodeTimeoutMs,
            "slice-encode-timeout",
          );
          if (this.isPreprocessingCancelled(signal)) {
            this.discardSegments([payload]);
            throw this.preprocessingError(signal.reason || "cancelled");
          }
          segments.push({
            index,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            renderedLeft: sourceX * renderedWidthPerSourcePixel,
            renderedTop: sourceY * renderedPerSourcePixel,
            renderedWidth: sourceWidth * renderedWidthPerSourcePixel,
            renderedHeight: sourceHeight * renderedPerSourcePixel,
            ...payload,
          });
          index += 1;
          const hasMoreSegments = sourceX + sourceWidth < source.width || sourceY + sourceHeight < source.height;
          if (hasMoreSegments) await this.yieldToBrowser();
        }
      }
    } catch (error) {
      this.discardSegments(segments);
      throw error;
    }
    return segments;
  }

  async yieldToBrowser() {
    if (typeof globalThis.scheduler?.yield === "function") {
      try {
        await globalThis.scheduler.yield();
        return;
      } catch {
        // Fall through when the page exposes an incompatible scheduler object.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  decodeBase64Image(imageData) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(this.preprocessingError("slice-decode-error", "Unable to decode displayed image for segmentation."));
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

  canvasToSegmentPayload(canvas, signal = null) {
    return new Promise((resolve, reject) => {
      if (this.isPreprocessingCancelled(signal)) {
        reject(this.preprocessingError(signal.reason || "cancelled"));
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(this.preprocessingError("slice-encode-error", "Unable to encode image segment."));
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        signal?.objectUrls?.add(objectUrl);
        if (this.isPreprocessingCancelled(signal)) {
          URL.revokeObjectURL(objectUrl);
          reject(this.preprocessingError(signal.reason || "cancelled"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          if (this.isPreprocessingCancelled(signal)) {
            URL.revokeObjectURL(objectUrl);
            reject(this.preprocessingError(signal.reason || "cancelled"));
            return;
          }
          resolve({
            objectUrl,
            imageData: String(reader.result).split(",", 2)[1] || "",
          });
        };
        reader.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(this.preprocessingError("slice-encode-error", "Unable to read image segment."));
        };
        reader.readAsDataURL(blob);
      }, "image/png");
    });
  }

  withTimeout(promise, timeoutMs, reason, onTimeout = null) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (onTimeout) onTimeout();
        reject(this.preprocessingError(reason));
      }, timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }

  processingKey(imageUrl) {
    try {
      const url = new URL(imageUrl, document.baseURI);
      const segment = url.hash.startsWith("#ai-segment-") ? url.hash : "";
      url.hash = segment;
      url.searchParams.sort();
      return url.toString();
    } catch {
      return imageUrl;
    }
  }

  claimSourceOwner(entry) {
    const sourceKey = entry?.sourceKey || this.processingKey(entry?.metadata?.imageUrl || "");
    if (!entry || !sourceKey) return true;
    const owner = this.sourceOwners.get(sourceKey);
    const ownerAttached = !owner?.image || !document.documentElement?.contains || document.documentElement.contains(owner.image);
    if (!owner || owner.image === entry.image || !ownerAttached) {
      const previousSourceKey = this.sourceOwnerKeysByImage.get(entry.image);
      if (previousSourceKey && previousSourceKey !== sourceKey && this.sourceOwners.get(previousSourceKey)?.image === entry.image) {
        this.sourceOwners.delete(previousSourceKey);
      }
      entry.sourceKey = sourceKey;
      entry.duplicateSource = false;
      delete entry.duplicateOwnerBaseKey;
      this.sourceOwners.set(sourceKey, { image: entry.image, baseKey: entry.baseKey });
      this.sourceOwnerKeysByImage.set(entry.image, sourceKey);
      return true;
    }
    entry.sourceKey = sourceKey;
    entry.duplicateSource = true;
    entry.duplicateOwnerBaseKey = owner.baseKey;
    entry.aheadProcessing = false;
    entry.state = "duplicate";
    return false;
  }

  releaseAheadProcessing(entry, { pump = true } = {}) {
    if (!entry) return false;
    const baseKey = entry.baseKey;
    const ownedImage = baseKey ? this.aheadProcessingKeys.get(baseKey) : null;
    const released = entry.aheadProcessing === true || ownedImage === entry.image;
    entry.aheadProcessing = false;
    if (baseKey && ownedImage === entry.image) this.aheadProcessingKeys.delete(baseKey);
    if (released && pump) this.scheduleAheadProcessing();
    return released;
  }

  imageKey(metadata, image) {
    const normalizedUrl = this.processingKey(metadata.imageUrl);
    const rect = image.getBoundingClientRect();
    const width = Math.round(metadata.width || rect.width || image.naturalWidth || 0);
    const height = Math.round(metadata.height || rect.height || image.naturalHeight || 0);
    const sourceWidth = image.naturalWidth || width;
    const sourceHeight = image.naturalHeight || height;
    const sourceGeneration = image.dataset?.aiEnhancerSourceGeneration || "0";
    return `${this.pageGeneration}|${normalizedUrl}|${sourceWidth}x${sourceHeight}|render:${width}x${height}|gen:${sourceGeneration}`;
  }

  createImageId(imageKey) {
    let hash = 0;
    for (let index = 0; index < imageKey.length; index += 1) {
      hash = ((hash << 5) - hash + imageKey.charCodeAt(index)) | 0;
    }
    return `ai-image-${Math.abs(hash).toString(36)}-${this.sequence++}`;
  }

  createOperationId(imageId) {
    return `${imageId}-op-${this.sequence++}`;
  }

  acquirePreprocessingSlot(operation) {
    const viewportDistance = this.viewportDistance(operation.image);
    const waiter = {
      imageId: operation.imageId,
      operationId: operation.operationId,
      image: operation.image,
      operation,
      pageOrder: Number(operation.pageOrder) || 0,
      priorityTier: this.preprocessingPriorityTier(operation, viewportDistance),
      viewportDistance,
      queuedAt: performance.now(),
      resolve: null,
      cancelled: false,
      timeoutId: null,
    };
    operation.preprocessingWaiter = waiter;
    const promise = new Promise((resolve) => { waiter.resolve = resolve; });
    waiter.timeoutId = setTimeout(() => {
      if (waiter.cancelled || waiter.acquired) return;
      this.cancelPreprocessingWaiter(waiter, "preprocessing-queue-timeout");
      if (this.isCurrentImageEntry(operation)) {
        this.failPreprocessingOperation(operation, "preprocessing-queue-timeout", "timeout");
      }
    }, AI_MANGA_UPSCALER_CONFIG.images.preprocessingQueueTimeoutMs);
    this.preprocessingWaiters.push(waiter);
    this.drainPreprocessingQueue();
    return promise;
  }

  drainPreprocessingQueue() {
    this.preprocessingWaiters.sort((left, right) => (
      left.priorityTier - right.priorityTier ||
      left.viewportDistance - right.viewportDistance ||
      left.pageOrder - right.pageOrder ||
      left.queuedAt - right.queuedAt
    ));
    while (this.preprocessingActive < this.preprocessingConcurrency && this.preprocessingWaiters.length) {
      const waiter = this.preprocessingWaiters.shift();
      if (!waiter || waiter.cancelled || !this.isCurrentImageEntry(waiter.operation)) {
        if (waiter) {
          clearTimeout(waiter.timeoutId);
          waiter.resolve?.(null);
        }
        continue;
      }
      waiter.acquired = true;
      clearTimeout(waiter.timeoutId);
      waiter.operation.preprocessingWaiter = null;
      this.preprocessingActive += 1;
      let released = false;
      waiter.resolve(() => {
        if (released) return false;
        released = true;
        this.preprocessingActive = Math.max(0, this.preprocessingActive - 1);
        this.drainPreprocessingQueue();
        return true;
      });
    }
  }

  cancelPreprocessingWaiter(waiter, reason = "cancelled") {
    if (!waiter || waiter.cancelled || waiter.acquired) return false;
    waiter.cancelled = true;
    waiter.reason = reason;
    clearTimeout(waiter.timeoutId);
    const index = this.preprocessingWaiters.indexOf(waiter);
    if (index >= 0) this.preprocessingWaiters.splice(index, 1);
    if (waiter.operation?.preprocessingWaiter === waiter) waiter.operation.preprocessingWaiter = null;
    waiter.resolve?.(null);
    return true;
  }

  releasePreprocessingSlot(release) {
    return typeof release === "function" ? release() : false;
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
    try {
      if (!chrome?.runtime?.sendMessage) {
        return { ok: false, imageData: null, reason: "read-fetch-error" };
      }
      const response = await this.sendRuntimeMessage({
        type: "READ_IMAGE_FOR_SLICING",
        imageUrl,
      }, "browser-read-timeout", AI_MANGA_UPSCALER_CONFIG.images.browserReadTimeoutMs);
      if (!response || typeof response !== "object") {
        return { ok: false, imageData: null, reason: "read-fetch-error" };
      }
      return response.ok === true
        ? { ok: true, imageData: response.imageData || "" }
        : {
            ok: false,
            imageData: null,
            reason: typeof response.reason === "string" ? response.reason : "browser-read-error",
          };
    } catch (error) {
      return {
        ok: false,
        imageData: null,
        reason: this.reasonFromError(
          error,
          /context invalidated|receiving end|message port closed/i.test(error?.message || "")
            ? "extension-context-invalidated"
            : "browser-read-error",
        ),
      };
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

    // IntersectionObserver promotes discovered images. Scroll work only
    // reprioritizes the bounded preprocessing queue that is actually waiting.
    for (const waiter of [...this.preprocessingWaiters]) {
      const entry = waiter?.operation;
      if (!entry || entry.state !== "preprocessing_queued" || !entry.image) continue;
      const distance = this.viewportDistance(entry.image);
      waiter.viewportDistance = distance;
      waiter.priorityTier = this.preprocessingPriorityTier(entry, distance);
      this.updateImagePriority(entry.image, entry.imageId);
      if (distance <= this.prefetchMarginPx && entry.aheadProcessing === true) {
        this.releaseAheadProcessing(entry);
      }
      if (entry.aheadProcessing !== true && distance > AI_MANGA_UPSCALER_CONFIG.images.cancelDistancePx) {
        this.deferPreprocessingOperation(entry, "cancelled-outside-prefetch");
      }
    }
    this.drainPreprocessingQueue();
  }

  runInitialAheadProcessing() {
    return this.handlePageLoaded();
  }

  handlePageLoaded() {
    if (this.pageLoadHandled || this.pageHidden || !this.enabled || !isActiveContentInstance()) return false;
    this.observeExistingImages();
    this.pageLoadHandled = true;
    this.aheadProcessingCompleted = true;
    this.initialAheadQueue = [];
    if (this.aheadProcessingEnabled && this.aheadProcessingImageLimit > 0) {
      const candidates = [...trackedImageKeys.values()]
        .filter((entry) => (
          entry.state === "seen" &&
          entry.image &&
          this.canProcessCandidate(entry.image, { allowPrefetch: true })
        ))
        .map((entry) => ({
          entry,
          distance: this.viewportDistance(entry.image),
          pageOrder: Number(entry.pageOrder || 0),
        }))
        .sort((left, right) => left.distance - right.distance || left.pageOrder - right.pageOrder);
      for (const candidate of candidates) {
        const entry = candidate.entry;
        if (!this.claimSourceOwner(entry)) continue;
        this.initialAheadQueue.push({
          image: entry.image,
          baseKey: entry.baseKey,
          sourceKey: entry.sourceKey,
        });
      }
    }
    this.scheduleAheadProcessing();
    return true;
  }

  scheduleAheadProcessing() {
    if (this.pageHidden || !this.enabled || !this.aheadProcessingEnabled || this.aheadProcessingImageLimit <= 0) return;

    while (this.aheadProcessingKeys.size < this.aheadProcessingImageLimit && this.initialAheadQueue.length) {
      const queued = this.initialAheadQueue.shift();
      const entry = trackedImageKeys.get(queued.baseKey);
      const isAttached = !document.documentElement?.contains || document.documentElement.contains(queued.image);
      if (
        !entry ||
        entry.image !== queued.image ||
        entry.state !== "seen" ||
        entry.sourceKey !== queued.sourceKey ||
        !isAttached ||
        !this.claimSourceOwner(entry)
      ) {
        continue;
      }
      this.schedule(entry.image, true, { allowPrefetch: true, aheadProcessing: true });
    }
  }

  preprocessingPriorityTier(operation, distance = this.viewportDistance(operation.image)) {
    if (distance === 0) return 0;
    if (operation?.aheadProcessing === true && distance > this.prefetchMarginPx) return 2;
    return 1;
  }

  updateImagePriority(image, imageId = null) {
    const entry = imageId ? trackedImages.get(imageId) : this.findByImage(image);
    const targetId = entry?.imageId || imageId || image.dataset.aiEnhancerImageId;
    if (!targetId) return;
    chrome.runtime.sendMessage({
      type: "UPDATE_PRIORITY",
      imageId: targetId,
      operationId: entry?.operationId || image.dataset.aiEnhancerOperationId || null,
      viewportDistance: this.viewportDistance(image),
    });
  }

  async complete(message) {
    const entry = trackedImages.get(message.imageId);
    if (!this.isCurrentMessage(entry, message) || (entry?.isSegment && !this.isCurrentSegmentEntry(entry))) {
      return "stale";
    }

    entry.state = "processing";
    this.sendMonitorMessage({
      type: "RENDER_STARTED",
      imageId: entry.imageId,
      operationId: entry.operationId,
      sourceRevision: entry.sourceRevision,
      sourceFingerprint: entry.sourceFingerprint || null,
      traceId: entry.traceId || message.traceId,
      imageUrl: entry.metadata?.imageUrl || message.imageUrl || "",
      cacheHit: Boolean(message.cacheHit),
    });
    const isCurrent = () => {
      const currentEntry = trackedImages.get(message.imageId);
      return this.isCurrentMessage(currentEntry, message) && (!currentEntry?.isSegment || this.isCurrentSegmentEntry(currentEntry));
    };
    const renderOutcome = await this.renderer.render(entry.image, message, isCurrent);
    const outcome = renderOutcome || "rendered";
    if (!isCurrent()) {
      return "stale";
    }
    if (outcome === "stale") {
      entry.state = "waiting";
      this.sendMonitorMessage({
        type: "RENDER_FAILED",
        imageId: entry.imageId,
        operationId: entry.operationId,
        sourceRevision: entry.sourceRevision,
        sourceFingerprint: entry.sourceFingerprint || null,
        traceId: entry.traceId || message.traceId,
        imageUrl: entry.metadata?.imageUrl || message.imageUrl || "",
        outcome,
      });
      return "stale";
    }
    if (outcome === "load-error") {
      if (entry.sliceGroup) this.rollbackSliceGroup(entry.sliceGroup, "segment-load-error");
      else this.removeTrackedEntry(entry);
      this.sendMonitorMessage({
        type: "RENDER_FAILED",
        imageId: entry.imageId,
        operationId: entry.operationId,
        sourceRevision: entry.sourceRevision,
        sourceFingerprint: entry.sourceFingerprint || null,
        traceId: entry.traceId || message.traceId,
        imageUrl: entry.metadata?.imageUrl || message.imageUrl || "",
        outcome,
      });
      return "load-error";
    }
    if (entry.sliceGroup) {
      const group = entry.sliceGroup;
      group.completed.add(entry.segmentRecord);
      if (group.completed.size === group.records.length) this.releaseAheadProcessing(group.parentEntry);
    }
    this.removeTrackedEntry(entry);
    if (entry.baseKey) {
      completedImageKeys.add(entry.baseKey);
    }
    emitTrace({
      event: "content.render.completed",
      traceId: entry.traceId || message.traceId,
      status: "completed",
      metadata: { cache_hit: Boolean(message.cacheHit) },
    });
    this.sendMonitorMessage({
      type: "RENDER_COMMITTED",
      imageId: entry.imageId,
      operationId: entry.operationId,
      sourceRevision: entry.sourceRevision,
      sourceFingerprint: entry.sourceFingerprint || null,
      traceId: entry.traceId || message.traceId,
      imageUrl: entry.metadata?.imageUrl || message.imageUrl || "",
      cacheHit: Boolean(message.cacheHit),
    });
    return "rendered";
  }

  sendMonitorMessage(message) {
    try {
      Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => null);
    } catch {
      // Monitoring must never block or invalidate the page render transaction.
    }
  }

  isCurrentMessage(entry, message) {
    return Boolean(
      entry &&
      entry.operationId === message.operationId &&
      entry.sourceRevision === message.sourceRevision &&
      (entry.sourceFingerprint || null) === (message.sourceFingerprint || null)
    );
  }

  fail(imageId, permanent = false, operationId = null, sourceRevision = null) {
    const entry = trackedImages.get(imageId);
    if (!entry || entry.operationId !== operationId || entry.sourceRevision !== sourceRevision) {
      return;
    }
    if (entry.sliceGroup) {
      this.rollbackSliceGroup(entry.sliceGroup, permanent ? "segment-permanent-failure" : "segment-failure");
      return;
    }
    emitTrace({
      event: "content.preprocessing.failed",
      traceId: entry.traceId,
      status: permanent ? "failed" : "retrying",
      metadata: { permanent },
    });
    if (entry && permanent && entry.baseKey) completedImageKeys.add(entry.baseKey);
    this.removeTrackedEntry(entry);
  }

  cancel(entry) {
    if (!entry) return;
    if (entry.sliceGroup) {
      this.rollbackSliceGroup(entry.sliceGroup, "cancelled");
      return;
    }
    const parentGroup = entry.image ? this.sliceGroupsByParent.get(entry.image) : null;
    if (parentGroup) {
      this.rollbackSliceGroup(parentGroup, "cancelled");
      return;
    }
    if (entry.preprocessingWaiter) this.cancelPreprocessingWaiter(entry.preprocessingWaiter, "cancelled");
    chrome.runtime.sendMessage({
      type: "CANCEL_IMAGE",
      imageId: entry.imageId,
      operationId: entry.operationId,
      traceId: entry.traceId,
      sourceRevision: entry.sourceRevision,
    });
    emitTrace({
      event: "content.operation.cancelled",
      traceId: entry.traceId,
      status: "cancelled",
      metadata: {},
    });
    this.cancelPreprocessingSignal(entry.preprocessingSignal, "cancelled");
    this.removeTrackedEntry(entry);
  }

  retryImage(imageId, operationId) {
    let entry = trackedImages.get(imageId);
    if (entry && operationId && entry.operationId !== operationId) return false;
    let image = entry?.image || null;
    if (!image) {
      image = [...document.querySelectorAll("img")].find((candidate) => candidate.dataset?.aiEnhancerImageId === imageId) || null;
    }
    if (!image) return false;
    if (entry) this.cancel(entry);
    const key = image.dataset.aiEnhancerKey;
    if (key) {
      trackedImageKeys.delete(key);
      completedImageKeys.delete(key);
    }
    delete image.dataset.aiEnhancerOperationId;
    delete image.dataset.aiEnhancerTraceId;
    this.schedule(image, true, { allowPrefetch: true });
    const newOperationId = image.dataset.aiEnhancerOperationId || null;
    return {
      retried: Boolean(newOperationId && newOperationId !== operationId),
      operationId: newOperationId,
      traceId: image.dataset.aiEnhancerTraceId || null,
    };
  }

  cleanupRemovedNode(node) {
    if (!(node instanceof Node)) return;
    const removedImages = [];
    if (node instanceof HTMLImageElement) removedImages.push(node);
    if (node instanceof HTMLElement) {
      removedImages.push(...node.querySelectorAll("img"));
    }
    for (const image of removedImages) {
      this.stopObservingImage(image);
      if (image.dataset?.aiEnhancerKey) this.aheadProcessingKeys.delete(image.dataset.aiEnhancerKey);
      const parentGroup = this.sliceGroupsByParent.get(image);
      const preserveCommittedSliceParent = Boolean(
        parentGroup &&
        parentGroup.state === "committed" &&
        image.dataset?.aiEnhancerSliced === "true"
      );
      const entry = this.findByImage(image);
      if (entry && !preserveCommittedSliceParent) {
        this.cancel(entry);
      }
      for (const [key, keyedEntry] of trackedImageKeys.entries()) {
        if (preserveCommittedSliceParent && keyedEntry === parentGroup.parentEntry) {
          continue;
        }
        if (keyedEntry.image === image) {
          chrome.runtime.sendMessage({ type: "REMOVE_IMAGE", imageId: keyedEntry.imageId, operationId: keyedEntry.operationId }).catch(() => {});
          trackedImageKeys.delete(key);
          completedImageKeys.delete(key);
        }
      }
      if (image.dataset?.aiEnhancerKey) {
        completedImageKeys.delete(image.dataset.aiEnhancerKey);
      }
      if (image.dataset?.aiEnhancerImageId) {
        const byId = trackedImages.get(image.dataset.aiEnhancerImageId);
        if (!preserveCommittedSliceParent && byId?.image === image && byId.operationId === image.dataset.aiEnhancerOperationId) this.cancel(byId);
      }
    }
  }

  findByImage(image) {
    return [...trackedImages.values()].find((entry) => entry.image === image) || null;
  }

  findKeyEntryByImage(image) {
    for (const [baseKey, entry] of trackedImageKeys.entries()) {
      if (entry.image === image) {
        return { baseKey, entry };
      }
    }
    return null;
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

  isWithinPrefetch(image) {
    return this.viewportDistance(image) <= this.prefetchMarginPx;
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
    [...trackedImages.values()]
      .filter((entry) => viewportProvider.isBlacklisted(entry.metadata?.imageUrl))
      .forEach((entry) => viewportProvider.cancel(entry));
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
    viewportProvider.drainPreprocessingQueue();
  }
  if (areaName === "local" && (changes.aheadProcessingEnabled || changes.aheadProcessingImageLimit || changes.prefetchMarginPx)) {
    chrome.storage.local.get({
      aheadProcessingEnabled: AI_MANGA_UPSCALER_CONFIG.images.aheadProcessingEnabled,
      aheadProcessingImageLimit: AI_MANGA_UPSCALER_CONFIG.images.aheadProcessingImageLimit,
      prefetchMarginPx: AI_MANGA_UPSCALER_CONFIG.images.prefetchMarginPx,
    }).then((settings) => {
      viewportProvider.aheadProcessingEnabled = settings.aheadProcessingEnabled !== false;
      viewportProvider.aheadProcessingImageLimit = Math.max(1, Number(settings.aheadProcessingImageLimit) || AI_MANGA_UPSCALER_CONFIG.images.aheadProcessingImageLimit);
      viewportProvider.prefetchMarginPx = Math.max(0, Number(settings.prefetchMarginPx) || 0);
      if (!viewportProvider.aheadProcessingEnabled) {
        viewportProvider.initialAheadQueue = [];
        [...trackedImages.values()]
          .filter((entry) => entry.aheadProcessing === true)
          .forEach((entry) => viewportProvider.cancel(entry));
        viewportProvider.aheadProcessingKeys.clear();
      }
      viewportProvider.refreshPriorities();
      viewportProvider.scheduleAheadProcessing();
    });
  }
  if (areaName === "local" && (changes.imageSlicingEnabled || changes.imageSliceMaxWidth || changes.imageSliceMaxHeight)) {
    chrome.storage.local.get({
      imageSlicingEnabled: AI_MANGA_UPSCALER_CONFIG.images.slicingEnabled,
      imageSliceMaxWidth: AI_MANGA_UPSCALER_CONFIG.images.sliceMaxWidthPx,
      imageSliceMaxHeight: AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx,
    }).then((settings) => {
      viewportProvider.imageSlicingEnabled = settings.imageSlicingEnabled !== false;
      viewportProvider.imageSliceMaxWidth = Number(settings.imageSliceMaxWidth) || AI_MANGA_UPSCALER_CONFIG.images.sliceMaxWidthPx;
      viewportProvider.imageSliceMaxHeight = Number(settings.imageSliceMaxHeight) || AI_MANGA_UPSCALER_CONFIG.images.sliceMaxHeightPx;
      viewportProvider.reprocessVisibleImages();
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isActiveContentInstance()) return false;
  if (message.type === "AI_ENHANCER_PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "UPSCALE_COMPLETE") {
    viewportProvider.complete(message);
  }

  if (message.type === "UPSCALE_FAILED") {
    viewportProvider.fail(message.imageId, Boolean(message.permanent), message.operationId, message.sourceRevision);
  }

  if (message.type === "RETRY_IMAGE") {
    sendResponse(viewportProvider.retryImage(message.imageId, message.operationId));
    return false;
  }

  if (message.type === "CANCEL_IMAGE") {
    const entry = trackedImages.get(message.imageId);
    if (!entry || entry.operationId !== message.operationId) {
      sendResponse({ canceled: false, stale: true });
      return false;
    }
    viewportProvider.cancel(entry);
    sendResponse({ canceled: true });
    return false;
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
}
