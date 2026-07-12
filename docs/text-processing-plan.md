# Text cleanup, OCR, translation, and re-render plan

This project now has a safe local foundation for text processing.  The current
backend can detect text-like marks on light comic regions, clean those marks,
report OCR/translation capability, and expose the result through API fields.

## Goal

Turn manga/webtoon images into a readable translated result without damaging the
reading experience:

1. detect speech bubbles, captions, signs, watermarks, and handwritten SFX;
2. OCR the original text without guessing;
3. translate the text through a configured provider;
4. remove or inpaint old text;
5. render translated text back into the same region with wrapping and font fit;
6. run AI upscaling after cleanup/render so the final page looks coherent.

## Current implementation

- `TextProcessor` performs local visual cleanup using Pillow and NumPy only.
- `/text/capabilities` reports whether cleanup, OCR, and translation are
  actually available.
- `/text/process` processes a browser-supplied image independently of upscaling.
- `/upscale` accepts `textProcessing` options so extension jobs can enable text
  cleanup before model inference.
- Popup and dashboard expose text cleanup/translation toggles and language
  selectors.

## Required engine before real translation can be enabled

The current machine does not have an OCR engine installed.  Translation must
remain disabled until both are true:

- OCR is available, for example Tesseract executable + `pytesseract` package, or
  an ONNX OCR model integrated into the backend.
- Translation provider is configured, either a local model or an explicit remote
  API chosen by the user.

The backend intentionally reports `translationApplied=false` when those pieces
are missing.  It must never fabricate translated text.

## Production stages

### Stage 1: Safe cleanup

- Detect only dark glyph-like pixels in bright local backgrounds.
- Use conservative masks to avoid damaging character art.
- Keep cleanup optional and cache-keyed so old AI cache cannot be mixed with
  text-processed cache.

### Stage 2: OCR

- Add a real OCR provider interface.
- Prefer ONNX-compatible OCR for the final production architecture.
- Tesseract can be used as a local bootstrap provider if installed.
- Return OCR confidence and bounding boxes per region.

### Stage 3: Translation

- Add a translation provider interface with explicit provider name and health.
- Do not send images/text to remote APIs unless the user configures that.
- Cache translations by text hash, source language, target language, and provider.

### Stage 4: Re-render

- Remove old text using region-level inpainting/cleanup.
- Fit translated text into each bubble with font-size search and line wrapping.
- Preserve orientation where possible.
- Store before/after metadata for dashboard review.

### Stage 5: Visual QA

- For each real page, compare original, cleaned, and rendered images.
- Fail closed: if OCR confidence is low, keep original text rather than rendering
  bad translation.
- Dashboard should show warnings per image.

## Current known limitation

Without OCR installed, the system can only clean/dim detected text-like marks.
It cannot know what the text says, so translation and final re-render are
correctly skipped.
