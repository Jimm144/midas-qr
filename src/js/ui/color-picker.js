import { DOM } from "./dom.js";
import { state } from "../state";
import { generateQR } from "../generator/generator.js";
import { syncCustomSelect, closeOpenCustomSelects } from "./components.js";
import { openPopover, closePopover } from "./popover.js";

export let cpActiveTarget = null; // 'bg' | 'dots' | 'cornersSquare' | 'cornersDot'
let originalColor = "#FFFFFF";
export const cpColor = { h: 0, s: 240, l: 120, r: 255, g: 0, b: 0, hex: "#FF0000" };
// HSV view of the picker's working color: hue 0-360, saturation/value 0-1.
// The saturation/value spectrum and the hue slider operate on these fields.
export const cpHsv = { h: 0, s: 1, v: 1 };
let isDraggingSpectrum = false;
let cpDragRect = null;
let cpSpectrumPaintPending = false;
let cpDragDebounceTimer = null;
let cpSpectrumBound = null;
let cpHexErrorTimer = null;
let cpGradHexErrorTimer = null;
let cpMouseUpHandler = null;
let cpTouchEndHandler = null;
let cpSpectrumDownHandler = null;
let cpSpectrumTouchStartHandler = null;
let cpSpectrumMoveHandler = null;
let cpSpectrumTouchMoveHandler = null;
let cpSpectrumKeyHandler = null;
let cpHideTimer = null;
let cpResizeTimer = null;

// Resolved in initColorPicker() so we don't touch the DOM before initDOM has run.
let cpPopup = null;
let cpCloseBtn = null;
let cpOkBtn = null;
let cpResetBtn = null;
let cpInputHex = null;
let cpSpectrum = null;
let cpHue = null;
let cpTransitionEndHandler = null;
let cpPreviousFocus = null;
let cpModeSolid = null;
let cpModeGradient = null;
let cpGradientControls = null;
let cpStop0 = null;
let cpStop1 = null;
let cpGradColor2 = null;
let cpGradType = null;
let cpGradAngle = null;
let cpActiveStop = 0;
let originalGradient = null;

/**
 * Converts RGB values to a hex color string.
 * @param {number} r - Red channel (0-255).
 * @param {number} g - Green channel (0-255).
 * @param {number} b - Blue channel (0-255).
 * @returns {string} Hex color string (e.g., "#FF0000").
 */
export function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/**
 * Converts a hex color string to RGB.
 * @param {string} hex - Hex color string.
 * @returns {{r: number, g: number, b: number}|null} RGB object or null if invalid.
 */
export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

/**
 * Converts Windows-style HSL (Hue 0-240, Saturation 0-240, Luminosity 0-240) to standard RGB.
 * @param {number} h - Hue (0-240).
 * @param {number} s - Saturation (0-240).
 * @param {number} l - Luminosity (0-240).
 * @returns {{r: number, g: number, b: number}} RGB object.
 */
export function winHslToRgb(h, s, l) {
  const h_std = (h % 240) / 240;
  const s_std = Math.min(240, Math.max(0, s)) / 240;
  const l_std = Math.min(240, Math.max(0, l)) / 240;
  let r, g, b;
  if (s_std === 0) {
    r = g = b = l_std;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l_std < 0.5 ? l_std * (1 + s_std) : l_std + s_std - l_std * s_std;
    const p = 2 * l_std - q;
    r = hue2rgb(p, q, h_std + 1 / 3);
    g = hue2rgb(p, q, h_std);
    b = hue2rgb(p, q, h_std - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

/**
 * Converts standard RGB to Windows-style HSL (0-240 scale).
 * @param {number} r - Red channel (0-255).
 * @param {number} g - Green channel (0-255).
 * @param {number} b - Blue channel (0-255).
 * @returns {{h: number, s: number, l: number}} Windows HSL object.
 */
export function rgbToWinHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  const h_win = Math.round(h * 240) % 240;
  const s_win = Math.round(s * 240);
  const l_win = Math.round(l * 240);
  return { h: h_win, s: s_win, l: l_win };
}

/**
 * Converts HSV (hue 0-360, saturation/value 0-1) to standard RGB.
 * @param {number} h - Hue in degrees (wraps).
 * @param {number} s - Saturation (0-1, clamped).
 * @param {number} v - Value/brightness (0-1, clamped).
 * @returns {{r: number, g: number, b: number}} RGB object.
 */
export function hsvToRgb(h, s, v) {
  const hue = (((h % 360) + 360) % 360) / 60;
  const sat = Math.min(1, Math.max(0, s));
  const val = Math.min(1, Math.max(0, v));
  const c = val * sat;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = val - c;
  let rgb;
  if (hue < 1) rgb = [c, x, 0];
  else if (hue < 2) rgb = [x, c, 0];
  else if (hue < 3) rgb = [0, c, x];
  else if (hue < 4) rgb = [0, x, c];
  else if (hue < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

/**
 * Converts standard RGB to HSV.
 * @param {number} r - Red channel (0-255).
 * @param {number} g - Green channel (0-255).
 * @param {number} b - Blue channel (0-255).
 * @returns {{h: number, s: number, v: number}} Hue 0-360, saturation/value 0-1.
 */
export function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * Canvas coordinate (CSS pixel center) of the current (s, v) position on the
 * saturation/value field. Kept pure so the indicator math is unit-testable.
 * @param {number} s - Saturation (0-1, left to right).
 * @param {number} v - Value/brightness (0-1, bottom to top).
 * @param {number} width - Canvas width in pixels.
 * @param {number} height - Canvas height in pixels.
 * @returns {{x: number, y: number}} Center of the indicator in canvas coordinates.
 */
export function spectrumIndicatorPos(s, v, width, height) {
  const sat = Math.min(1, Math.max(0, s));
  const val = Math.min(1, Math.max(0, v));
  const x = Math.floor(sat * Math.max(0, width - 1)) + 0.5;
  const y = Math.floor((1 - val) * Math.max(0, height - 1)) + 0.5;
  return { x, y };
}

/**
 * Inverse of spectrumIndicatorPos: the saturation/value pair under a canvas point.
 * @param {number} x - Canvas x in pixels.
 * @param {number} y - Canvas y in pixels.
 * @param {number} width - Canvas width in pixels.
 * @param {number} height - Canvas height in pixels.
 * @returns {{s: number, v: number}} Saturation/value (0-1).
 */
export function spectrumPickValue(x, y, width, height) {
  return {
    s: width > 1 ? Math.min(1, Math.max(0, x / (width - 1))) : 0,
    v: height > 1 ? 1 - Math.min(1, Math.max(0, y / (height - 1))) : 0,
  };
}

/**
 * Ring color that stays visible on top of a given backdrop color.
 * @param {number} r - Red channel (0-255).
 * @param {number} g - Green channel (0-255).
 * @param {number} b - Blue channel (0-255).
 * @returns {string} "#000000" on light backdrops, "#ffffff" on dark ones.
 */
export function spectrumIndicatorRing(r, g, b) {
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? "#000000" : "#ffffff";
}

/**
 * Keyboard deltas for the focused saturation/value field. Left/Right move
 * saturation, Up/Down move value and Ctrl+Left/Right move hue; Shift widens
 * the saturation/value step from 0.05 to 0.2 (hue step from 10deg to 30deg).
 * @param {string} key - KeyboardEvent.key.
 * @param {{shiftKey?: boolean, ctrlKey?: boolean}} [modifiers]
 * @returns {{h: number, s: number, v: number}} Deltas (hue in degrees, s/v 0-1).
 */
export function spectrumKeyDelta(key, modifiers = {}) {
  const { shiftKey = false, ctrlKey = false } = modifiers;
  const step = shiftKey ? 0.2 : 0.05;
  const hueStep = shiftKey ? 30 : 10;
  if (ctrlKey) {
    if (key === "ArrowLeft") return { h: -hueStep, s: 0, v: 0 };
    if (key === "ArrowRight") return { h: hueStep, s: 0, v: 0 };
    return { h: 0, s: 0, v: 0 };
  }
  switch (key) {
    case "ArrowLeft":
      return { h: 0, s: -step, v: 0 };
    case "ArrowRight":
      return { h: 0, s: step, v: 0 };
    case "ArrowUp":
      return { h: 0, s: 0, v: step };
    case "ArrowDown":
      return { h: 0, s: 0, v: -step };
    default:
      return { h: 0, s: 0, v: 0 };
  }
}

/** state key helpers */
const gradientKey = (target) => `${target}Gradient`;

/**
 * The gradient's end color (stop 1) as a string, tolerating hand-edited or
 * hydrated specs that omit `color2`.
 * @param {{color2?: string}|null|undefined} gradient
 * @returns {string}
 */
function gradientEndColor(gradient) {
  return gradient && typeof gradient.color2 === "string" ? gradient.color2 : "";
}

/**
 * Default end color for a fresh gradient: keep the start's hue/saturation and
 * shift lightness so stop 2 stays visible against both light and dark
 * backgrounds (pure black/white ends vanish on matching backgrounds).
 */
function defaultEndColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#8C8C8C";
  const hsl = rgbToWinHsl(rgb.r, rgb.g, rgb.b);
  const shifted = hsl.l >= 120 ? Math.max(0, hsl.l - 72) : Math.min(240, hsl.l + 72);
  const out = winHslToRgb(hsl.h, hsl.s, shifted);
  return rgbToHex(out.r, out.g, out.b);
}

/**
 * Paint a swatch element as a solid color or the target's two-stop gradient.
 * Exported so hydration (main.js) can render the same preview.
 */
export function paintSwatch(el, target, color) {
  if (!el) return;
  const g = state.generator[gradientKey(target)];
  if (g && g.color2) {
    const stops = `${color}, ${g.color2}`;
    el.style.background =
      g.type === "radial"
        ? `radial-gradient(circle, ${stops})`
        : `linear-gradient(${90 - (Number(g.rotation) || 0)}deg, ${stops})`;
  } else {
    el.style.background = color;
  }
}

/**
 * Coalesce the QR render triggered by a burst of color updates (spectrum drag,
 * slider drag or hex typing). State and swatches update immediately; only the
 * render waits. While dragging, a trailing 150 ms timeout renders the latest
 * value with generateQR(true); otherwise the generator's own debounce handles
 * it. The trailing render always runs, so the final value is never lost.
 */
function scheduleColorRender() {
  if (isDraggingSpectrum) {
    if (cpDragDebounceTimer) clearTimeout(cpDragDebounceTimer);
    cpDragDebounceTimer = setTimeout(() => generateQR(true), 150);
  } else {
    // Debounced like every other config change: typing a hex or clicking
    // presets coalesces into one render instead of one per event.
    generateQR();
  }
}

/** Refresh the trigger swatches that mirror a target (incl. medium-mode corner propagation). */
function repaintTargetSwatches(target, hex) {
  if (target === "frame") {
    state.generator.frameColor = hex;
    if (DOM.colorFrameText) DOM.colorFrameText.value = hex.toUpperCase();
    paintSwatch(document.getElementById("swatch-bg-frame"), "frame", hex);
    scheduleColorRender();
    return;
  }
  if (target === "bg") {
    paintSwatch(document.getElementById("swatch-bg-bg"), "bg", hex);
  } else if (target === "dots") {
    paintSwatch(document.getElementById("swatch-bg-dots"), "dots", hex);
    if (DOM.colorFgMediumText) {
      DOM.colorFgMediumText.value = hex.toUpperCase();
      paintSwatch(document.getElementById("swatch-bg-fg-medium"), "dots", hex);
    }
  } else if (target === "cornersSquare") {
    paintSwatch(document.getElementById("swatch-bg-cornersSquare"), "cornersSquare", hex);
  } else if (target === "cornersDot") {
    paintSwatch(document.getElementById("swatch-bg-cornersDot"), "cornersDot", hex);
  } else if (target === "frameText") {
    paintSwatch(document.getElementById("swatch-bg-frame-text"), "frameText", hex);
  }
}

/** Reflect the active target's gradient spec in the popup controls. */
function syncGradientUI() {
  if (!cpModeSolid && !cpModeGradient) return;
  const g = cpActiveTarget ? state.generator[gradientKey(cpActiveTarget)] : null;
  const isGradient = !!g;
  if (cpModeSolid) {
    cpModeSolid.classList.toggle("is-active", !isGradient);
    cpModeSolid.setAttribute("aria-pressed", String(!isGradient));
  }
  if (cpModeGradient) {
    cpModeGradient.classList.toggle("is-active", isGradient);
    cpModeGradient.setAttribute("aria-pressed", String(isGradient));
  }
  if (cpGradientControls) {
    cpGradientControls.classList.toggle("hidden", !g);
    cpGradientControls.classList.toggle("flex", !!g);
  }
  const startHex = cpActiveTarget ? state.generator[`${cpActiveTarget}Color`] : cpColor.hex;
  const endHex = gradientEndColor(g);
  if (cpStop0) cpStop0.style.background = startHex;
  if (cpStop1) cpStop1.style.background = endHex || "transparent";
  if (cpStop0) {
    cpStop0.classList.toggle("is-active", cpActiveStop === 0);
    cpStop0.setAttribute("aria-pressed", cpActiveStop === 0 ? "true" : "false");
  }
  if (cpStop1) {
    cpStop1.classList.toggle("is-active", cpActiveStop === 1);
    cpStop1.setAttribute("aria-pressed", cpActiveStop === 1 ? "true" : "false");
  }
  if (cpGradColor2) cpGradColor2.value = endHex.toUpperCase();
  if (cpGradType) {
    cpGradType.value = g ? g.type : "linear";
    syncCustomSelect(cpGradType);
  }
  if (cpGradAngle) {
    cpGradAngle.value = String(g ? g.rotation : 45);
    cpGradAngle.disabled = !g || g.type === "radial";
  }
}

/**
 * Load an RGB color into every internal representation (RGB, Win HSL and HSV).
 * Achromatic colors keep the working hue so the field/slider stay where the
 * user left them while the hex value goes gray/black/white.
 * @param {number} r - Red channel (0-255).
 * @param {number} g - Green channel (0-255).
 * @param {number} b - Blue channel (0-255).
 */
function setColorFromRgb(r, g, b) {
  cpColor.r = r;
  cpColor.g = g;
  cpColor.b = b;
  cpColor.hex = rgbToHex(r, g, b).toUpperCase();
  const isChromatic = r !== g || g !== b;
  const hsl = rgbToWinHsl(r, g, b);
  if (isChromatic) cpColor.h = hsl.h;
  cpColor.s = hsl.s;
  cpColor.l = hsl.l;
  const hsv = rgbToHsv(r, g, b);
  if (isChromatic) cpHsv.h = hsv.h;
  cpHsv.s = hsv.s;
  cpHsv.v = hsv.v;
}

/** Recompute the hex color from the HSV state, refresh the popup and commit it. */
function applyHsv() {
  const rgb = hsvToRgb(cpHsv.h, cpHsv.s, cpHsv.v);
  setColorFromRgb(rgb.r, rgb.g, rgb.b);
  syncUI();
  if (cpActiveTarget) {
    updateColorState(cpActiveTarget, cpColor.hex);
  }
}

/** Load a stop's color into the spectrum editor. */
function setActiveStop(index) {
  if (!cpActiveTarget) return;
  const g = state.generator[gradientKey(cpActiveTarget)];
  const endHex = gradientEndColor(g);
  cpActiveStop = index === 1 && endHex ? 1 : 0;
  const hex = cpActiveStop === 1 ? endHex : state.generator[`${cpActiveTarget}Color`] || cpColor.hex;
  const rgb = hexToRgb(hex);
  if (rgb) {
    setColorFromRgb(rgb.r, rgb.g, rgb.b);
  } else {
    cpColor.hex = hex.toUpperCase();
  }
  syncUI();
  syncGradientUI();
}

export function updateColorState(target, hex) {
  const activeGradient = state.generator[gradientKey(target)];
  if (cpActiveStop === 1 && activeGradient) {
    activeGradient.color2 = hex;
    if (cpGradColor2) cpGradColor2.value = hex.toUpperCase();
    syncGradientUI();
    scheduleColorRender();
    return;
  }
  if (target === "bg") {
    state.generator.bgColor = hex;
    if (DOM.colorBgText) DOM.colorBgText.value = hex.toUpperCase();
    paintSwatch(document.getElementById("swatch-bg-bg"), "bg", hex);
  } else if (target === "dots") {
    state.generator.dotsColor = hex;
    if (DOM.colorDotsText) DOM.colorDotsText.value = hex.toUpperCase();
    paintSwatch(document.getElementById("swatch-bg-dots"), "dots", hex);
    if (DOM.colorFgMediumText) {
      DOM.colorFgMediumText.value = hex.toUpperCase();
      paintSwatch(document.getElementById("swatch-bg-fg-medium"), "dots", hex);
    }
  } else if (target === "cornersSquare") {
    state.generator.cornersSquareColor = hex;
    if (DOM.colorCornersSquareText) DOM.colorCornersSquareText.value = hex.toUpperCase();
    paintSwatch(document.getElementById("swatch-bg-cornersSquare"), "cornersSquare", hex);
  } else if (target === "cornersDot") {
    state.generator.cornersDotColor = hex;
    if (DOM.colorCornersDotText) DOM.colorCornersDotText.value = hex.toUpperCase();
    paintSwatch(document.getElementById("swatch-bg-cornersDot"), "cornersDot", hex);
  } else if (target === "frame") {
    // The picker, presets and the panel's hex field all route through here;
    // without this branch the frame silently kept its previous color.
    state.generator.frameColor = hex;
    if (DOM.colorFrameText) DOM.colorFrameText.value = hex.toUpperCase();
    paintSwatch(document.getElementById("swatch-bg-frame"), "frame", hex);
  } else if (target === "frameText") {
    state.generator.frameTextColor = hex;
    if (DOM.colorFrameTextColor) DOM.colorFrameTextColor.value = hex.toUpperCase();
    paintSwatch(document.getElementById("swatch-bg-frame-text"), "frameText", hex);
  }
  // Re-read state into the chips/end-color field: without this the stop-0
  // chip keeps the pre-update color after presets and Reset.
  syncGradientUI();
  scheduleColorRender();
}

export function updateFromHsl(h, s, l) {
  cpColor.h = Math.min(239, Math.max(0, parseInt(h) || 0));
  cpColor.s = Math.min(240, Math.max(0, parseInt(s) || 0));
  cpColor.l = Math.min(240, Math.max(0, parseInt(l) || 0));
  const rgb = winHslToRgb(cpColor.h, cpColor.s, cpColor.l);
  cpColor.r = rgb.r;
  cpColor.g = rgb.g;
  cpColor.b = rgb.b;
  cpColor.hex = rgbToHex(rgb.r, rgb.g, rgb.b).toUpperCase();
  cpHsv.h = (cpColor.h / 240) * 360;
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  cpHsv.s = hsv.s;
  cpHsv.v = hsv.v;
  syncUI();
  if (cpActiveTarget) {
    updateColorState(cpActiveTarget, cpColor.hex);
  }
}

export function updateFromHex(hex) {
  if (typeof hex !== "string") return;
  hex = hex.trim();
  if (!hex.startsWith("#")) hex = "#" + hex;
  if (/^#[0-9A-F]{3}$/i.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  const rgb = hexToRgb(hex);
  if (rgb) {
    setColorFromRgb(rgb.r, rgb.g, rgb.b);
    syncUI();
    if (cpActiveTarget) {
      updateColorState(cpActiveTarget, cpColor.hex);
    }
  }
}

/**
 * Repaint the spectrum at most once per frame: a drag/typing burst can push
 * several color updates through syncUI() in the same task, and each repaint is
 * three full-canvas fills. The trailing frame always paints the latest state.
 */
function scheduleSpectrumPaint() {
  if (cpSpectrumPaintPending) return;
  if (typeof requestAnimationFrame !== "function") {
    drawSpectrum();
    return;
  }
  cpSpectrumPaintPending = true;
  requestAnimationFrame(() => {
    cpSpectrumPaintPending = false;
    drawSpectrum();
  });
}

function syncUI() {
  if (cpInputHex) {
    cpInputHex.value = cpColor.hex;
  }
  if (cpHue) {
    cpHue.value = String(Math.round(cpHsv.h) % 360);
  }
  scheduleSpectrumPaint();
  syncGradientUI();
}

function drawSpectrum() {
  if (!cpSpectrum) return;
  // No pixel readback anywhere: don't force this canvas onto the software path.
  const ctx = cpSpectrum.getContext("2d");
  if (!ctx) return;
  const W = cpSpectrum.width;
  const H = cpSpectrum.height;
  if (W === 0 || H === 0) return;

  // Saturation (left to right) x value (bottom to top) field for the current
  // hue: a fully saturated hue base, white toward the left and black at the
  // bottom — the standard picker layout.
  const base = hsvToRgb(cpHsv.h, 1, 1);
  ctx.fillStyle = rgbToHex(base.r, base.g, base.b);
  ctx.fillRect(0, 0, W, H);

  // White wash: opaque at the left (zero saturation), clear at the right.
  const gradS = ctx.createLinearGradient(0, 0, W, 0);
  gradS.addColorStop(0, "rgba(255,255,255,1)");
  gradS.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradS;
  ctx.fillRect(0, 0, W, H);

  // Black wash: clear at the top (full value), opaque at the bottom.
  const gradV = ctx.createLinearGradient(0, 0, 0, H);
  gradV.addColorStop(0, "rgba(0,0,0,0)");
  gradV.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = gradV;
  ctx.fillRect(0, 0, W, H);

  // Current-color indicator: a filled dot in the picked color plus a ring in a
  // contrasting color, so the (s, v) position stays readable on the whole
  // field. Purely a canvas paint — it adds no DOM and no event surface.
  const { x, y } = spectrumIndicatorPos(cpHsv.s, cpHsv.v, W, H);
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = cpColor.hex;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = spectrumIndicatorRing(cpColor.r, cpColor.g, cpColor.b);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 7.5, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.stroke();
}

function closeCpPopup() {
  if (!cpPopup) return;
  cpPopup.classList.add("opacity-0", "scale-95");
  closePopover(cpPopup);
  if (cpDragDebounceTimer) {
    clearTimeout(cpDragDebounceTimer);
    cpDragDebounceTimer = null;
  }
  if (cpHideTimer) clearTimeout(cpHideTimer);
  // Repeated closes within one transition (outside click + Escape) must not
  // stack handlers on the popup.
  if (cpTransitionEndHandler) {
    cpPopup.removeEventListener("transitionend", cpTransitionEndHandler);
    cpTransitionEndHandler = null;
  }

  const handleTransitionEnd = (e) => {
    if (e.target !== cpPopup) return;
    if (cpPopup.classList.contains("opacity-0")) {
      cpPopup.classList.add("hidden");
      cpPopup.classList.remove("flex");
    }
    cpPopup.removeEventListener("transitionend", handleTransitionEnd);
    if (cpTransitionEndHandler === handleTransitionEnd) cpTransitionEndHandler = null;
  };

  cpTransitionEndHandler = handleTransitionEnd;
  cpPopup.addEventListener("transitionend", handleTransitionEnd);
  // Fallback in case the transition is interrupted; cleared on reopen so it
  // can never hide a popup the user has already opened again.
  cpHideTimer = setTimeout(() => {
    cpHideTimer = null;
    handleTransitionEnd({ target: cpPopup });
  }, 250);

  cpActiveTarget = null;
  // Selecting the gradient end stop must not leak into the next session: with
  // it still active, the next hex typed in a panel field was written to
  // activeGradient.color2 instead of the target's base color.
  cpActiveStop = 0;
}

export function cancelColorSelection() {
  if (cpActiveTarget && originalColor) {
    state.generator[gradientKey(cpActiveTarget)] = originalGradient ? { ...originalGradient } : null;
    repaintTargetSwatches(cpActiveTarget, originalColor);
    // Editing stop 1 must not write the stop-0 color over the restored
    // gradient's end color (updateColorState branches on the active stop).
    cpActiveStop = 0;
    updateColorState(cpActiveTarget, originalColor);
  }
  closeCpPopup();
}

/**
 * Canonical uppercase 6-digit form of a typed hex value (3-digit shorthand and
 * a missing `#` are repaired), or null when the input is not a hex color.
 * @param {string} value
 * @returns {string|null}
 */
function normalizeHexInput(value) {
  const trimmed = String(value == null ? "" : value).trim();
  if (!/^#?([0-9A-F]{3}|[0-9A-F]{6})$/i.test(trimmed)) return null;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (withHash.length === 4) {
    return `#${withHash[1]}${withHash[1]}${withHash[2]}${withHash[2]}${withHash[3]}${withHash[3]}`.toUpperCase();
  }
  return withHash.toUpperCase();
}

/** Drop the invalid-hex styling/ARIA state and any pending reset timer. */
function clearHexError() {
  if (cpHexErrorTimer) {
    clearTimeout(cpHexErrorTimer);
    cpHexErrorTimer = null;
  }
  if (cpInputHex) {
    cpInputHex.classList.remove("border-red-500", "cp-hex-shake");
    cpInputHex.removeAttribute("aria-invalid");
  }
}

/** Repair the hex field to the last valid color and flash the error state. */
function showHexError() {
  if (cpHexErrorTimer) {
    clearTimeout(cpHexErrorTimer);
    cpHexErrorTimer = null;
  }
  if (cpInputHex) {
    cpInputHex.value = cpColor.hex;
    // Remove first so a repeated invalid submit can restart the shake animation.
    cpInputHex.classList.remove("border-red-500", "cp-hex-shake");
    cpInputHex.classList.add("border-red-500", "cp-hex-shake");
    cpInputHex.setAttribute("aria-invalid", "true");
  }
  cpHexErrorTimer = setTimeout(() => {
    cpHexErrorTimer = null;
    if (cpInputHex) {
      cpInputHex.classList.remove("border-red-500", "cp-hex-shake");
      cpInputHex.removeAttribute("aria-invalid");
    }
  }, 900);
}

/**
 * Read the hex field: valid values are canonicalized and committed, invalid
 * ones are repaired in place and flagged visually/for assistive tech.
 * @returns {boolean} true when the field held a usable color.
 */
function commitHexInput() {
  if (!cpInputHex) return false;
  const canonical = normalizeHexInput(cpInputHex.value);
  if (!canonical) {
    showHexError();
    return false;
  }
  clearHexError();
  updateFromHex(canonical);
  return true;
}

/** Gradient toggle, stop chips, type, angle and end-color hex field. */
function wireGradientControls() {
  const clearGradEndError = () => {
    if (cpGradHexErrorTimer) {
      clearTimeout(cpGradHexErrorTimer);
      cpGradHexErrorTimer = null;
    }
    if (cpGradColor2) {
      cpGradColor2.classList.remove("border-red-500", "cp-hex-shake");
      cpGradColor2.removeAttribute("aria-invalid");
    }
  };
  const flagGradEndError = () => {
    if (!cpGradColor2) return;
    if (cpGradHexErrorTimer) clearTimeout(cpGradHexErrorTimer);
    cpGradColor2.classList.remove("border-red-500", "cp-hex-shake");
    cpGradColor2.classList.add("border-red-500", "cp-hex-shake");
    cpGradColor2.setAttribute("aria-invalid", "true");
    cpGradHexErrorTimer = setTimeout(() => {
      cpGradHexErrorTimer = null;
      if (cpGradColor2) {
        cpGradColor2.classList.remove("border-red-500", "cp-hex-shake");
        cpGradColor2.removeAttribute("aria-invalid");
      }
    }, 900);
  };

  const setGradientMode = (enabled) => {
    if (!cpActiveTarget) return;
    if (enabled) {
      const startHex = state.generator[`${cpActiveTarget}Color`] || state.generator.dotsColor;
      state.generator[gradientKey(cpActiveTarget)] = {
        type: "linear",
        rotation: 45,
        color2: defaultEndColor(startHex),
      };
      setActiveStop(0);
    } else {
      state.generator[gradientKey(cpActiveTarget)] = null;
      cpActiveStop = 0;
      syncGradientUI();
    }
    const base = state.generator[`${cpActiveTarget}Color`] || state.generator.dotsColor;
    repaintTargetSwatches(cpActiveTarget, base);
    generateQR(true);
  };
  if (cpModeSolid) cpModeSolid.addEventListener("click", () => setGradientMode(false));
  if (cpModeGradient) cpModeGradient.addEventListener("click", () => setGradientMode(true));
  if (cpStop0) cpStop0.addEventListener("click", () => setActiveStop(0));
  if (cpStop1) cpStop1.addEventListener("click", () => setActiveStop(1));
  if (cpGradType) {
    cpGradType.addEventListener("change", () => {
      if (!cpActiveTarget) return;
      const g = state.generator[gradientKey(cpActiveTarget)];
      if (!g) return;
      g.type = cpGradType.value === "radial" ? "radial" : "linear";
      syncGradientUI();
      repaintTargetSwatches(cpActiveTarget, state.generator[`${cpActiveTarget}Color`]);
      generateQR(true);
    });
  }
  if (cpGradAngle) {
    cpGradAngle.addEventListener("input", () => {
      if (!cpActiveTarget) return;
      const g = state.generator[gradientKey(cpActiveTarget)];
      if (!g) return;
      const val = parseInt(cpGradAngle.value, 10);
      g.rotation = isNaN(val) ? 0 : Math.max(0, Math.min(360, val));
      repaintTargetSwatches(cpActiveTarget, state.generator[`${cpActiveTarget}Color`]);
      scheduleColorRender();
    });
  }
  if (cpGradColor2) {
    const commit = () => {
      if (!cpActiveTarget) return;
      const g = state.generator[gradientKey(cpActiveTarget)];
      if (!g) return;
      let hex = cpGradColor2.value.trim();
      if (!hex.startsWith("#")) hex = "#" + hex;
      if (!/^#[0-9A-F]{6}$/i.test(hex)) {
        cpGradColor2.value = gradientEndColor(g).toUpperCase();
        flagGradEndError();
        return;
      }
      clearGradEndError();
      g.color2 = hex.toUpperCase();
      if (cpActiveStop === 1) {
        updateFromHex(hex);
      } else {
        syncGradientUI();
      }
      repaintTargetSwatches(cpActiveTarget, state.generator[`${cpActiveTarget}Color`]);
      scheduleColorRender();
    };
    cpGradColor2.addEventListener("input", () => {
      let hex = cpGradColor2.value.trim();
      if (!hex.startsWith("#")) hex = "#" + hex;
      if (/^#[0-9A-F]{6}$/i.test(hex)) commit();
    });
    cpGradColor2.addEventListener("change", commit);
    cpGradColor2.addEventListener("blur", commit);
  }
}

/** Detach pointer/touch handlers belonging to the previously bound canvas. */
function unbindSpectrumInteraction() {
  if (!cpSpectrumBound) return;
  cpSpectrumBound.removeEventListener("mousedown", cpSpectrumDownHandler);
  cpSpectrumBound.removeEventListener("touchstart", cpSpectrumTouchStartHandler);
  cpSpectrumBound.removeEventListener("keydown", cpSpectrumKeyHandler);
  window.removeEventListener("mousemove", cpSpectrumMoveHandler);
  window.removeEventListener("mouseup", cpMouseUpHandler);
  window.removeEventListener("touchmove", cpSpectrumTouchMoveHandler);
  window.removeEventListener("touchend", cpTouchEndHandler);
  cpSpectrumBound = null;
}

/** Wire spectrum pointer, touch and keyboard interactions. */
function wireSpectrumInteraction() {
  if (!cpSpectrum || cpSpectrumBound === cpSpectrum) return;
  // Re-binding (init called again after the canvas was replaced) must not
  // stack window listeners that would apply every drag twice.
  unbindSpectrumInteraction();
  cpSpectrumBound = cpSpectrum;

  cpSpectrumMoveHandler = (e) => {
    if (!isDraggingSpectrum || !cpSpectrum) return;
    // Measured once per drag: reading the rect on every move forced a layout
    // flush between the previous move's style writes and this read.
    const rect = cpDragRect || cpSpectrum.getBoundingClientRect();
    let clientX = e.clientX;
    let clientY = e.clientY;
    if (e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    const x = Math.max(0, Math.min(rect.width - 1, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height - 1, clientY - rect.top));
    const { s, v } = spectrumPickValue(x, y, rect.width, rect.height);
    cpHsv.s = s;
    cpHsv.v = v;
    // Keep the user's hue: the field only edits saturation and value.
    applyHsv();
  };
  cpSpectrumDownHandler = (e) => {
    e.stopPropagation();
    isDraggingSpectrum = true;
    cpDragRect = cpSpectrum.getBoundingClientRect();
    cpSpectrumMoveHandler(e);
  };
  cpSpectrumTouchStartHandler = (e) => {
    e.stopPropagation();
    e.preventDefault();
    isDraggingSpectrum = true;
    cpDragRect = cpSpectrum.getBoundingClientRect();
    cpSpectrumMoveHandler(e);
  };
  cpMouseUpHandler = () => {
    isDraggingSpectrum = false;
    cpDragRect = null;
  };
  cpSpectrumTouchMoveHandler = (e) => {
    if (isDraggingSpectrum) {
      e.preventDefault();
      cpSpectrumMoveHandler(e);
    }
  };
  cpTouchEndHandler = () => {
    isDraggingSpectrum = false;
    cpDragRect = null;
  };
  cpSpectrumKeyHandler = (e) => {
    const delta = spectrumKeyDelta(e.key, { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey });
    if (delta.h === 0 && delta.s === 0 && delta.v === 0) return;
    e.preventDefault();
    // Hue wraps; saturation and value clamp at the field edges.
    cpHsv.h = (cpHsv.h + delta.h + 360) % 360;
    cpHsv.s = Math.min(1, Math.max(0, cpHsv.s + delta.s));
    cpHsv.v = Math.min(1, Math.max(0, cpHsv.v + delta.v));
    applyHsv();
  };

  cpSpectrum.addEventListener("mousedown", cpSpectrumDownHandler);
  cpSpectrum.addEventListener("touchstart", cpSpectrumTouchStartHandler, { passive: false });
  cpSpectrum.addEventListener("keydown", cpSpectrumKeyHandler);
  window.addEventListener("mousemove", cpSpectrumMoveHandler);
  window.addEventListener("mouseup", cpMouseUpHandler);
  window.addEventListener("touchmove", cpSpectrumTouchMoveHandler, { passive: false });
  window.addEventListener("touchend", cpTouchEndHandler);
}

/** Wire hex input validation, commit and error-shake behaviour. */
function wireHexInput() {
  if (!cpInputHex) return;
  cpInputHex.addEventListener("input", () => {
    // Live-commit full 6-digit values only: auto-expanding a 3-digit value
    // while the user is still typing rewrote the field and corrupted the
    // rest of the input, so shorthand is committed on Enter/blur/OK instead.
    const raw = cpInputHex.value.trim();
    if (/^#?[0-9A-F]{6}$/i.test(raw)) {
      clearHexError();
      updateFromHex(raw);
    }
  });
  cpInputHex.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!commitHexInput()) return;
    if (cpOkBtn) cpOkBtn.click();
  });
  cpInputHex.addEventListener("blur", () => {
    // Empty (or otherwise invalid) input is repaired to the last valid color.
    commitHexInput();
  });
}

/** Wire the hue slider, close/reset/OK buttons and preset swatches. */
function wirePresetButtons() {
  if (cpHue) {
    cpHue.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      cpHsv.h = (((isNaN(val) ? 0 : val) % 360) + 360) % 360;
      // Keep saturation and value: the hue slider only rotates the color.
      applyHsv();
    });
  }

  if (cpCloseBtn) {
    cpCloseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cancelColorSelection();
    });
  }

  document.querySelectorAll(".cp-preset").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const hex = btn.dataset.hex;
      if (hex) updateFromHex(hex);
    });
  });

  if (cpResetBtn) {
    cpResetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (cpActiveTarget) {
        state.generator[gradientKey(cpActiveTarget)] = originalGradient ? { ...originalGradient } : null;
        cpActiveStop = 0;
      }
      if (originalColor) {
        updateFromHex(originalColor);
      } else {
        const defaultHex = cpActiveTarget === "bg" ? "#000000" : "#ffffff";
        updateFromHex(defaultHex);
      }
      if (cpActiveTarget) {
        repaintTargetSwatches(cpActiveTarget, state.generator[`${cpActiveTarget}Color`]);
      }
    });
  }

  if (cpOkBtn) {
    cpOkBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // An invalid hex field must not silently commit the previous color.
      if (cpInputHex && !commitHexInput()) return;
      if (cpActiveTarget) {
        updateColorState(cpActiveTarget, cpColor.hex);
      }
      closeCpPopup();
    });
  }
}

/** Show and populate the popup anchored to a `.btn-custom-color` trigger. */
function openPickerForButton(btn) {
  // Reopening cancels any still-pending hide/resize work from a previous open.
  if (cpHideTimer) {
    clearTimeout(cpHideTimer);
    cpHideTimer = null;
  }
  if (cpResizeTimer) {
    clearTimeout(cpResizeTimer);
    cpResizeTimer = null;
  }
  // Another anchored popover taking over must drop the open custom selects,
  // including their dismissal-stack registrations.
  closeOpenCustomSelects();
  // The spectrum and its window-level drag listeners are only needed while the
  // picker is available, so they are bound here instead of on every boot.
  wireSpectrumInteraction();
  const target = btn.dataset.target;
  cpActiveTarget = target;
  if (target === "bg") originalColor = state.generator.bgColor;
  else if (target === "dots") originalColor = state.generator.dotsColor;
  else if (target === "cornersSquare") originalColor = state.generator.cornersSquareColor;
  else if (target === "cornersDot") originalColor = state.generator.cornersDotColor;
  else if (target === "frame") originalColor = state.generator.frameColor || state.generator.dotsColor;
  else if (target === "frameText")
    originalColor = state.generator.frameTextColor || state.generator.frameColor || state.generator.dotsColor;
  if (cpModeGradient) {
    cpModeGradient.classList.remove("hidden");
  }
  const existingGradient = state.generator[gradientKey(target)];
  originalGradient = existingGradient ? { ...existingGradient } : null;
  cpActiveStop = 0;
  updateFromHex(originalColor);
  const rect = btn.getBoundingClientRect();
  let topVal = rect.bottom + window.scrollY + 8;
  let leftVal = rect.left + window.scrollX;
  // Match the Tailwind `w-[300px]` class on #color-picker-popup, not 340.
  const popupWidth = 300;
  if (leftVal + popupWidth > window.innerWidth) {
    leftVal = window.innerWidth - popupWidth - 16;
  }
  if (leftVal < 8) leftVal = 8;
  if (cpPopup) {
    cpPopup.style.top = topVal + "px";
    cpPopup.style.left = leftVal + "px";
    cpPopup.classList.remove("hidden");
    cpPopup.classList.add("flex");
    // Remove the fade-out classes synchronously: rAF can be throttled in
    // background tabs, which would leave the popup stuck at opacity 0.
    cpPopup.classList.remove("opacity-0", "scale-95");
    // Clamp into the viewport so the popup never clips off-screen nor
    // grows the document's scrollable area.
    const popupH = cpPopup.offsetHeight;
    const popupW = cpPopup.offsetWidth || popupWidth;
    const vpTop = window.scrollY + 8;
    const vpBottom = window.scrollY + window.innerHeight - 12;
    if (topVal + popupH > vpBottom) {
      topVal = Math.max(vpTop, vpBottom - popupH);
    }
    cpPopup.style.top = topVal + "px";
    if (leftVal + popupW > window.innerWidth - 8) {
      leftVal = window.innerWidth - popupW - 8;
    }
    if (leftVal < 8) leftVal = 8;
    cpPopup.style.left = leftVal + "px";
    cpPreviousFocus = document.activeElement;
    // Re-registering the same root drops the previous entry (and its trap)
    // instead of stacking listeners. Clicks on any color trigger are anchor
    // clicks, so switching targets keeps the popup open like before; outside
    // clicks close without reverting, Escape cancels like the shell used to.
    openPopover({
      root: cpPopup,
      anchor: Array.from(document.querySelectorAll(".btn-custom-color")),
      onCancel: cancelColorSelection,
      onOutsideClick: closeCpPopup,
      trapFocus: true,
      restoreFocus: cpPreviousFocus,
    });
    // Move focus into the popup so keyboard/hybrid-device users are not left
    // outside the dialog. Coarse pointers focus the close button instead of
    // the hex field: it keeps the on-screen keyboard down while still giving
    // the focus trap a valid starting point.
    const isCoarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    setTimeout(() => {
      // Never steal focus if the popup was closed/reopened meanwhile.
      if (!cpPopup || cpPopup.classList.contains("hidden")) return;
      const target = isCoarse ? cpCloseBtn : cpInputHex;
      if (target) target.focus();
    }, 60);
  }
  cpResizeTimer = setTimeout(() => {
    cpResizeTimer = null;
    if (cpPopup && cpSpectrum && !cpPopup.classList.contains("hidden")) {
      cpSpectrum.width = cpSpectrum.clientWidth;
      cpSpectrum.height = cpSpectrum.clientHeight;
      syncUI();
    }
  }, 50);
}

/** Resolve picker elements, set static aria attributes, then wire all interactions. */
export function initColorPicker() {
  cpPopup = document.getElementById("color-picker-popup");
  cpCloseBtn = document.getElementById("btn-close-cp");
  cpOkBtn = document.getElementById("cp-ok-btn");
  cpResetBtn = document.getElementById("cp-reset-btn");
  cpInputHex = document.getElementById("cp-input-hex");
  cpSpectrum = document.getElementById("cp-spectrum");
  cpHue = document.getElementById("cp-hue");
  cpModeSolid = document.getElementById("cp-mode-solid");
  cpModeGradient = document.getElementById("cp-mode-gradient");
  cpGradientControls = document.getElementById("cp-gradient-controls");
  cpStop0 = document.getElementById("cp-stop-0");
  cpStop1 = document.getElementById("cp-stop-1");
  cpGradColor2 = document.getElementById("cp-grad-color2");
  cpGradType = document.getElementById("cp-gradient-type");
  cpGradAngle = document.getElementById("cp-gradient-angle");

  if (cpPopup) {
    cpPopup.setAttribute("role", "dialog");
    cpPopup.setAttribute("aria-label", "Color picker");
    cpPopup.setAttribute("aria-modal", "true");
  }
  if (cpSpectrum) {
    cpSpectrum.setAttribute("role", "img");
    cpSpectrum.setAttribute(
      "aria-label",
      "Saturation and brightness field: Left/Right adjust saturation, Up/Down adjust brightness, Ctrl+Left/Right adjust hue"
    );
    cpSpectrum.setAttribute("tabindex", "0");
  }
  if (cpInputHex) {
    cpInputHex.setAttribute("aria-label", "Hex color value");
    cpInputHex.setAttribute("autocomplete", "off");
    cpInputHex.setAttribute("autocapitalize", "off");
    cpInputHex.setAttribute("spellcheck", "false");
  }
  if (cpResetBtn) {
    cpResetBtn.setAttribute("aria-label", "Reset to the color before editing");
    cpResetBtn.setAttribute("title", "Reset to the color before editing");
  }
  if (cpOkBtn) {
    cpOkBtn.setAttribute("aria-label", "Apply color and close");
    cpOkBtn.setAttribute("title", "Apply color and close");
  }

  wireHexInput();
  wireGradientControls();
  wirePresetButtons();
  document.querySelectorAll(".btn-custom-color").forEach((btn) => {
    // Re-running init must not stack a second open handler on the trigger.
    if (btn.dataset.cpBound === "true") return;
    btn.dataset.cpBound = "true";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPickerForButton(btn);
    });
  });
}
