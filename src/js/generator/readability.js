// @ts-check
/**
 * Pure readability advisors for the QR preview badge.
 *
 * When the post-render scan fails, the badge explains *why* in plain language
 * (which color pair is too close, oversized logo, background image, …) instead
 * of the old generic "may be difficult to decode" tooltip. Kept free of DOM
 * and state imports so the heuristics are unit-testable.
 */

/** WCAG-ish minimum contrast ratio for large graphical objects. */
export const MIN_QR_CONTRAST = 3;

/**
 * Smallest module edge (in output pixels) that still scans reliably. A 300px
 * code with 25 modules has 12px modules; a 50-60px code has 2px modules, which
 * the raster check can still decode when upscaled but no camera will.
 */
export const MIN_RENDER_MODULE_PX = 4;

/**
 * Pixel size of one QR module for a requested output width (0 when unknown).
 * @param {unknown} width
 * @param {unknown} moduleCount
 * @returns {number}
 */
export function modulePixelSize(width, moduleCount) {
  const w = Number(width);
  const count = Number(moduleCount);
  if (!Number.isFinite(w) || !Number.isFinite(count) || w <= 0 || count <= 0) return 0;
  return Math.floor(w / count);
}

/**
 * True when a rendered code is too small for cameras to resolve reliably.
 * Unknown sizes are not flagged.
 * @param {unknown} width
 * @param {unknown} moduleCount
 * @returns {boolean}
 */
export function isTooSmallToScan(width, moduleCount) {
  const moduleSize = modulePixelSize(width, moduleCount);
  return moduleSize > 0 && moduleSize < MIN_RENDER_MODULE_PX;
}

/**
 * Parse `#RRGGBB` (a leading `#` is optional) into an RGB triple.
 * @param {unknown} value
 * @returns {[number, number, number] | null}
 */
export function parseHexColor(value) {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/**
 * WCAG relative luminance (0 = black, 1 = white), or null for invalid input.
 * @param {unknown} value
 * @returns {number | null}
 */
export function relativeLuminance(value) {
  const rgb = parseHexColor(value);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio (1 = identical, 21 = black on white), or null when
 * either color can't be parsed.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number | null}
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** @param {unknown} color @param {unknown} bg */
function isLowContrast(color, bg) {
  const ratio = contrastRatio(color, bg);
  return ratio !== null && ratio < MIN_QR_CONTRAST;
}

/**
 * Config subset the advisor reads; mirrors the persisted generator fields.
 * @typedef {{
 *   bgColor?: string,
 *   bgTransparent?: boolean,
 *   bgImageDataUrl?: string | null,
 *   dotsColor?: string,
 *   cornersSquareColor?: string,
 *   cornersDotColor?: string,
 *   logoDataUrl?: string | null,
 *   logoSizeProportion?: number,
 *   maskType?: string,
 *   shapeBody?: string,
 * }} ReadabilityConfig
 */

/**
 * Return an actionable tip for a QR that failed the post-render scan, or ""
 * when no specific cause is detectable. Ordered by how strongly each factor
 * tends to hurt scannability.
 * @param {ReadabilityConfig | null | undefined} config
 * @returns {string}
 */
export function readabilityHint(config) {
  if (!config) return "";
  const bg = typeof config.bgColor === "string" ? config.bgColor : "#FFFFFF";
  if (config.bgImageDataUrl) {
    return "The background image is reducing contrast — try a solid background color.";
  }
  if (
    config.logoDataUrl &&
    typeof config.logoSizeProportion === "number" &&
    config.logoSizeProportion >= 0.35
  ) {
    return "The logo covers a large part of the code — reduce the logo size or use a shorter message.";
  }
  if (config.bgTransparent) {
    return "The background is transparent — scanners need contrast against the surface behind the code.";
  }
  const pairs = [
    ["body", config.dotsColor],
    ["corner squares", config.cornersSquareColor],
    ["corner dots", config.cornersDotColor],
  ];
  for (const [label, color] of pairs) {
    // Equality is the extreme case of low contrast (ratio 1) and the most
    // actionable to report: "body matches the background".
    if (typeof color === "string" && isLowContrast(color, bg)) {
      return `Low contrast between the ${label} (${color}) and the background (${bg}) — increase the difference.`;
    }
  }
  // Dot modules never touch, so the module boundaries a scanner needs to lock
  // onto disappear — the most common reason an otherwise clean design fails.
  if (config.shapeBody === "dots" || config.shapeBody === "dot") {
    return "The dot body style leaves gaps between modules — square or rounded modules scan more reliably.";
  }
  if (typeof config.maskType === "string" && config.maskType !== "none") {
    return "The overall shape mask removes the quiet zone — increase the margin or pick a less aggressive mask.";
  }
  return "";
}
