import { DOM } from "../ui/dom.js";
import { syncCustomSelect, refreshCustomSelect } from "../ui/components.js";
import { state, serializableGenerator } from "../state";
import {
  applySurroundShapeToDoc,
  applyCornerStylesToDoc,
  applyGlobalDotGradientToDoc,
  needsCornerStylePass,
  needsGlobalGradientPass,
  optimizeSvgRects,
  parseSvgDocument,
  SVG_NS,
} from "./mask.js";
import { getCombinedSvgString, frameTextFill, frameFontSignature } from "./frame.js";
import { resolveLayout } from "./layout.js";
import { framesConfig } from "../frames";
import { applyBackgroundImageToDoc } from "./background.js";
import { applyLogoToDoc } from "./logo.js";
import { setRenderInfo, getRenderInfo } from "./render-info.js";
import { readabilityHint, modulePixelSize, isTooSmallToScan } from "./readability.js";
import { ensureQrcodeLoaded } from "./encoder.js";
import { getQrCode, buildQrStylingOptions } from "./qr-instance.js";
import { DEBOUNCE_GENERATE_MS } from "../constants.js";
import { announce } from "../ui/announce.js";
import { DATA_TYPES } from "./data-types.js";

// Quality presets exposed by the Parameters dropdown; values are pixel sizes
// and must mirror the <option> values of #qr-size-medium in index.html.
const QUALITY_PRESETS = [300, 600, 1000, 1500, 2000];
const nearestQualityPreset = (width) =>
  QUALITY_PRESETS.reduce(
    (best, p) => (Math.abs(p - width) < Math.abs(best - width) ? p : best),
    QUALITY_PRESETS[0]
  );

/**
 * Reflect a width in the Medium Size select. The select is preset-only, so a
 * width outside the list shows the nearest preset (picking that preset then
 * applies it); the custom width itself is never changed here.
 */
export function syncMediumSizeSelect(width) {
  const select = DOM.qrSizeMedium;
  if (!select) return;
  const customOption = select.querySelector("option[data-custom-size]");
  if (customOption) customOption.remove();
  select.value = String(nearestQualityPreset(width));
  refreshCustomSelect(select);
}

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
  if (DOM.qrSizeMedium) {
    syncMediumSizeSelect(state.generator.width);
  }
  if (DOM.logoSizeMedium) {
    DOM.logoSizeMedium.value = Math.round(state.generator.logoSizeProportion * 100);
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

function applyComplexityMode() {
  const mode = DOM.complexitySelect.value;
  // CSS gates a few containers (e.g. the custom mask path) on the mode.
  document.body.dataset.complexity = mode;
  DOM.configPanel.classList.toggle("hidden", mode === "simple");
  DOM.qrCanvasContainer.parentElement.classList.toggle("aspect-square", mode === "simple");
  if (mode === "simple") return;
  const isFull = mode === "full";
  const isMedium = mode === "medium";
  document.querySelectorAll(".full-only").forEach((el) => {
    if (isFull) el.classList.remove("hidden");
    else el.classList.add("hidden");
  });
  if (isMedium) {
    // Medium only offers preset sizes, so a width that matches none gets its
    // own "Custom (Npx)" entry: the select stays truthful without discarding
    // the user's size the way snapping to the nearest preset would.
    DOM.mediumColorFg.classList.remove("hidden");
    DOM.mediumColorFg.classList.add("flex");
    DOM.mediumParameters.classList.remove("hidden");
    DOM.mediumParameters.classList.add("flex");
    DOM.mediumLogoOptions.classList.remove("hidden");
    DOM.mediumLogoOptions.classList.add("flex");
    if (DOM.qrSizeMedium) {
      syncMediumSizeSelect(state.generator.width);
    }
    if (DOM.logoSizeMedium) {
      DOM.logoSizeMedium.value = String(
        Math.max(10, Math.min(50, Math.round(state.generator.logoSizeProportion * 100)))
      );
    }
  } else {
    DOM.mediumColorFg.classList.add("hidden");
    DOM.mediumColorFg.classList.remove("flex");
    DOM.mediumParameters.classList.add("hidden");
    DOM.mediumParameters.classList.remove("flex");
    DOM.mediumLogoOptions.classList.add("hidden");
    DOM.mediumLogoOptions.classList.remove("flex");
  }
}

export function initGenerator() {
  if (DOM.complexitySelect) {
    DOM.complexitySelect.addEventListener("change", () => applyComplexityMode());
  }
  applyComplexityMode(); // Init
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

function setLoadingStep(step) {
  if (!DOM.qrLoading) return;
  const label = DOM.qrLoading.querySelector("span");
  if (label) label.textContent = step || "Generating…";
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
  // The badge no longer reflects the preview: a later render of the same SVG
  // must re-check instead of being skipped as already validated.
  lastReadabilitySvg = null;
  pendingReadabilitySvg = null;
  if (readabilityTimer) {
    clearTimeout(readabilityTimer);
    readabilityTimer = null;
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
  DOM.btnSave.textContent = "Save";
  setRenderInfo(null);
}

/**
 * First direct-child rect that spans the whole canvas. The visible background
 * is the only canvas-sized direct rect; matching by geometry means a library
 * that ever emits a different first rect (or an overlay rect) can never get
 * its `rx` rewritten by mistake.
 */
function canvasBackgroundRect(parent, w, h) {
  for (const child of parent.children) {
    if (child.tagName.toLowerCase() !== "rect") continue;
    const cw = Number(child.getAttribute("width"));
    const ch = Number(child.getAttribute("height"));
    if (Math.abs(cw - w) <= 0.5 && Math.abs(ch - h) <= 0.5) return child;
  }
  return null;
}

/**
 * Largest border radius whose rounded clip still fully contains the QR data
 * square, so rounding can never cut into a module.
 *
 * The clip's corner is a quarter circle of radius r centred at (r, r). Its
 * deepest intrusion along the canvas diagonal is r*(1 - 1/√2), which must stop
 * before the data corner at (margin, margin): r ≤ margin / (1 - 1/√2). The
 * result is also capped at half the canvas minus the quiet zone (never a
 * circle, and never larger than half the data area) so hostile persisted or
 * shared values cannot collapse the shape.
 */
export function maxSafeRadius(w, h, marginPx) {
  const side = Math.min(Number(w) || 0, Number(h) || 0);
  if (!(side > 0)) return 0;
  const margin = Math.max(0, Math.min(Number(marginPx) || 0, side / 2));
  const cornerSafe = margin / (1 - Math.SQRT1_2);
  return Math.max(0, Math.min(side / 2, side / 2 - margin, cornerSafe));
}

/**
 * Apply border radius to the QR SVG background rect and clip matrix modules.
 * The effective radius is clamped so no data module is ever cut (and the
 * shape can never collapse into a circle), even for an out-of-range value
 * arriving from persisted state or a share link.
 */
export function applyRadiusToDoc(doc, qrRadius, w, h, userMarginPx = 0) {
  if (!(Number(qrRadius) > 0)) return false;
  const root = doc.documentElement;
  const effectiveRadius = Math.floor(Math.min(Number(qrRadius), maxSafeRadius(w, h, userMarginPx)));
  if (!(effectiveRadius > 0)) return false;

  // The visible background is the first canvas-sized *direct-child* rect. The
  // first rect in document order lives inside <defs> (a clip path); rounding
  // that one leaves the real background square and can distort a module clip.
  const bgRect = canvasBackgroundRect(root, w, h);
  if (bgRect) {
    bgRect.setAttribute("rx", String(effectiveRadius));
    bgRect.setAttribute("ry", String(effectiveRadius));
  }
  let defs = root.querySelector("defs");
  if (!defs) {
    defs = doc.createElementNS(SVG_NS, "defs");
    root.insertBefore(defs, root.firstChild);
  }
  const clipId = "qr-canvas-radius-clip";
  const existingClip = defs.querySelector(`#${clipId}`);
  if (existingClip) existingClip.remove();

  const clip = doc.createElementNS(SVG_NS, "clipPath");
  clip.setAttribute("id", clipId);
  const clipRect = doc.createElementNS(SVG_NS, "rect");
  clipRect.setAttribute("x", "0");
  clipRect.setAttribute("y", "0");
  clipRect.setAttribute("width", String(w));
  clipRect.setAttribute("height", String(h));
  clipRect.setAttribute("rx", String(effectiveRadius));
  clipRect.setAttribute("ry", String(effectiveRadius));
  clip.appendChild(clipRect);
  defs.appendChild(clip);

  const contentChildren = Array.from(root.children).filter(
    (el) => el !== defs && el !== bgRect && el.tagName.toLowerCase() !== "clippath"
  );
  if (contentChildren.length > 0) {
    const clipGroup = doc.createElementNS(SVG_NS, "g");
    clipGroup.setAttribute("clip-path", `url(#${clipId})`);
    contentChildren[0].before(clipGroup);
    contentChildren.forEach((child) => clipGroup.appendChild(child));
  }
  return true;
}

/**
 * Run the SVG post-processing passes (mask, corner styles, gradients,
 * background image) over a single parse/serialize instead of one round-trip
 * per pass. `surround` selects the unframed path, where the mask pass runs
 * here; framed renders already ran it inside getCombinedSvgString.
 */
export function postProcessSvgWithDoc(
  svgText,
  { userMarginPx = 0, w, h, moduleCount = 21, qrMatrix = null, surround, layout = null, deferSerialize = false }
) {
  const maskActive = surround && state.generator.maskType !== "none";
  const radiusActive = surround && state.generator.maskType === "none" && (state.generator.qrRadius || 0) > 0;
  const needsBackground = Boolean(state.generator.bgImageDataUrl);
  const needsLogo = Boolean(state.generator.logoDataUrl);
  const needsDomPass =
    maskActive ||
    radiusActive ||
    needsCornerStylePass() ||
    needsGlobalGradientPass() ||
    needsBackground ||
    needsLogo;
  if (!surround && !needsDomPass) return { svg: svgText, doc: null };
  // The string-only module merge runs first so the occasional DOM parse is
  // handed a much smaller tree (and plain renders never need a parse at all).
  const optimized = surround ? optimizeSvgRects(svgText) : svgText;
  if (!needsDomPass) return { svg: optimized, doc: null };
  const doc = parseSvgDocument(optimized);
  if (!doc) return { svg: optimized, doc: null };
  let changed = false;
  if (maskActive) {
    changed = applySurroundShapeToDoc(doc, userMarginPx, w, h, moduleCount, qrMatrix, layout) || changed;
  }
  if (radiusActive) {
    changed = applyRadiusToDoc(doc, state.generator.qrRadius, w, h, userMarginPx) || changed;
  }
  changed = applyCornerStylesToDoc(doc) || changed;
  changed = applyGlobalDotGradientToDoc(doc, w, h) || changed;
  changed = applyBackgroundImageToDoc(doc, w, h) || changed;
  changed = applyLogoToDoc(doc, w, h) || changed;
  if (!changed) return { svg: optimized, doc };
  // Framed renders hand the parsed doc straight to the frame assembly, so the
  // serialized string would be discarded: skip it and let the caller serialize.
  if (deferSerialize) return { svg: optimized, doc };
  return { svg: new XMLSerializer().serializeToString(doc.documentElement), doc };
}

export function postProcessSvg(svgText, opts) {
  return postProcessSvgWithDoc(svgText, opts).svg;
}

const READABILITY_CHECK_DEBOUNCE_MS = 120;
let readabilityCheckSeq = 0;

// Official Lucide artwork (lucide-static, ISC) for the two readability states.
const READABILITY_ICON_CHECK =
  '<svg class="readability-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const READABILITY_ICON_WARN =
  '<svg class="readability-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
let readabilityTimer = null;
let pendingReadabilitySvg = null;
let lastReadabilitySvg = null;

/**
 * Coalesce badge checks: rapid renders (slider drags, a typing burst) used to
 * rasterise and jsQR-decode every intermediate SVG on the main thread. Only
 * the latest SVG is checked, after a short quiet period, and a repeat of the
 * already-checked SVG is skipped entirely.
 */
function validateQrReadability(svgString) {
  if (!DOM.qrReadabilityBadge) return;
  if (svgString === lastReadabilitySvg || svgString === pendingReadabilitySvg) return;
  pendingReadabilitySvg = svgString;
  if (readabilityTimer) clearTimeout(readabilityTimer);
  readabilityTimer = setTimeout(() => {
    readabilityTimer = null;
    const svg = pendingReadabilitySvg;
    pendingReadabilitySvg = null;
    runReadabilityCheck(svg).catch(() => {});
  }, READABILITY_CHECK_DEBOUNCE_MS);
}

async function runReadabilityCheck(svgString) {
  if (!DOM.qrReadabilityBadge) return;
  lastReadabilitySvg = svgString;
  const seq = ++readabilityCheckSeq;
  try {
    // The ring hugs the code and the silhouette fill can drown coloured finder
    // patterns (masks have no internal quiet zone), so jsQR cannot find the
    // code's edges with them present. Hide both before scanning: the modules,
    // colours, shapes and logo stay exactly what the user sees. A single
    // injected rule avoids parsing/removing/re-serializing the whole tree.
    if (
      state.generator.maskType !== "none" &&
      (svgString.includes('class="qr-surround"') || svgString.includes('class="qr-mask-bg"'))
    ) {
      const close = svgString.lastIndexOf("</svg>");
      if (close !== -1) {
        svgString =
          svgString.slice(0, close) +
          "<style>.qr-surround,.qr-mask-bg{display:none}</style>" +
          svgString.slice(close);
      }
    }
    const img = new Image();
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    URL.revokeObjectURL(url);
    if (seq !== readabilityCheckSeq) return;

    // 640px gives jsQR enough resolution to binarize colourful module sets
    // (blue/red/purple) that a 300px raster fumbles.
    const scanW = 640;
    const scanH = Math.round(scanW * (img.naturalHeight / (img.naturalWidth || 1))) || scanW;
    // Masks crop the canvas to the silhouette, so the decoded bitmap has no
    // quiet zone and jsQR fails even for perfectly scannable codes. Pad the
    // raster with a background-coloured border — the margin a real camera sees.
    const pad = Math.max(12, Math.round(scanW * 0.08));
    const canvas = document.createElement("canvas");
    canvas.width = scanW + pad * 2;
    canvas.height = scanH + pad * 2;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const bgColor = state.generator.bgTransparent ? "#ffffff" : state.generator.bgColor || "#ffffff";
    const padFill = /^#[0-9a-f]{6}$/i.test(bgColor) ? bgColor : "#ffffff";
    const paintAndScan = (fill) => {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, pad, pad, scanW, scanH);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(imgData.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
    };

    let code = null;
    if (typeof jsQR !== "undefined") {
      code = paintAndScan(padFill);
      if (!code) {
        // Inverted code (light modules on a dark card): the quiet zone must be
        // the background polarity, so try the opposite pad before giving up.
        code = paintAndScan(padFill.toLowerCase() === "#ffffff" ? "#000000" : "#ffffff");
      }
    }

    if (seq !== readabilityCheckSeq) return;

    // A code can decode in the 640px test raster and still be unscannable in
    // practice if it renders with tiny modules (e.g. a 50px size). Treat that
    // as low readability so the badge never promises more than the output is.
    const info = getRenderInfo();
    const modulePx = info ? modulePixelSize(state.generator.width, info.moduleCount) : 0;
    const tooSmall = info ? isTooSmallToScan(state.generator.width, info.moduleCount) : false;

    DOM.qrReadabilityBadge.classList.remove("hidden");
    if (code && !tooSmall) {
      DOM.qrReadabilityBadge.innerHTML = `${READABILITY_ICON_CHECK} Scannable`;
      DOM.qrReadabilityBadge.className = "status-scannable";
      DOM.qrReadabilityBadge.title = `Scannable (decoded: "${code.data.slice(0, 50)}")`;
    } else {
      DOM.qrReadabilityBadge.innerHTML = `${READABILITY_ICON_WARN} Low Readability`;
      DOM.qrReadabilityBadge.className = "status-warning";
      // Prefer the specific cause ("corner colors nearly match the background")
      // over the generic copy, when the config points at one.
      const hint = readabilityHint(state.generator);
      DOM.qrReadabilityBadge.title = tooSmall
        ? `Low readability. Each module is only ${modulePx}px at this size — increase the size for reliable scanning.`
        : hint
          ? `Low readability. ${hint}`
          : "The QR code may be difficult for scanners to decode with current colors or shapes.";
    }
  } catch (err) {
    console.warn("[QR] readability validation failed:", err);
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

function whenIdle() {
  if (!isGenerating) return Promise.resolve();
  return new Promise((resolve) => {
    const tick = () => (isGenerating ? setTimeout(tick, 15) : resolve());
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
          Object.assign(state.generator, saved);
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
        showQrUnavailable(
          hasData ? "Fix the highlighted field to generate a QR code" : "Enter content to generate a QR code"
        );
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
        throw new Error("Required libraries failed to load. Please reload or check your connection.");
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
          const msg = `Data is too large for ECC level ${state.generator.ecc}. Try lowering error correction or shortening text.`;
          showQrUnavailable(msg);
          announce("QR generation failed: " + msg);
          settleRenderWaiters(null, new Error(msg, { cause: e }));
          return;
        }
      }

      const layout = resolveLayout(state.generator, moduleCount);
      const { dataW, userMarginPx } = layout;

      if (DOM.marginWarning) {
        if (userMarginPx > dataW / 2) {
          const maxAllowed = Math.floor(dataW / 2);
          DOM.marginWarning.textContent = `Margin is too large — the maximum is ${maxAllowed}`;
          DOM.marginWarning.classList.remove("hidden");
          // No valid render: exports must not silently fall back to the last
          // successful config, and a queued change still needs to run.
          showQrUnavailable(null);
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
        // Logo is reliably injected directly into SVG DOM in postProcessSvg via applyLogoToDoc,
        // bypassing QRCodeStyling's fragile internal async loadImage/XHR path.
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
                ? "Applying mask & frame…"
                : state.generator.maskType !== "none"
                  ? "Applying mask…"
                  : "Rendering QR…"
            );
            const qrSvgBlob = await qrInstance.getRawData("svg");
            rawSvgText = await qrSvgBlob.text();
            lastRawSvg = { instance: qrInstance, key: optionsKey, text: rawSvgText };
          }
          const processed = postProcessSvgWithDoc(rawSvgText, {
            userMarginPx,
            w,
            h,
            moduleCount,
            qrMatrix,
            surround: true,
            layout,
            deferSerialize: state.generator.frameStyle !== "none",
          });
          renderedSvg = processed.svg;
          if (state.generator.frameStyle !== "none") {
            // Hand the frame assembly the same parsed document so it doesn't
            // serialize and re-parse the QR SVG a second time.
            renderedSvg = await getCombinedSvgString(
              w,
              h,
              userMarginPx,
              moduleCount,
              qrMatrix,
              processed.svg,
              processed.doc,
              layout
            );
          }
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
          ? `Data is too large for ECC level ${state.generator.ecc}. Try lowering error correction or shortening text.`
          : raw || "Data too large for this QR configuration";
        showQrUnavailable(msg);
        announce("QR generation failed: " + msg);
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
        svgEl.setAttribute("aria-label", "Generated QR code");
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
        DOM.btnSave.textContent = "Saved";
      } else {
        DOM.btnSave.disabled = false;
        DOM.btnSave.textContent = "Save";
      }
      announce("QR code generated and ready for download or copy");
      validateQrReadability(renderedSvg);
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
