import { DOM } from "../ui/dom.js";
import { syncCustomSelect } from "../ui/components.js";
import { state, serializableGenerator } from "../state";
import { getQrCode, buildQrStylingOptions } from "./qr-instance.js";
import { renderSvg } from "./svg-pipeline.js";
import { resolveLayout } from "./layout.js";
import { framesConfig } from "../frames";
import { frameTextFill, frameFontSignature } from "./frame.js";
import { setRenderInfo, getRenderInfo } from "./render-info.js";
import { readabilityHintDescriptor, modulePixelSize, isTooSmallToScan } from "./readability.js";
import { ensureQrcodeLoaded } from "./encoder.js";
import { DEBOUNCE_GENERATE_MS } from "../constants.js";
import { announce } from "../ui/announce.js";
import { t } from "../i18n.js";
import { DATA_TYPES } from "./data-types.js";

function toggleWarning(el, show) {
  if (!el) return;
  el.classList.toggle("hidden", !show);
}

function setAriaInvalid(el, invalid) {
  if (el) el.setAttribute("aria-invalid", invalid ? "true" : "false");
}

function setWarning(el, show, relatedInput) {
  toggleWarning(el, show);
  if (relatedInput) setAriaInvalid(relatedInput, show);
}

export const compileDataString = (autoGen = true, showWarnings = true) => {
  let str = "";
  state.generator.isValid = true;
  const def = DATA_TYPES[state.generator.dataType];
  if (def) {
    const result = def.compile({ DOM, showWarnings, setWarning, setAriaInvalid });
    str = result.str;
    state.generator.isValid = result.isValid;
  }
  state.generator.dataString = str;
  if (autoGen) generateQR();
};

export function syncConfigToUI() {
  suppressGenerationDuringSync = true;
  if (DOM.qrWidth) DOM.qrWidth.value = state.generator.width;
  if (DOM.qrHeight) DOM.qrHeight.value = state.generator.height;
  if (DOM.qrRadius) DOM.qrRadius.value = state.generator.qrRadius;
  if (DOM.qrMargin) DOM.qrMargin.value = state.generator.margin;
  if (DOM.qrBgTransparent) {
    DOM.qrBgTransparent.checked = !state.generator.bgTransparent;
    DOM.qrBgTransparent.dispatchEvent(new Event("change"));
  }
  if (DOM.logoMargin) DOM.logoMargin.value = state.generator.imageMargin;
  if (DOM.logoSize) DOM.logoSize.value = state.generator.logoSizeProportion;
  if (DOM.qrFrameText) DOM.qrFrameText.value = state.generator.frameText;
  if (DOM.qrFrameSize) DOM.qrFrameSize.value = String(state.generator.frameTextSize);
  if (DOM.qrFrameTextEnabled) DOM.qrFrameTextEnabled.checked = Boolean(state.generator.frameTextEnabled);
  if (DOM.qrFrameText) DOM.qrFrameText.disabled = !state.generator.frameTextEnabled;
  if (DOM.qrFrameSize) DOM.qrFrameSize.disabled = !state.generator.frameTextEnabled;
  if (DOM.colorFrameText) {
    const framePaint = state.generator.frameColor || state.generator.dotsColor;
    DOM.colorFrameText.value = framePaint.toUpperCase();
    const frameSwatch = document.getElementById("swatch-bg-frame");
    if (frameSwatch) frameSwatch.style.background = framePaint;
  }
  if (DOM.colorFrameTextColor) {
    const frameConfig = framesConfig[state.generator.frameStyle];
    const frameTextPaint = state.generator.frameTextColor || frameTextFill(frameConfig);
    DOM.colorFrameTextColor.value = frameTextPaint.toUpperCase();
    const frameTextSwatch = document.getElementById("swatch-bg-frame-text");
    if (frameTextSwatch) frameTextSwatch.style.background = frameTextPaint;
  }
  const selects = [
    { el: DOM.qrEcc, val: state.generator.ecc },
    { el: DOM.qrShapeBody, val: state.generator.shapeBody },
    { el: DOM.qrShapeOuter, val: state.generator.shapeOuter },
    { el: DOM.qrShapeInner, val: state.generator.shapeInner },
    { el: DOM.qrMaskType, val: state.generator.maskType },
    { el: DOM.qrFrameStyle, val: state.generator.frameStyle },
    { el: DOM.qrFrameFont, val: state.generator.frameFont },
    { el: DOM.dataType, val: state.generator.dataType },
  ];
  selects.forEach((s) => {
    if (s.el) {
      s.el.value = s.val;
      syncCustomSelect(s.el);
      s.el.dispatchEvent(new Event("change"));
    }
  });

  const colors = [
    { el: DOM.colorBgText, val: state.generator.bgColor },
    { el: DOM.colorDotsText, val: state.generator.dotsColor },
    { el: DOM.colorCornersSquareText, val: state.generator.cornersSquareColor },
    { el: DOM.colorCornersDotText, val: state.generator.cornersDotColor },
  ];
  colors.forEach((c) => {
    if (c.el) {
      c.el.value = c.val;
      c.el.dispatchEvent(new Event("input"));
    }
  });

  if (DOM.qrMaskCustom) DOM.qrMaskCustom.value = state.generator.maskCustom;
  if (DOM.logoUrl && state.generator.logoFilename === "url") DOM.logoUrl.value = state.generator.logoDataUrl;
  else if (DOM.logoUrl) DOM.logoUrl.value = "";

  if (state.generator.logoDataUrl) {
    DOM.logoOptions.classList.remove("opacity-50", "pointer-events-none");
    DOM.btnClearLogo.classList.remove("hidden");
  } else {
    DOM.logoOptions.classList.add("opacity-50", "pointer-events-none");
    DOM.btnClearLogo.classList.add("hidden");
  }

  suppressGenerationDuringSync = false;
  if (generationQueuedDuringSync) {
    generationQueuedDuringSync = false;
    generateQR();
  }
}

/**
 * Stable config signature for the "is the current config already saved?" check.
 * Includes a lightweight logo fingerprint so logo adjustments enable the Save button.
 */
function configSignature(cfg) {
  const s = serializableGenerator(cfg);
  const { logoDataUrl: logo, bgImageDataUrl: bgImage, fields: _fields, isValid: _isValid, ...rest } = s;
  void _fields;
  void _isValid;
  const logoFp = logo ? `${logo.length}_${logo.slice(0, 32)}_${logo.slice(-32)}` : "";
  const bgFp = bgImage ? `${bgImage.length}_${bgImage.slice(0, 32)}_${bgImage.slice(-32)}` : "";
  return JSON.stringify({ ...rest, logoFp, bgFp });
}

function isCurrentConfigSaved() {
  if (!state.generatorHistory || state.generatorHistory.length === 0) return false;
  const currentSig = configSignature(state.generator);
  return state.generatorHistory.some((item) => {
    if (!item || !item.config) return false;
    return configSignature(item.config) === currentSig;
  });
}

// P2 perf: one-entry memo of the last fully rendered SVG. generateQR() runs for
// every config event, and immediate calls routinely follow a debounced one for
// the very same config (blur after typing, OK after live hex input, the shell's
// "rerender" action). Reusing the previous string skips the library update,
// the post-processing passes and the frame assembly entirely.
let lastRenderKey = null;
let lastRenderedSvg = null;

// P2 perf: one-entry cache of the vendored library's raw SVG, keyed by the
// exact styling options and instance. Frame-only edits (label text, colours,
// font) leave buildQrStylingOptions unchanged, so the library re-render and
// its blob read are skipped while post-processing and frame assembly still
// run. Instance identity catches the library being recreated (logo on/off).
let lastRawSvg = { instance: null, key: null, text: null };

// Last successful eager layout: data + ECC -> module count. Only the count is
// kept (the matrix itself is not consumed downstream).
let lastLayoutKey = null;
let lastLayoutModuleCount = 21;

/** Cheap content fingerprint for data URLs (length + head/tail hash). */
function dataUrlFingerprint(value) {
  if (!value) return "";
  let h = value.length;
  const head = value.slice(0, 96);
  const tail = value.slice(-96);
  for (let i = 0; i < head.length; i++) h = (h * 31 + head.charCodeAt(i)) | 0;
  for (let i = 0; i < tail.length; i++) h = (h * 31 + tail.charCodeAt(i)) | 0;
  return `${value.length}:${h}`;
}

/** Every input the rasterised SVG depends on, as one string. */
function svgRenderKey(w, userMarginPx, moduleCount) {
  const g = state.generator;
  const gradient = (spec) => (spec ? JSON.stringify(spec) : "");
  return [
    w,
    userMarginPx,
    moduleCount,
    g.dataString,
    g.ecc,
    g.dotsColor,
    g.shapeBody,
    g.bgColor,
    g.bgTransparent,
    g.qrRadius,
    g.shapeOuter,
    g.shapeInner,
    g.cornersSquareColor,
    g.cornersDotColor,
    g.maskType,
    g.maskCustom,
    dataUrlFingerprint(g.logoDataUrl),
    dataUrlFingerprint(g.bgImageDataUrl),
    g.logoSizeProportion,
    g.imageMargin,
    g.hideBackgroundDots,
    g.frameStyle,
    g.frameText,
    g.frameTextSize,
    g.frameTextEnabled,
    g.frameFont,
    g.frameColor,
    g.frameTextColor,
    frameFontSignature(),
    gradient(g.bgGradient),
    gradient(g.dotsGradient),
    gradient(g.cornersSquareGradient),
    gradient(g.cornersDotGradient),
    gradient(g.frameGradient),
    gradient(g.frameTextGradient),
  ].join("\u0001");
}

let generateTimeout = null;
let isGenerating = false;
let pendingGeneration = false;
let suppressGenerationDuringSync = false;
let generationQueuedDuringSync = false;
let generationSeq = 0;

function setLoadingStep(key = "generator.generating", params = {}) {
  if (!DOM.qrLoading) return;
  const label = DOM.qrLoading.querySelector("span");
  if (label) label.textContent = t(key, params);
}

/** Hide the preview and park the generator UI in the QR-unavailable state. */
function showQrUnavailable(message) {
  if (DOM.qrLoading) {
    setLoadingStep();
    DOM.qrLoading.classList.add("hidden");
    DOM.qrLoading.classList.remove("flex");
  }
  if (DOM.qrReadabilityBadge) {
    DOM.qrReadabilityBadge.classList.add("hidden");
  }
  if (message) {
    DOM.emptyStateQr.textContent = message;
    DOM.emptyStateQr.classList.remove("hidden");
    DOM.emptyStateQr.classList.remove("bg-black/90");
    DOM.emptyStateQr.classList.add("bg-black");
  }
  DOM.qrCanvasContainer.style.display = "none";
  DOM.qrCanvasContainer.classList.remove("is-framed");
  DOM.qrPreviewContainer.classList.remove("has-qr");
  DOM.btnDownload.disabled = true;
  DOM.btnCopy.disabled = true;
  DOM.btnSave.disabled = true;
  DOM.btnShareLink.disabled = true;
  DOM.btnSave.textContent = t("common.save");
  setRenderInfo(null);
}

// Official Lucide artwork (lucide-static, ISC) for the two readability states.
const READABILITY_ICON_CHECK =
  '<svg class="readability-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const READABILITY_ICON_WARN =
  '<svg class="readability-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

/**
 * Deterministic readability verdict for the last rendered code.
 *
 * This used to rasterise the SVG and jsQR-decode it, which made the badge
 * flip at random: the same config reported "Scannable" or "Low readability"
 * from one render to the next, because jsQR's binarisation is sensitive to
 * anti-aliasing, to stylised module shapes, and to whether the nested logo /
 * background images had finished decoding when the raster was taken. The
 * verdict now comes from the pure advisors in readability.js plus the module
 * size of the current render, so one config always reports one state, the
 * check is synchronous, and no raster work runs on the main thread.
 */
function validateQrReadability() {
  const badge = DOM.qrReadabilityBadge;
  if (!badge) return;
  const info = getRenderInfo();
  if (!info) {
    badge.classList.add("hidden");
    return;
  }

  const modulePx = modulePixelSize(state.generator.width, info.moduleCount);
  const tooSmall = isTooSmallToScan(state.generator.width, info.moduleCount);
  // Prefer the specific cause ("corner colors nearly match the background")
  // over the generic copy, when the config points at one. The metrics matter:
  // dots, masks and an oversized logo plate are only worth warning about at
  // the size that actually renders.
  const hint = readabilityHintDescriptor(state.generator, {
    modulePx,
    canvasSize: state.generator.width,
  });

  if (tooSmall || hint) {
    badge.innerHTML = `${READABILITY_ICON_WARN} ${t("generator.lowReadability")}`;
    badge.className = "status-warning";
    badge.title = tooSmall
      ? t("generator.moduleTooSmall", { size: modulePx })
      : t("generator.lowReadabilityHint", { hint: t(hint.key, hint.params) });
  } else {
    badge.innerHTML = `${READABILITY_ICON_CHECK} ${t("generator.scannable")}`;
    badge.className = "status-scannable";
    badge.title = t("generator.scannableOk", {
      count: info.moduleCount,
      size: modulePx,
    });
  }
}

// Waiting room for one-off renders. A one-off render hands the pipeline an
// override set and awaits the finished SVG; the live debounced path stays
// untouched, so callers (batch export, history export) no longer overwrite
// state and poll render-info for completion.
const renderWaiters = [];
let renderQueue = Promise.resolve();

function settleRenderWaiters(result, error) {
  while (renderWaiters.length > 0) {
    const waiter = renderWaiters.shift();
    waiter(result, error);
  }
}

/**
 * Wait for the live render to finish. Bounded: if `isGenerating` never clears
 * (a library that never settles its promise), callers like the batch export
 * would otherwise spin a timer forever and keep their button disabled for the
 * life of the page.
 */
const RENDER_IDLE_TIMEOUT_MS = 20000;

function whenIdle() {
  if (!isGenerating) return Promise.resolve();
  return new Promise((resolve) => {
    const deadline = Date.now() + RENDER_IDLE_TIMEOUT_MS;
    const tick = () => {
      if (!isGenerating) return resolve();
      if (Date.now() >= deadline) {
        console.warn("[QR] live render did not settle; continuing without waiting.");
        // Clear the flag so the next render is not blocked behind the corpse.
        isGenerating = false;
        return resolve();
      }
      setTimeout(tick, 15);
    };
    tick();
  });
}

/**
 * Render an arbitrary config through the normal pipeline and resolve with
 * `{ svg, layout, w, h, moduleCount, userMarginPx }`. Calls are serialized
 * through one queue and never leave the live generator config modified.
 * Rejects when the config cannot render (invalid data, oversized margin).
 * @param {Record<string, unknown>} [overrides]
 */
export function renderOnce(overrides = {}) {
  const task = renderQueue.then(whenIdle).then(
    () =>
      new Promise((resolve, reject) => {
        const saved = {};
        for (const key of Object.keys(overrides)) {
          saved[key] = state.generator[key];
          state.generator[key] = overrides[key];
        }
        renderWaiters.push((result, error) => {
          // Restore only the keys this render still owns: values the user
          // changed while the render was in flight must survive.
          for (const key of Object.keys(saved)) {
            if (state.generator[key] === overrides[key]) state.generator[key] = saved[key];
          }
          if (error || !result) reject(error || new Error("QR render failed"));
          else resolve(result);
        });
        generateQR(true);
      })
  );
  renderQueue = task.catch(() => {});
  return task;
}

export function generateQR(immediate = false) {
  if (suppressGenerationDuringSync) {
    generationQueuedDuringSync = true;
    return;
  }
  // An immediate call supersedes any debounced render already scheduled:
  // leaving that timer alive ran the whole pipeline a second time for no change.
  if (generateTimeout) {
    clearTimeout(generateTimeout);
    generateTimeout = null;
  }
  const triggerUpdate = async () => {
    if (isGenerating) {
      pendingGeneration = true;
      ++generationSeq;
      return;
    }
    isGenerating = true;
    const token = ++generationSeq;
    const isCurrent = () => token === generationSeq;
    try {
      const text = state.generator.dataString;
      const hasData = text && text.trim() !== "";
      if (!hasData || !state.generator.isValid) {
        showQrUnavailable(t(hasData ? "generator.fixField" : "generator.enterContent"));
        settleRenderWaiters(null, new Error("QR config is not renderable"));
        return;
      }
      DOM.qrCanvasContainer.style.display = "flex";
      // Keep the current code on screen while the next one renders; the
      // skeleton is only for the very first render (nothing to show yet).
      if (DOM.qrLoading && !DOM.qrCanvasContainer.querySelector("svg")) {
        DOM.qrLoading.classList.remove("hidden");
        DOM.qrLoading.classList.add("flex");
      }

      // Ensure the qrcode encoder is loaded so module count, module size,
      // margin limits, and payload overflow checks are always accurate.
      if (!(await ensureQrcodeLoaded())) {
        const msg = t("generator.librariesFailed");
        showQrUnavailable(msg);
        announce(t("generator.failed", { message: msg }));
        settleRenderWaiters(null, new Error(msg));
        return;
      }
      let moduleCount = 21;
      let qrMatrix = null;
      try {
        if (typeof qrcode !== "undefined") {
          // The matrix shape only depends on data + ECC; styling-only renders
          // (colours, frame text, sliders) reuse the previous module count
          // instead of rebuilding the whole QR matrix just to read it.
          const layoutKey = state.generator.ecc + "\u0001" + (text || " ");
          if (layoutKey === lastLayoutKey) {
            moduleCount = lastLayoutModuleCount;
          } else {
            qrMatrix = qrcode(0, state.generator.ecc);
            qrMatrix.addData(text || " ");
            qrMatrix.make();
            moduleCount = qrMatrix.getModuleCount();
            lastLayoutKey = layoutKey;
            lastLayoutModuleCount = moduleCount;
          }
        }
      } catch (e) {
        console.warn("[QR] qrcode layout failed:", e);
        if (e && String(e).toLowerCase().includes("overflow")) {
          // Oversized payload: surface the friendly copy, fail every waiting
          // one-off render (renderOnce must always settle) and stop this pass.
          const msg = t("generator.dataTooLarge", { ecc: state.generator.ecc });
          showQrUnavailable(msg);
          announce(t("generator.failed", { message: msg }));
          settleRenderWaiters(null, new Error(msg, { cause: e }));
          return;
        }
      }

      const layout = resolveLayout(state.generator, moduleCount);
      const { dataW, userMarginPx } = layout;

      if (DOM.marginWarning) {
        if (userMarginPx > dataW / 2) {
          const maxAllowed = Math.floor(dataW / 2);
          DOM.marginWarning.textContent = t("generator.marginTooLarge", { max: maxAllowed });
          DOM.marginWarning.classList.remove("hidden");
          // No valid render: exports must not silently fall back to the last
          // successful config, and a queued change still needs to run. The
          // message matters — showQrUnavailable hides the canvas, so without
          // one the preview area goes blank with no explanation.
          showQrUnavailable(t("generator.marginTooLarge", { max: maxAllowed }));
          settleRenderWaiters(null, new Error("Margin is too large to render"));
          return;
        } else {
          DOM.marginWarning.classList.add("hidden");
          DOM.qrCanvasContainer.style.display = "flex";
        }
      }

      const { totalMarginPx, w, h } = layout;
      // QR modules are square: keep the state honest about the output size.
      state.generator.height = state.generator.width;

      const options = buildQrStylingOptions(w, h, {
        data: text,
        margin: totalMarginPx,
        roundSize: state.generator.shapeBody !== "square",

        background: state.generator.bgTransparent ? "transparent" : state.generator.bgColor,
        // Logo is reliably injected directly into SVG DOM by the svg pipeline
        // (applyLogoToDoc), bypassing QRCodeStyling's fragile async loadImage path.
      });
      if (!isCurrent()) return;
      const renderKey = svgRenderKey(w, userMarginPx, moduleCount);
      // The memo is only safe while the container still shows the cached SVG:
      // an unavailable-margin/message clears the preview, and any other config
      // overwrites the key. `reused` skips the DOM rewrite too (same markup).
      const reused = renderKey === lastRenderKey && Boolean(DOM.qrCanvasContainer.querySelector("svg"));
      let renderedSvg;
      try {
        if (reused) {
          renderedSvg = lastRenderedSvg;
        } else {
          const qrInstance = getQrCode();
          const optionsKey = JSON.stringify(options);
          let rawSvgText;
          if (lastRawSvg.instance === qrInstance && lastRawSvg.key === optionsKey) {
            rawSvgText = lastRawSvg.text;
          } else {
            qrInstance.update(options);
            setLoadingStep(
              state.generator.frameStyle !== "none"
                ? "generator.applyingFrame"
                : state.generator.maskType !== "none"
                  ? "generator.applyingMask"
                  : "generator.rendering"
            );
            const qrSvgBlob = await qrInstance.getRawData("svg");
            rawSvgText = await qrSvgBlob.text();
            lastRawSvg = { instance: qrInstance, key: optionsKey, text: rawSvgText };
          }
          const processed = await renderSvg({ svgText: rawSvgText, layout, moduleCount, qrMatrix });
          renderedSvg = processed.svg;
          // A superseded render must not publish its memo: a later run with the
          // same key would reuse this SVG while the preview shows another one.
          if (!isCurrent()) return;
          lastRenderKey = renderKey;
          lastRenderedSvg = renderedSvg;
        }
        if (!isCurrent()) return;
      } catch (e) {
        if (!isCurrent()) return;
        console.error("[QR] generateQR render failed:", e);
        // The renderer's own overflow error (raised when the qrcode layout
        // check is skipped or the encoder rejects the payload) maps to the
        // same friendly copy as the eager layout check.
        const raw = e && e.message ? String(e.message) : "";
        const msg = /overflow|too (?:long|large)|code length/i.test(raw)
          ? t("generator.dataTooLarge", { ecc: state.generator.ecc })
          : t("generator.dataTooLargeGeneric");
        showQrUnavailable(msg);
        announce(t("generator.failed", { message: msg }));
        settleRenderWaiters(null, e instanceof Error ? e : new Error(msg));
        return;
      }

      if (!isCurrent()) return;

      DOM.qrCanvasContainer.classList.toggle("is-framed", state.generator.frameStyle !== "none");
      if (!reused) {
        DOM.qrCanvasContainer.innerHTML = renderedSvg;
      }
      // Publish the exact rendered SVG so exports match the preview (masks
      // included) and use the computed dimensions rather than requested ones.
      setRenderInfo({ svg: renderedSvg, w, h, moduleCount, userMarginPx });
      settleRenderWaiters({ svg: renderedSvg, layout, w, h, moduleCount, userMarginPx }, null);
      const svgEl = DOM.qrCanvasContainer.querySelector("svg");
      if (svgEl) {
        if (!svgEl.getAttribute("viewBox")) {
          svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
        }
        // No inline width/height: the stylesheet sizes the SVG with
        // max-width/max-height + width:auto, which preserves the aspect ratio.
        // Framed output is taller than wide, and forcing width:100% used to
        // squish it and cut the bottom frame/text.
        svgEl.setAttribute("role", "img");
        svgEl.setAttribute("aria-label", t("preview.generated"));
      }
      if (DOM.qrLoading) {
        setLoadingStep();
        DOM.qrLoading.classList.add("hidden");
        DOM.qrLoading.classList.remove("flex");
      }
      DOM.emptyStateQr.classList.add("hidden");
      DOM.emptyStateQr.classList.remove("bg-black");
      DOM.emptyStateQr.classList.add("bg-black/90");
      DOM.qrPreviewContainer.classList.add("has-qr");
      DOM.btnDownload.disabled = false;
      DOM.btnCopy.disabled = false;
      DOM.btnShareLink.disabled = false;
      if (isCurrentConfigSaved()) {
        DOM.btnSave.disabled = true;
        DOM.btnSave.textContent = t("controls.saved");
      } else {
        DOM.btnSave.disabled = false;
        DOM.btnSave.textContent = t("common.save");
      }
      announce(t("generator.ready"));
      validateQrReadability();
    } finally {
      isGenerating = false;
      if (pendingGeneration) {
        pendingGeneration = false;
        generateQR(true);
      } else if (!isCurrent() && DOM.qrLoading) {
        setLoadingStep();
        DOM.qrLoading.classList.add("hidden");
        DOM.qrLoading.classList.remove("flex");
      }
    }
  };
  const run = () => {
    generateTimeout = null;
    triggerUpdate().catch((e) => {
      console.error("[QR] unexpected generateQR failure:", e);
    });
  };
  if (immediate) run();
  else generateTimeout = setTimeout(run, DEBOUNCE_GENERATE_MS);
}
