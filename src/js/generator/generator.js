import { DOM } from "../ui/dom.js";
import { refreshCustomSelect, syncCustomSelect } from "../ui/components.js";
import { syncSearchableSelect } from "../ui/searchable-select.js";
import { state, serializableGenerator } from "../state";
import { getQrCode, buildQrStylingOptions } from "./qr-instance.js";
import { renderSvg } from "./svg-pipeline.js";
import { resolveLayout } from "./layout.js";
import { framesConfig } from "../frames";
import { frameTextFill, frameFontSignature } from "./frame.js";
import { setRenderInfo } from "./render-info.js";
import { svgDecodes } from "./scannability.js";
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

/**
 * Mirror the logo ratio into the readout beside its label. A slider shows no
 * number of its own, and the ratio is the one setting whose exact value the user
 * needs to read (0.1–0.5, two decimals).
 */
export function syncLogoSizeReadout() {
  if (!DOM.logoSizeValue) return;
  const value = Number(state.generator.logoSizeProportion);
  DOM.logoSizeValue.textContent = Number.isFinite(value) ? String(value) : "";
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
  // Depth counter, not a boolean: sync dispatches change/input events that can
  // re-enter this function, and a boolean let the inner call's reset release
  // the outer call's window early (its renders then ran on half-synced UI).
  suppressGenerationDuringSync++;
  try {
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
    syncLogoSizeReadout();
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
        // Programmatic hydration must repaint both widget families; the old code
        // only refreshed custom selects, leaving searchable triggers stale.
        try {
          refreshCustomSelect(s.el);
        } catch {
          syncCustomSelect(s.el);
        }
        try {
          syncSearchableSelect(s.el);
        } catch {
          /* searchable wrapper absent for this select */
        }
        // Dispatch is intentionally suppressed-safe: shape/frame handlers treat
        // a same-value change as programmatic (see controls.js frame guard) and
        // generation is held until the end of the sync.
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
    // Never dump a multi-MB data URL into the visible URL box: show the file
    // name / remote URL instead, keeping the data URL only in state.
    if (DOM.logoUrl) {
      const stored = state.generator.logoDataUrl;
      if (state.generator.logoFilename === "url" && typeof stored === "string" && !stored.startsWith("data:")) {
        if (DOM.logoUrl.value !== stored) DOM.logoUrl.value = stored;
      } else if (
        state.generator.logoFilename &&
        state.generator.logoFilename !== "url" &&
        typeof stored === "string" &&
        stored.startsWith("data:")
      ) {
        if (DOM.logoUrl.value !== state.generator.logoFilename)
          DOM.logoUrl.value = state.generator.logoFilename;
        DOM.logoUrl.setAttribute("title", state.generator.logoFilename);
      } else if (DOM.logoUrl.value !== "") {
        DOM.logoUrl.value = "";
        DOM.logoUrl.removeAttribute("title");
      }
    }

    if (state.generator.logoDataUrl) {
      DOM.logoOptions.classList.remove("opacity-50", "pointer-events-none");
      DOM.btnClearLogo.classList.remove("hidden");
    } else {
      DOM.logoOptions.classList.add("opacity-50", "pointer-events-none");
      DOM.btnClearLogo.classList.add("hidden");
    }

  } finally {
    suppressGenerationDuringSync--;
    // No early return inside finally (unsafe): the outermost sync alone flushes
    // the single coalesced render when the depth unwinds to zero.
    if (suppressGenerationDuringSync <= 0) {
      suppressGenerationDuringSync = 0;
      // A single queued render covers the whole sync no matter how many events it
      // dispatched: the flag coalesces them instead of stacking one render each.
      if (generationQueuedDuringSync) {
        generationQueuedDuringSync = false;
        generateQR();
      }
    }
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

// Memoized history signatures: isCurrentConfigSaved() runs per render over up
// to 50 entries, and stringifying every entry per render is pure waste —
// entries are append-only, so a signature cached on the item stays valid until
// its config reference is replaced.
function historyItemSignature(item) {
  if (!item || !item.config) return null;
  if (typeof item._sig === "string" && item._sigConfig === item.config) return item._sig;
  const sig = configSignature(item.config);
  try {
    item._sig = sig;
    item._sigConfig = item.config;
  } catch {
    // Frozen/hostile items: skip the cache, the value is still correct.
  }
  return sig;
}

function isCurrentConfigSaved() {
  if (!state.generatorHistory || state.generatorHistory.length === 0) return false;
  const currentSig = configSignature(state.generator);
  return state.generatorHistory.some((item) => historyItemSignature(item) === currentSig);
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

/** Cheap, allocation-free gradient key: specs only carry type/rotation/color2. */
function gradientKey(spec) {
  if (!spec || typeof spec !== "object") return "";
  return `${spec.type}|${spec.rotation}|${spec.color2}`;
}

/** Every input the rasterised SVG depends on, as one string. */
function svgRenderKey(w, userMarginPx, moduleCount) {
  const g = state.generator;
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
    gradientKey(g.bgGradient),
    gradientKey(g.dotsGradient),
    gradientKey(g.cornersSquareGradient),
    gradientKey(g.cornersDotGradient),
    gradientKey(g.frameGradient),
    gradientKey(g.frameTextGradient),
  ].join("\u0001");
}

let generateTimeout = null;
let isGenerating = false;
let pendingGeneration = false;
// Sync-suppression depth (counter, not boolean — sync re-enters via the change
// events it dispatches). A single queued render covers the whole sync.
let suppressGenerationDuringSync = 0;
let generationQueuedDuringSync = false;
let generationSeq = 0;
// Consumed by the next generateQR pass: lets a queued one-off render
// (renderOnce) run inside a sync-suppression window instead of deadlocking.
let forceNextRender = false;

function setLoadingStep(key = "generator.generating", params = {}) {
  if (!DOM.qrLoading) return;
  const label = DOM.qrLoading.querySelector("span");
  if (label) label.textContent = t(key, params);
}

/** Hide the preview and park the generator UI in the QR-unavailable state. */
function showQrUnavailable(message) {
  // The memo must die here: the container no longer shows the cached SVG, so a
  // later render with the same key would "reuse" markup that is not on screen.
  // The readability token dies with it so a pending decode cannot repaint the
  // badge for the hidden code.
  lastRenderKey = null;
  lastRenderedSvg = null;
  readabilityCheckId++;
  if (DOM.qrCanvasContainer) {
    DOM.qrCanvasContainer.innerHTML = "";
  }
  if (DOM.qrLoading) {
    setLoadingStep();
    DOM.qrLoading.classList.add("hidden");
    DOM.qrLoading.classList.remove("flex");
  }
  if (DOM.qrReadabilityBadge) {
    DOM.qrReadabilityBadge.classList.add("hidden");
  }
  if (message && DOM.emptyStateQr) {
    DOM.emptyStateQr.textContent = message;
    DOM.emptyStateQr.classList.remove("hidden");
    DOM.emptyStateQr.classList.remove("bg-black/90");
    DOM.emptyStateQr.classList.add("bg-black");
  }
  if (DOM.qrCanvasContainer) {
    DOM.qrCanvasContainer.style.display = "none";
    DOM.qrCanvasContainer.classList.remove("is-framed");
  }
  if (DOM.qrPreviewContainer) {
    DOM.qrPreviewContainer.classList.remove("has-qr");
  }
  if (DOM.btnDownload) DOM.btnDownload.disabled = true;
  if (DOM.btnCopy) DOM.btnCopy.disabled = true;
  if (DOM.btnSave) {
    DOM.btnSave.disabled = true;
    DOM.btnSave.textContent = t("common.save");
  }
  if (DOM.btnShareLink) DOM.btnShareLink.disabled = true;
  setRenderInfo(null);
}

// Official Lucide artwork (lucide-static, ISC) for the two readability states.
const READABILITY_ICON_CHECK =
  '<svg class="readability-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const READABILITY_ICON_WARN =
  '<svg class="readability-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

// Monotonic token: an async decode that finishes after a newer render must not
// repaint the badge for a code that is no longer on screen.
let readabilityCheckId = 0;

/**
 * Scannability verdict for the last rendered code.
 *
 * The only criterion is a decode: the published SVG is rasterised at its own
 * size and run through the same decoder the scanner ships. "Scannable" means
 * this exact image decodes to the rendered payload; "Low Readability" means
 * it does not. No threshold, colour, logo size or module size takes part —
 * those were guesses that could disagree with the decoder, which is how a
 * logo that hid nothing used to be reported as a problem.
 *
 * Determinism comes from decoding the published SVG string at a fixed size
 * (see scannability.js) instead of the live preview DOM, which is what made the
 * old decode-based badge flip between renders. The caller passes the exact
 * artifact plus the payload it must decode to (compared by the decoder), and
 * skips the check entirely for memo-reused renders.
 */
async function validateQrReadability(info, expectedData) {
  const badge = DOM.qrReadabilityBadge;
  if (!badge) return;
  if (!info) {
    badge.classList.add("hidden");
    return;
  }

  const checkId = ++readabilityCheckId;
  const decodes = await svgDecodes(info.svg, info.w, info.h, info.moduleCount, expectedData);
  if (checkId !== readabilityCheckId) return;

  if (decodes === null) {
    // Decoder unavailable/failed: report an explicit Unknown state instead of
    // hiding the badge (a hidden badge read as "not checked OK").
    badge.classList.remove("hidden");
    badge.innerHTML = `${READABILITY_ICON_WARN} ${t("generator.unknownReadability")}`;
    badge.className = "status-unknown";
    badge.removeAttribute("title");
    return;
  }

  const modulePx = info.moduleCount > 0 ? Math.floor(info.w / info.moduleCount) : 0;
  if (decodes) {
    badge.innerHTML = `${READABILITY_ICON_CHECK} ${t("generator.scannable")}`;
    badge.className = "status-scannable";
    badge.title = t("generator.scannableOk", {
      count: info.moduleCount,
      size: modulePx,
    });
    return;
  }

  badge.innerHTML = `${READABILITY_ICON_WARN} ${t("generator.lowReadability")}`;
  badge.className = "status-warning";
  badge.title = t("generator.doesNotDecode", { size: modulePx });
}

// Waiting room for one-off renders. A one-off render hands the pipeline an
// override set and awaits the finished SVG; the live debounced path stays
// untouched, so callers (batch export, history export) no longer overwrite
// state and poll render-info for completion.
const renderWaiters = [];
let renderQueue = Promise.resolve();

function settleRenderWaiters(result, error) {
  if (renderWaiters.length === 0) return;
  const pending = renderWaiters.splice(0, renderWaiters.length);
  for (const waiter of pending) {
    try {
      waiter(result, error);
    } catch (e) {
      console.error("[QR] render waiter failed:", e);
    }
  }
}

// Idle as a signal, not a poll: the in-flight render resolves idlePromise in
// its finally block, so waiters wake the moment it settles instead of spinning
// a 15ms timer. The bound stays — a render that never settles (hung library)
// still releases its waiters instead of wedging them for the life of the page.
const RENDER_IDLE_TIMEOUT_MS = 20000;
let idlePromise = null;
let idleResolve = null;

function markRenderBusy() {
  if (!idlePromise) idlePromise = new Promise((resolve) => { idleResolve = resolve; });
}

function markRenderIdle() {
  if (idleResolve) idleResolve();
  idlePromise = null;
  idleResolve = null;
}

function whenIdle() {
  if (!isGenerating || !idlePromise) return Promise.resolve();
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn("[QR] live render did not settle; continuing without waiting.");
      // Clear the flag so the next render is not blocked behind the corpse.
      isGenerating = false;
      markRenderIdle();
      resolve();
    }, RENDER_IDLE_TIMEOUT_MS);
  });
  return Promise.race([idlePromise.then(() => clearTimeout(timer)), timeout]);
}

// Upper bound for one queued one-off render (idle wait plus the render
// itself): every waiter settles by rejection at the latest, so no caller can
// hang on a superseded or hung render.
const RENDER_ONCE_TIMEOUT_MS = 30000;

/**
 * Render an arbitrary config through the normal pipeline and resolve with
 * `{ svg, layout, w, h, moduleCount, userMarginPx }`. Calls are serialized
 * through one queue and never leave the live generator config modified.
 * Rejects when the config cannot render (invalid data, oversized margin).
 * @param {Record<string, unknown>} [overrides]
 */
export function renderOnce(overrides = {}) {
  const keys = Object.keys(overrides || {});
  const task = renderQueue.then(() => whenIdle()).then(
    () =>
      new Promise((resolve, reject) => {
        const saved = {};
        for (const key of keys) saved[key] = state.generator[key];
        for (const key of keys) state.generator[key] = overrides[key];
        let settled = false;
        // Restore only the keys this render still owns: values the user
        // changed while the render was in flight must survive.
        const restore = () => {
          for (const key of keys) {
            try {
              if (state.generator[key] === overrides[key]) state.generator[key] = saved[key];
            } catch {
              // Hostile accessor: leave the live value alone.
            }
          }
        };
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const idx = renderWaiters.indexOf(onSettle);
          if (idx >= 0) renderWaiters.splice(idx, 1);
          restore();
          reject(new Error("QR render timed out"));
        }, RENDER_ONCE_TIMEOUT_MS);
        const onSettle = (result, error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          restore();
          if (error || !result) reject(error || new Error("QR render failed"));
          else resolve(result);
        };
        renderWaiters.push(onSettle);
        // One-off renders bypass the UI-sync suppression window (consumed by
        // the next pass): without this a render queued during syncConfigToUI
        // never runs and the waiter above hangs until the timeout.
        forceNextRender = true;
        try {
          generateQR(true);
        } catch (err) {
          forceNextRender = false;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            const idx = renderWaiters.indexOf(onSettle);
            if (idx >= 0) renderWaiters.splice(idx, 1);
            restore();
            reject(err);
          }
        }
      })
  );
  renderQueue = task.catch(() => {});
  return task;
}

export function generateQR(immediate = false) {
  if (suppressGenerationDuringSync > 0) {
    // A queued one-off render consumes the force flag and runs anyway — its
    // waiter would otherwise never settle. Ordinary event renders queue one
    // coalesced repaint for the end of the sync.
    if (forceNextRender) forceNextRender = false;
    else {
      generationQueuedDuringSync = true;
      return;
    }
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
    markRenderBusy();
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
      if (DOM.qrCanvasContainer) {
        DOM.qrCanvasContainer.style.display = "flex";
      }
      // Keep the current code on screen while the next one renders; the
      // skeleton is only for the very first render (nothing to show yet).
      if (DOM.qrLoading && (!DOM.qrCanvasContainer || !DOM.qrCanvasContainer.querySelector("svg"))) {
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
          if (DOM.marginWarning) DOM.marginWarning.classList.add("hidden");
          if (DOM.qrCanvasContainer) DOM.qrCanvasContainer.style.display = "flex";
        }
      }

      const { totalMarginPx, w, h } = layout;
      // Square canvas: modules are square, so the width drives both edges and
      // the render never rewrites the height input's own state value. (The
      // width/height inputs stay linked in the dimension controls.)

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
      const hasSvg = DOM.qrCanvasContainer ? Boolean(DOM.qrCanvasContainer.querySelector("svg")) : false;
      const reused = renderKey === lastRenderKey && hasSvg;
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
        // Only overflow-shaped failures mean "data too large". Anything else
        // (TypeErrors, renderer bugs, aborted loads) must not wear that copy:
        // surface the underlying message so the failure is distinguishable.
        const raw = e && e.message ? String(e.message) : "";
        const isOverflow = /overflow|too (?:long|large)|code length/i.test(raw);
        const msg = isOverflow
          ? t("generator.dataTooLarge", { ecc: state.generator.ecc })
          : raw
            ? t("generator.failed", { message: raw })
            : t("generator.dataTooLargeGeneric");
        showQrUnavailable(msg);
        announce(t("generator.failed", { message: msg }));
        settleRenderWaiters(null, e instanceof Error ? e : new Error(msg));
        return;
      }

      if (!isCurrent()) return;

      if (DOM.qrCanvasContainer) {
        DOM.qrCanvasContainer.classList.toggle("is-framed", state.generator.frameStyle !== "none");
        if (!reused) {
          DOM.qrCanvasContainer.innerHTML = renderedSvg;
        }
      }
      // Dedicated print surface: populated with the exact artifact so the
      // print stylesheet (which hides body > :not(#print-root)) preserves the
      // ancestor chain instead of display:none-ing the QR with its parents.
      try {
        const printRoot = document.getElementById("print-root");
        if (printRoot && !reused) printRoot.innerHTML = renderedSvg;
      } catch {
        /* print surface is best-effort */
      }
      // Publish the exact rendered SVG so exports match the preview (masks
      // included) and use the computed dimensions rather than requested ones.
      setRenderInfo({ svg: renderedSvg, w, h, moduleCount, userMarginPx });
      settleRenderWaiters({ svg: renderedSvg, layout, w, h, moduleCount, userMarginPx }, null);
      const svgEl = DOM.qrCanvasContainer ? DOM.qrCanvasContainer.querySelector("svg") : null;
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
      if (DOM.emptyStateQr) {
        DOM.emptyStateQr.classList.add("hidden");
        DOM.emptyStateQr.classList.remove("bg-black");
        DOM.emptyStateQr.classList.add("bg-black/90");
      }
      if (DOM.qrPreviewContainer) DOM.qrPreviewContainer.classList.add("has-qr");
      if (DOM.btnDownload) DOM.btnDownload.disabled = false;
      if (DOM.btnCopy) DOM.btnCopy.disabled = false;
      if (DOM.btnShareLink) DOM.btnShareLink.disabled = false;
      if (DOM.btnSave) {
        if (isCurrentConfigSaved()) {
          DOM.btnSave.disabled = true;
          DOM.btnSave.textContent = t("controls.saved");
        } else {
          DOM.btnSave.disabled = false;
          DOM.btnSave.textContent = t("common.save");
        }
      }
      announce(t("generator.ready"));
      // A memo-reused render shows byte-identical markup, so there is nothing
      // new to check: re-decoding every 150ms typing tick on the main thread
      // is what made the badge jank the panel. The exact artifact plus the
      // payload it must decode to travel together, so the verdict can never
      // describe a different render than the one on screen.
      if (!reused) {
        validateQrReadability({ svg: renderedSvg, w, h, moduleCount, userMarginPx }, text);
      }
    } finally {
      isGenerating = false;
      markRenderIdle();
      if (pendingGeneration) {
        pendingGeneration = false;
        generateQR(true);
      } else if (isCurrent() && DOM.qrLoading) {
        // Only the owning pass may park the skeleton: a superseded pass
        // finishing here used to hide the live render's loading state.
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
