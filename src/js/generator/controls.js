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
import { flashButton } from "../ui/components.js";
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

/** Width / height / border-radius / margin. */
export function initDimensionControls() {
  if (dimensionControlsReady) return;
  dimensionControlsReady = true;
  // QR modules are square, so width and height are linked: editing either
  // updates the other. Both are clamped to the shared numeric bounds and the
  // clamped value is written back, so an out-of-range entry can never render,
  // export or travel in a share link at a size the recipient would change.
  if (DOM.qrWidth) {
    DOM.qrWidth.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      const width = clampNumber(isNaN(val) ? DEFAULT_WIDTH : val, GENERATOR_NUMERIC_BOUNDS.width);
      state.generator.width = width;
      state.generator.height = width;
      e.target.value = String(width);
      if (DOM.qrHeight) DOM.qrHeight.value = String(width);
      generateQR();
    });
  }
  if (DOM.qrHeight) {
    DOM.qrHeight.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      const height = clampNumber(isNaN(val) ? DEFAULT_HEIGHT : val, GENERATOR_NUMERIC_BOUNDS.height);
      state.generator.height = height;
      state.generator.width = height;
      e.target.value = String(height);
      if (DOM.qrWidth) DOM.qrWidth.value = String(height);
      generateQR();
    });
  }
  if (DOM.qrRadius) {
    DOM.qrRadius.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      // Clamp and write back, like width/height above: the HTML `max` does not
      // stop typing, and an unclamped value would survive in state until the
      // next load silently changed it.
      const radius = clampNumber(isNaN(val) ? 0 : val, GENERATOR_NUMERIC_BOUNDS.qrRadius);
      state.generator.qrRadius = radius;
      e.target.value = String(radius);
      generateQR();
    });
  }
  if (DOM.qrMargin) {
    DOM.qrMargin.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      const margin = clampNumber(isNaN(val) ? 0 : val, GENERATOR_NUMERIC_BOUNDS.margin);
      state.generator.margin = margin;
      e.target.value = String(margin);
      generateQR();
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
    const val = parseFloat(e.target.value);
    if (!Number.isFinite(val)) return;
    state.generator.frameTextSize = clampNumber(val, FRAME_TEXT_SIZE_BOUNDS);
    if (state.generator.frameStyle !== "none") generateQR();
  });
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
    if (DOM.qrEcc) DOM.qrEcc.dispatchEvent(new Event("change"));
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
      if (DOM.btnClearLogo) DOM.btnClearLogo.classList.remove("hidden");
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

  on(DOM.logoUrl, "input", (e) => {
    const val = e.target.value.trim();
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
      showWarning(t("image.remoteLogo"));
    } else {
      clearWarning();
    }
    state.generator.logoDataUrl = val;
    state.generator.logoFilename = "url";
    if (DOM.logoOptions) DOM.logoOptions.classList.remove("opacity-50", "pointer-events-none");
    if (DOM.btnClearLogo) DOM.btnClearLogo.classList.remove("hidden");
    forceEccHighForLogo();
    generateQR(true);
  });

  on(DOM.logoMargin, "input", (e) => {
    const val = parseInt(e.target.value, 10);
    const margin = clampNumber(isNaN(val) ? 0 : val, GENERATOR_NUMERIC_BOUNDS.imageMargin);
    state.generator.imageMargin = margin;
    e.target.value = String(margin);
    generateQR();
  });
  on(DOM.logoSize, "input", (e) => {
    const val = parseFloat(e.target.value) || DEFAULT_LOGO_SIZE;
    // A logo larger than ~half the code hurts scannability even at ECC H.
    state.generator.logoSizeProportion = Math.min(0.5, Math.max(0.1, val));
    syncLogoSizeReadout();
    generateQR();
  });

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
    const timestamp = Date.now();
    const dateStr = formatHistoryTimestamp(timestamp);
    state.generatorHistory.unshift({ id: timestamp, config: configCopy, time: dateStr });
    if (state.generatorHistory.length > MAX_GENERATOR_HISTORY) state.generatorHistory.pop();
    saveGeneratorHistory();
    renderGeneratorHistory();
    DOM.btnSave.textContent = t("controls.saved");
    DOM.btnSave.disabled = true;
    announce(t("controls.savedToHistory"));
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
export function syncUIFromState() {
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

  if (DOM.themeSelect) DOM.themeSelect.dispatchEvent(new Event("change"));
  if (DOM.modeSelect) DOM.modeSelect.dispatchEvent(new Event("change"));

  [
    DOM.qrEcc,
    DOM.qrShapeBody,
    DOM.qrShapeOuter,
    DOM.qrShapeInner,
    DOM.qrMaskType,
    DOM.qrFrameStyle,
    DOM.dataType,
  ].forEach((el) => {
    if (el) el.dispatchEvent(new Event("change"));
  });
  generateQR();
}
