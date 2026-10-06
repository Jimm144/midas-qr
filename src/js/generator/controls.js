/**
 * Generator config-panel wiring: colors, dimensions, shapes/frames, logo,
 * Save/Share buttons and the one-shot state→UI sync. Split out of main.js.
 */
import { DOM } from "../ui/dom.js";
import { state, captureGeneratorFields } from "../state";
import {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_LOGO_SIZE,
  FRAME_TEXT_SIZE_BOUNDS,
  GENERATOR_NUMERIC_BOUNDS,
  MAX_GENERATOR_HISTORY,
  MAX_LOGO_BYTES,
  MAX_FRAME_TEXT_LEN,
} from "../constants.js";
import {
  snapshot,
  formatHistoryTimestamp,
  isSafeBitmapDataUrl,
  isHttpUrl,
  HEX_COLOR_RE,
  clampNumber,
  copyTextToClipboard,
  truncateSafe,
} from "../utils.js";
import { checkUrlValid } from "./formatters.js";
import { cpActiveTarget, updateFromHex, updateColorState, paintSwatch } from "../ui/color-picker.js";
import { announce } from "../ui/announce.js";
import { t } from "../i18n.js";
import { flashButton, refreshCustomSelect, syncCustomSelect } from "../ui/components.js";
import { syncSearchableSelect } from "../ui/searchable-select.js";
import { generateQR, syncLogoSizeReadout } from "./generator.js";
import { renderGeneratorHistory, saveGeneratorHistory } from "./history.js";
import { encodeStateToUrl } from "../share.js";
import { frameTextFill } from "./frame.js";
import { framesConfig, defaultFrameTextEnabled } from "../frames";

let colorControlsReady = false;

/**
 * Reflect background-transparency state on the background color controls:
 * class-based dimming for pointers plus real `disabled` so the hex field and
 * picker button leave the keyboard tab order instead of accepting edits that
 * are then ignored on render.
 */
function syncBgColorControls() {
  if (!DOM.bgColorPickerGroup) return;
  const transparent = !!state.generator.bgTransparent;
  DOM.bgColorPickerGroup.classList.toggle("opacity-50", transparent);
  DOM.bgColorPickerGroup.classList.toggle("pointer-events-none", transparent);
  DOM.bgColorPickerGroup.querySelectorAll("input, button").forEach((child) => {
    if ("disabled" in child) child.disabled = transparent;
    if (transparent) child.setAttribute("aria-disabled", "true");
    else child.removeAttribute("aria-disabled");
  });
}

/** Background-transparent checkbox + 5 color hex-text input handlers + picker sync. */
export function initColorControls() {
  if (colorControlsReady) return;
  colorControlsReady = true;
  if (DOM.qrBgTransparent) {
    // The checkbox answers "does the code have a background?": checked =
    // solid background color, unchecked = transparent.
    DOM.qrBgTransparent.checked = !state.generator.bgTransparent;
    DOM.qrBgTransparent.addEventListener("change", (e) => {
      state.generator.bgTransparent = !e.target.checked;
      syncBgColorControls();
      generateQR();
    });
    syncBgColorControls();
  }

  const wireColorInput = (el, target, extra) => {
    if (!el) return;
    el.addEventListener("input", (e) => {
      const val = e.target.value;
      if (HEX_COLOR_RE.test(val)) {
        updateColorState(target, val);
        if (extra) extra.forEach((t) => updateColorState(t, val));
        if (cpActiveTarget === target) updateFromHex(val);
      }
    });
  };
  wireColorInput(DOM.colorBgText, "bg");
  wireColorInput(DOM.colorDotsText, "dots");
  wireColorInput(DOM.colorCornersSquareText, "cornersSquare");
  wireColorInput(DOM.colorCornersDotText, "cornersDot");
  if (DOM.colorFrameText) wireColorInput(DOM.colorFrameText, "frame");
  if (DOM.colorFrameTextColor) wireColorInput(DOM.colorFrameTextColor, "frameText");
}

let dimensionControlsReady = false;

/**
 * Validate on `input` (flag range errors, keep the user's draft text), commit
 * the clamped value on `change`/`blur`/`Enter` with writeback + render.
 */
function wireNumericInput(el, { parse, fallback, bounds, commit, mirror } = {}) {
  if (!el) return;
  const readRaw = () => parse(el.value);
  el.addEventListener("input", () => {
    // Validate only: the draft stays untouched (no clamping, no writeback, no
    // render) so partially typed values like "1" on the way to "1000" survive.
    const raw = readRaw();
    if (raw === null || Number.isNaN(raw)) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  });
  const commitFromField = () => {
    const raw = readRaw();
    const value = clampNumber(raw === null || Number.isNaN(raw) ? fallback : raw, bounds);
    el.removeAttribute("aria-invalid");
    commit(value, { writeback: true });
    if (mirror) mirror(value);
  };
  el.addEventListener("change", commitFromField);
  el.addEventListener("blur", commitFromField);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitFromField();
    }
  });
}

/** Width / height / border-radius / margin. */
export function initDimensionControls() {
  if (dimensionControlsReady) return;
  dimensionControlsReady = true;
  // QR modules are square, so width and height are linked: editing either
  // updates the other. Values are validated live on input (draft preserved)
  // and clamped + written back on commit (change/blur/Enter), so an
  // out-of-range entry can never render, export or travel in a share link.
  const parseInt10 = (v) => {
    if (String(v).trim() === "") return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  if (DOM.qrWidth || DOM.qrHeight) {
    const commitLinked = (value, { writeback }) => {
      state.generator.width = value;
      state.generator.height = value;
      if (writeback) {
        if (DOM.qrWidth) DOM.qrWidth.value = String(value);
        if (DOM.qrHeight) DOM.qrHeight.value = String(value);
      }
      generateQR();
    };
    const mirror = (value) => {
      if (DOM.qrWidth) DOM.qrWidth.value = String(value);
      if (DOM.qrHeight) DOM.qrHeight.value = String(value);
    };
    if (DOM.qrWidth)
      wireNumericInput(DOM.qrWidth, {
        parse: parseInt10,
        fallback: DEFAULT_WIDTH,
        bounds: GENERATOR_NUMERIC_BOUNDS.width,
        commit: commitLinked,
        mirror,
      });
    if (DOM.qrHeight)
      wireNumericInput(DOM.qrHeight, {
        parse: parseInt10,
        fallback: DEFAULT_HEIGHT,
        bounds: GENERATOR_NUMERIC_BOUNDS.height,
        commit: commitLinked,
        mirror,
      });
  }
  if (DOM.qrRadius) {
    wireNumericInput(DOM.qrRadius, {
      parse: parseInt10,
      fallback: 0,
      bounds: GENERATOR_NUMERIC_BOUNDS.qrRadius,
      commit: (value, { writeback }) => {
        // Clamp and write back on commit, like width/height: the HTML `max`
        // does not stop typing, and an unclamped value would survive in state
        // until the next load silently changed it.
        state.generator.qrRadius = value;
        if (writeback) DOM.qrRadius.value = String(value);
        generateQR();
      },
    });
  }
  if (DOM.qrMargin) {
    wireNumericInput(DOM.qrMargin, {
      parse: parseInt10,
      fallback: 0,
      bounds: GENERATOR_NUMERIC_BOUNDS.margin,
      commit: (value, { writeback }) => {
        state.generator.margin = value;
        if (writeback) DOM.qrMargin.value = String(value);
        generateQR();
      },
    });
  }
}

let shapeControlsReady = false;

/**
 * Reflect the frame-text toggle on the Text and Text size inputs: disabled
 * (and thus out of the tab order) whenever the frame renders no text band.
 */
function syncFrameTextControls() {
  const enabled = Boolean(state.generator.frameTextEnabled);
  if (DOM.qrFrameTextEnabled) DOM.qrFrameTextEnabled.checked = enabled;
  if (DOM.qrFrameText) DOM.qrFrameText.disabled = !enabled;
  if (DOM.qrFrameSize) DOM.qrFrameSize.disabled = !enabled;
}

/** Body/outer/inner corner shapes, overall mask + custom path, frame style/text, error-correction. */
export function initShapeAndFrameControls() {
  if (shapeControlsReady) return;
  shapeControlsReady = true;
  const on = (el, event, handler) => {
    if (el) el.addEventListener(event, handler);
  };
  on(DOM.qrShapeBody, "change", (e) => {
    state.generator.shapeBody = e.target.value;
    generateQR();
  });
  on(DOM.qrShapeOuter, "change", (e) => {
    state.generator.shapeOuter = e.target.value;
    generateQR();
  });
  on(DOM.qrShapeInner, "change", (e) => {
    state.generator.shapeInner = e.target.value;
    generateQR();
  });
  on(DOM.qrMaskType, "change", (e) => {
    state.generator.maskType = e.target.value;
    if (DOM.maskCustomContainer) {
      if (state.generator.maskType === "custom") {
        DOM.maskCustomContainer.classList.remove("hidden");
        DOM.maskCustomContainer.classList.add("flex");
      } else {
        DOM.maskCustomContainer.classList.add("hidden");
        DOM.maskCustomContainer.classList.remove("flex");
      }
    }
    generateQR();
  });
  on(DOM.qrMaskCustom, "input", (e) => {
    state.generator.maskCustom = e.target.value;
    generateQR();
  });
  const FRAME_RADIUS_DEFAULTS = {
    rounded: 8,
    dashed: 6,
    scan: 6,
    label: 6,
    badge: 6,
    none: 0,
  };
  on(DOM.qrFrameStyle, "change", (e) => {
    const nextFrame = e.target.value;
    // syncConfigToUI() writes the current value back into the select and then
    // dispatches change; treating that as a user pick would re-apply the
    // frame's default radius over an explicit one (boot stale-state guard,
    // ?radius= share URL, or a radius restored from history). Only a real
    // value change applies the default.
    const isProgrammaticSync = nextFrame === state.generator.frameStyle;
    state.generator.frameStyle = nextFrame;
    if (!isProgrammaticSync) {
      const defaultRadius = FRAME_RADIUS_DEFAULTS[nextFrame] ?? 0;
      state.generator.qrRadius = defaultRadius;
      if (DOM.qrRadius) {
        DOM.qrRadius.value = String(defaultRadius);
      }
      // Same rule for text visibility: a real style change lands on the
      // style's default (open frames hide the text, bar/plain frames show it).
      state.generator.frameTextEnabled = defaultFrameTextEnabled(nextFrame);
      syncFrameTextControls();
    }
    generateQR();
  });
  on(DOM.qrFrameText, "input", (e) => {
    state.generator.frameText = truncateSafe(e.target.value, MAX_FRAME_TEXT_LEN);
    if (DOM.qrFrameText.value !== state.generator.frameText) {
      DOM.qrFrameText.value = state.generator.frameText;
    }
    if (state.generator.frameStyle !== "none") generateQR();
  });
  on(DOM.qrFrameSize, "input", (e) => {
    // Validate only; the clamped commit + writeback happen on change/blur so
    // partially typed drafts are preserved while typing.
    const val = parseFloat(e.target.value);
    if (!Number.isFinite(val)) e.target.setAttribute("aria-invalid", "true");
    else e.target.removeAttribute("aria-invalid");
  });
  const commitFrameSize = () => {
    if (!DOM.qrFrameSize) return;
    const val = parseFloat(DOM.qrFrameSize.value);
    const committed = clampNumber(Number.isFinite(val) ? val : FRAME_TEXT_SIZE_BOUNDS.min, FRAME_TEXT_SIZE_BOUNDS);
    DOM.qrFrameSize.removeAttribute("aria-invalid");
    DOM.qrFrameSize.value = String(committed);
    state.generator.frameTextSize = committed;
    if (state.generator.frameStyle !== "none") generateQR();
  };
  on(DOM.qrFrameSize, "change", commitFrameSize);
  on(DOM.qrFrameSize, "blur", commitFrameSize);
  on(DOM.qrFrameTextEnabled, "change", (e) => {
    state.generator.frameTextEnabled = Boolean(e.target.checked);
    syncFrameTextControls();
    if (state.generator.frameStyle !== "none") generateQR();
  });
  syncFrameTextControls();
  on(DOM.qrFrameFont, "change", (e) => {
    state.generator.frameFont = e.target.value;
    if (state.generator.frameStyle !== "none") generateQR();
  });
  on(DOM.qrEcc, "change", (e) => {
    state.generator.ecc = e.target.value;
    generateQR();
  });
}

/** Force ECC to H when a logo is attached (preserves scannability under the logo). */
function forceEccHighForLogo() {
  if (state.generator.ecc !== "H") {
    if (DOM.qrEcc) DOM.qrEcc.value = "H";
    state.generator.ecc = "H";
    // Never cascade during a programmatic sync: the caller already refreshes
    // widgets, and a change event here would re-enter shape/frame handlers.
    if (!isSyncSuppressing() && DOM.qrEcc) DOM.qrEcc.dispatchEvent(new Event("change"));
    else if (DOM.qrEcc) refreshSelectWidgets(DOM.qrEcc);
  }
}

// SVG logos can carry script and execute when the exported QR (as SVG) is
// reopened in a browser. Bitmap MIMEs only. http(s) is allowed for remote
// logos, but it must be a real, host-bearing http(s) URL — scheme-only strings
// like `https://` are not fetched and just strand a broken logo in state.
export function isSafeLogoDataUrl(url) {
  if (typeof url !== "string") return false;
  if (url.startsWith("data:")) {
    return isSafeBitmapDataUrl(url);
  }
  return isHttpUrl(url) && checkUrlValid(url);
}

let logoControlsReady = false;

/** File upload / URL / margin / size / clear for the logo overlay. */
export function initLogoControls() {
  if (logoControlsReady) return;
  logoControlsReady = true;
  const on = (el, event, handler) => {
    if (el) el.addEventListener(event, handler);
  };
  const showWarning = (message) => {
    if (DOM.logoWarning) {
      DOM.logoWarning.textContent = message;
      DOM.logoWarning.classList.remove("hidden");
    } else if (DOM.emptyStateQr) {
      DOM.emptyStateQr.textContent = message;
      DOM.emptyStateQr.classList.remove("hidden");
    }
    announce(message);
  };
  const clearWarning = () => {
    if (DOM.logoWarning) {
      DOM.logoWarning.textContent = "";
      DOM.logoWarning.classList.add("hidden");
    }
  };

  // The file input is visually hidden; this button is its keyboard-operable
  // opener (a <label> is not in the tab order).
  on(DOM.btnPickLogo, "click", () => {
    if (DOM.logoFile) DOM.logoFile.click();
  });

  // #logo-options is dimmed and pointer-blocked until a logo exists, but its
  // class is toggled from both this module and generator.js's syncConfigToUI.
  // Observing the class keeps the real `disabled` state (and thus the tab
  // order) truthful for keyboard users no matter which path toggled it.
  if (DOM.logoOptions && typeof MutationObserver === "function") {
    const syncLogoOptionDisabled = () => {
      const isDisabled = DOM.logoOptions.classList.contains("pointer-events-none");
      DOM.logoOptions.querySelectorAll("input, select, button").forEach((child) => {
        if ("disabled" in child) child.disabled = isDisabled;
        if (isDisabled) child.setAttribute("aria-disabled", "true");
        else child.removeAttribute("aria-disabled");
      });
    };
    new MutationObserver(syncLogoOptionDisabled).observe(DOM.logoOptions, {
      attributes: true,
      attributeFilter: ["class"],
    });
    syncLogoOptionDisabled();
  }

  on(DOM.logoFile, "change", (e) => {
    const file = e.target.files && e.target.files[0];
    // Reset the input so re-picking the same file fires `change` again, and so
    // the URL box's "empty" check is not tied to a stale file selection.
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      if (DOM.qrLoading) DOM.qrLoading.classList.add("hidden");
      showWarning(t("image.tooLarge", { size: (file.size / (1024 * 1024)).toFixed(1) }));
      // Only reveal Clear when a logo actually exists: an oversized reject
      // with no previous logo must not unhide a dead button.
      if (state.generator.logoDataUrl && DOM.btnClearLogo) DOM.btnClearLogo.classList.remove("hidden");
      return;
    }
    if (file.type && !file.type.startsWith("image/")) {
      showWarning(t("image.unsupportedFormat"));
      return;
    }
    // Block SVG uploads by extension even if MIME lies (no SVG by default).
    if (/\.(svg)$/i.test(file.name) || file.type === "image/svg+xml") {
      showWarning(t("image.logoSvgDisabled"));
      return;
    }
    state.generator.logoFilename = file.name;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      if (!isSafeLogoDataUrl(dataUrl)) {
        showWarning(t("image.unsupportedImage"));
        return;
      }
      clearWarning();
      state.generator.logoDataUrl = dataUrl;
      if (DOM.logoOptions) DOM.logoOptions.classList.remove("opacity-50", "pointer-events-none");
      if (DOM.btnClearLogo) DOM.btnClearLogo.classList.remove("hidden");
      forceEccHighForLogo();
      generateQR(true);
    };
    reader.onerror = (err) => {
      console.error("[QR] logo read failed:", err);
      showWarning(t("image.readFailed"));
    };
    reader.readAsDataURL(file);
  });

  const commitLogoUrl = (rawValue, { fromChange } = {}) => {
    const val = String(rawValue == null ? "" : rawValue).trim();
    if (val === "") {
      clearWarning();
      // Emptying the box clears the logo outright: the old guard also required
      // an empty file input, so a once-chosen file left a stale logo behind.
      if (DOM.btnClearLogo && !DOM.btnClearLogo.classList.contains("hidden")) {
        DOM.btnClearLogo.click();
      }
      return;
    }
    if (!isSafeLogoDataUrl(val)) {
      showWarning(t("image.logoUrlInvalid"));
      return;
    }
    if (val.startsWith("http://") || val.startsWith("https://")) {
      // A remote URL fetches (and leaks IP/UA) the moment it renders. Confirm
      // like share.js's remote-logo path; deny (empty confirm) keeps state.
      let host;
      try {
        host = new URL(val).host || val;
      } catch {
        showWarning(t("image.logoUrlInvalid"));
        return;
      }
      let confirmed;
      try {
        confirmed =
          typeof window !== "undefined" && typeof window.confirm === "function"
            ? window.confirm(t("share.remoteLogoConfirm", { host }))
            : false;
      } catch {
        confirmed = false;
      }
      if (!confirmed) {
        showWarning(t("image.remoteLogo"));
        return;
      }
      clearWarning();
    } else {
      clearWarning();
    }
    state.generator.logoDataUrl = val;
    state.generator.logoFilename = "url";
    if (DOM.logoOptions) DOM.logoOptions.classList.remove("opacity-50", "pointer-events-none");
    if (DOM.btnClearLogo) DOM.btnClearLogo.classList.remove("hidden");
    forceEccHighForLogo();
    generateQR(true);
    void fromChange;
  };

  on(DOM.logoUrl, "input", (e) => {
    // Live-validate only: committing an http(s) URL on every keystroke would
    // fetch (IP leak) before the user finishes typing. Commit on change/blur.
    const val = e.target.value.trim();
    if (val !== "" && !isSafeLogoDataUrl(val)) showWarning(t("image.logoUrlInvalid"));
  });
  on(DOM.logoUrl, "change", (e) => commitLogoUrl(e.target.value, { fromChange: true }));

  on(DOM.logoMargin, "input", (e) => {
    // Validate only; commit (clamp + writeback + render) on change/blur.
    const val = parseInt(e.target.value, 10);
    if (!Number.isFinite(val)) e.target.setAttribute("aria-invalid", "true");
    else e.target.removeAttribute("aria-invalid");
  });
  const commitLogoMargin = () => {
    if (!DOM.logoMargin) return;
    const val = parseInt(DOM.logoMargin.value, 10);
    const margin = clampNumber(Number.isFinite(val) ? val : 0, GENERATOR_NUMERIC_BOUNDS.imageMargin);
    DOM.logoMargin.removeAttribute("aria-invalid");
    DOM.logoMargin.value = String(margin);
    state.generator.imageMargin = margin;
    generateQR();
  };
  on(DOM.logoMargin, "change", commitLogoMargin);
  on(DOM.logoMargin, "blur", commitLogoMargin);
  on(DOM.logoSize, "input", (e) => {
    const val = parseFloat(e.target.value);
    if (!Number.isFinite(val)) {
      e.target.setAttribute("aria-invalid", "true");
      return;
    }
    e.target.removeAttribute("aria-invalid");
    // A logo larger than ~half the code hurts scannability even at ECC H.
    state.generator.logoSizeProportion = Math.min(0.5, Math.max(0.1, val));
    syncLogoSizeReadout();
    generateQR();
  });
  const commitLogoSize = () => {
    if (!DOM.logoSize) return;
    const val = parseFloat(DOM.logoSize.value) || DEFAULT_LOGO_SIZE;
    const committed = Math.min(0.5, Math.max(0.1, val));
    DOM.logoSize.removeAttribute("aria-invalid");
    DOM.logoSize.value = String(committed);
    state.generator.logoSizeProportion = committed;
    syncLogoSizeReadout();
    generateQR();
  };
  on(DOM.logoSize, "change", commitLogoSize);
  on(DOM.logoSize, "blur", commitLogoSize);

  on(DOM.btnClearLogo, "click", () => {
    clearWarning();
    state.generator.logoDataUrl = null;
    state.generator.logoFilename = null;
    if (DOM.logoFile) DOM.logoFile.value = "";
    if (DOM.logoUrl) DOM.logoUrl.value = "";
    if (DOM.logoOptions) DOM.logoOptions.classList.add("opacity-50", "pointer-events-none");
    if (DOM.btnClearLogo) DOM.btnClearLogo.classList.add("hidden");
    generateQR(true);
  });
}

let backgroundImageControlsReady = false;

/** Background image upload / clear. Same safety rules as the logo overlay. */
export function initBackgroundImageControls() {
  if (backgroundImageControlsReady) return;
  backgroundImageControlsReady = true;
  const on = (el, event, handler) => {
    if (el) el.addEventListener(event, handler);
  };
  const warn = (message) => {
    if (!DOM.bgImageWarning) return;
    DOM.bgImageWarning.textContent = message;
    DOM.bgImageWarning.classList.remove("hidden");
    announce(message);
  };

  on(DOM.btnPickBgImage, "click", () => {
    if (DOM.bgImageFile) DOM.bgImageFile.click();
  });

  on(DOM.bgImageFile, "change", (e) => {
    const file = e.target.files && e.target.files[0];
    // Reset so re-picking the same file fires `change` again (parity with logo).
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      warn(t("image.tooLarge", { size: (file.size / (1024 * 1024)).toFixed(1) }));
      return;
    }
    if (file.type && !file.type.startsWith("image/")) {
      warn(t("image.unsupportedFormat"));
      return;
    }
    // Block SVG uploads by extension even if MIME lies (no SVG by default).
    if (/\.(svg)$/i.test(file.name) || file.type === "image/svg+xml") {
      warn(t("image.backgroundSvgDisabled"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      if (!isSafeBitmapDataUrl(dataUrl)) {
        warn(t("image.unsupportedImage"));
        return;
      }
      state.generator.bgImageDataUrl = dataUrl;
      if (DOM.bgImageWarning) DOM.bgImageWarning.classList.add("hidden");
      if (DOM.btnClearBgImage) DOM.btnClearBgImage.classList.remove("hidden");
      forceEccHighForLogo();
      generateQR(true);
    };
    reader.onerror = (err) => {
      console.error("[QR] background image read failed:", err);
      warn(t("image.readFailed"));
    };
    reader.readAsDataURL(file);
  });

  on(DOM.btnClearBgImage, "click", () => {
    state.generator.bgImageDataUrl = null;
    if (DOM.bgImageFile) DOM.bgImageFile.value = "";
    if (DOM.bgImageWarning) DOM.bgImageWarning.classList.add("hidden");
    if (DOM.btnClearBgImage) DOM.btnClearBgImage.classList.add("hidden");
    generateQR(true);
  });
}

let saveButtonReady = false;

/** Save current generator config into history (max 50). */
export function initSaveButton() {
  if (saveButtonReady || !DOM.btnSave) return;
  saveButtonReady = true;
  DOM.btnSave.addEventListener("click", async () => {
    if (!state.generator.dataString || !state.generator.isValid) return;
    captureGeneratorFields();
    const configCopy = snapshot(state.generator);
    // Strip multi-MB images from the history snapshot BEFORE persisting: the
    // live state keeps them, but a 50-entry history of 4 MB logos can never
    // fit in localStorage — persisting first and trimming after quota wastes
    // a failed write and a re-render.
    const tooBig = (v) => typeof v === "string" && v.length >= 64 * 1024;
    if (tooBig(configCopy.logoDataUrl) || tooBig(configCopy.bgImageDataUrl)) {
      console.warn("[history] Large images stripped from history snapshot before persist.");
      configCopy.logoDataUrl = null;
      configCopy.bgImageDataUrl = null;
    }
    const timestamp = Date.now();
    const dateStr = formatHistoryTimestamp(timestamp);
    state.generatorHistory.unshift({ id: timestamp, config: configCopy, time: dateStr });
    if (state.generatorHistory.length > MAX_GENERATOR_HISTORY) state.generatorHistory.pop();
    const ok = saveGeneratorHistory();
    renderGeneratorHistory();
    if (ok) {
      DOM.btnSave.textContent = t("controls.saved");
      DOM.btnSave.disabled = true;
      announce(t("controls.savedToHistory"));
    } else {
      // Explicit failure: don't claim "Saved" when persistence failed.
      DOM.btnSave.textContent = t("common.save");
      DOM.btnSave.disabled = false;
      announce(t("history.exportFailed"));
    }
    return ok;
  });
}

let shareLinkButtonReady = false;

export function initShareLinkButton() {
  if (shareLinkButtonReady || !DOM.btnShareLink) return;
  shareLinkButtonReady = true;
  DOM.btnShareLink.addEventListener("click", async () => {
    const url = encodeStateToUrl();
    // Prefer the device's native share sheet (mobile/desktop OS share);
    // fall back to copying the link where Web Share is unavailable.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "Midas QR",
          text: t("controls.shareText"),
          url,
        });
        announce(t("controls.shareDone"));
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return; // user dismissed the sheet
        console.warn("[QR] native share failed, copying instead:", err);
      }
    }
    try {
      const ok = await copyTextToClipboard(url);
      if (!ok) return;
      announce(t("controls.shareCopied"));
      flashButton(DOM.btnShareLink, t("controls.copied"));
    } catch (err) {
      console.warn("[QR] share link copy failed:", err);
    }
  });
}

/** Push current state values into the swatches and input fields, then dispatch change events + initial render. */
export let syncSuppressCount = 0;
export function isSyncSuppressing() {
  return syncSuppressCount > 0;
}
export function syncUIFromState() {
  syncSuppressCount += 1;
  try {
    internalSyncUIFromState();
  } finally {
    syncSuppressCount = Math.max(0, syncSuppressCount - 1);
  }
}

function internalSyncUIFromState() {
  const setValue = (el, value) => {
    if (el) el.value = String(value);
  };
  setValue(DOM.colorBgText, state.generator.bgColor.toUpperCase());
  paintSwatch(document.getElementById("swatch-bg-bg"), "bg", state.generator.bgColor);
  setValue(DOM.colorDotsText, state.generator.dotsColor.toUpperCase());
  paintSwatch(document.getElementById("swatch-bg-dots"), "dots", state.generator.dotsColor);
  setValue(DOM.colorCornersSquareText, state.generator.cornersSquareColor.toUpperCase());
  paintSwatch(
    document.getElementById("swatch-bg-cornersSquare"),
    "cornersSquare",
    state.generator.cornersSquareColor
  );
  setValue(DOM.colorCornersDotText, state.generator.cornersDotColor.toUpperCase());
  paintSwatch(document.getElementById("swatch-bg-cornersDot"), "cornersDot", state.generator.cornersDotColor);
  setValue(DOM.qrWidth, state.generator.width);
  setValue(DOM.qrHeight, state.generator.height);
  setValue(DOM.qrRadius, state.generator.qrRadius);
  setValue(DOM.qrMargin, state.generator.margin);
  setValue(DOM.qrEcc, state.generator.ecc);
  setValue(DOM.qrShapeBody, state.generator.shapeBody);
  setValue(DOM.qrShapeOuter, state.generator.shapeOuter);
  setValue(DOM.qrShapeInner, state.generator.shapeInner);
  setValue(DOM.qrMaskType, state.generator.maskType);
  setValue(DOM.qrMaskCustom, state.generator.maskCustom || "");
  setValue(DOM.qrFrameStyle, state.generator.frameStyle);
  setValue(DOM.qrFrameText, state.generator.frameText);
  syncFrameTextControls();
  if (DOM.colorFrameTextColor) {
    const frameConfig = framesConfig[state.generator.frameStyle];
    const frameTextPaint = state.generator.frameTextColor || frameTextFill(frameConfig);
    DOM.colorFrameTextColor.value = frameTextPaint.toUpperCase();
    const frameTextSwatch = document.getElementById("swatch-bg-frame-text");
    if (frameTextSwatch) frameTextSwatch.style.background = frameTextPaint;
  }
  if (state.generator.maskType === "custom" && DOM.maskCustomContainer) {
    DOM.maskCustomContainer.classList.remove("hidden");
    DOM.maskCustomContainer.classList.add("flex");
  }

  const bgImage = state.generator.bgImageDataUrl;
  if (DOM.btnClearBgImage) DOM.btnClearBgImage.classList.toggle("hidden", !bgImage);
  if (bgImage && !isSafeBitmapDataUrl(bgImage)) {
    if (DOM.bgImageWarning) {
      DOM.bgImageWarning.textContent = t("image.unsupportedBackground");
      DOM.bgImageWarning.classList.remove("hidden");
    }
  } else if (DOM.bgImageWarning) {
    DOM.bgImageWarning.classList.add("hidden");
  }

  if (DOM.themeSelect) refreshSelectWidgets(DOM.themeSelect);
  if (DOM.modeSelect) refreshSelectWidgets(DOM.modeSelect);

  [
    DOM.qrEcc,
    DOM.qrShapeBody,
    DOM.qrShapeOuter,
    DOM.qrShapeInner,
    DOM.qrMaskType,
    DOM.qrFrameStyle,
    DOM.dataType,
    DOM.qrFrameFont,
  ].forEach((el) => {
    // Suppressed by design: dispatching change here re-entered the shape/frame
    // handlers as cascades (frame default radius/text stomping restored state).
    // Refresh the visual widgets directly instead.
    if (el) refreshSelectWidgets(el);
  });
  generateQR();
}

function refreshSelectWidgets(el) {
  if (!el) return;
  try {
    if (typeof refreshCustomSelect === "function") refreshCustomSelect(el);
    else if (typeof syncCustomSelect === "function") syncCustomSelect(el);
  } catch {
    /* widget refresh is best-effort during hydration */
  }
  try {
    if (typeof syncSearchableSelect === "function") syncSearchableSelect(el);
  } catch {
    /* ignore */
  }
}
