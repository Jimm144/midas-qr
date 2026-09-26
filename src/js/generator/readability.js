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
 * Module edge below which dot modules lose the gaps scanners rely on. Dots are
 * a deliberate style choice and scan reliably at normal sizes, so the advice
 * only appears once the modules get small.
 */
export const MIN_DOT_MODULE_PX = 6;

/** Quiet zone (in output pixels) a masked code needs to stay scannable. */
export const MIN_QUIET_ZONE_PX = 4;

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
 *   imageMargin?: number,
 *   margin?: number,
 *   maskType?: string,
 *   shapeBody?: string,
 * }} ReadabilityConfig
 */

/**
 * Everything the advice needs about the current render. Both fields are
 * optional: without them the size-dependent advice stays quiet rather than
 * guessing, which keeps this module free of state and DOM imports.
 * @typedef {{ modulePx?: number, canvasSize?: number }} ReadabilityMetrics
 */

/**
 * The first factor that threatens scannability, or null when the config looks
 * fine. Advice that only matters at a given size (dots, masks, an oversized
 * logo plate) stays quiet unless the caller passes metrics.
 *
 * Callers read `.key` and translate it; the descriptor holds no copy, so the
 * wording lives in the catalogs only.
 *
 * @param {ReadabilityConfig | null | undefined} config
 * @param {ReadabilityMetrics} [metrics]
 * @returns {{ key: string, params?: Record<string, string> } | null}
 */
export function readabilityHintDescriptor(config, metrics = {}) {
  if (!config) return null;
  const modulePx = Number(metrics.modulePx) || 0;
  const canvasSize = Number(metrics.canvasSize) || 0;
  const bg = typeof config.bgColor === "string" ? config.bgColor : "#FFFFFF";
  if (config.bgImageDataUrl) {
    return { key: "readability.backgroundImage" };
  }
  const logoSize = typeof config.logoSizeProportion === "number" ? config.logoSizeProportion : null;
  const imageMargin = Number(config.imageMargin) || 0;
  // The plate is the logo square grown by the margin on every side; past half
  // the code it is not a logo any more, it is a hole.
  if (config.logoDataUrl && canvasSize > 0 && logoSize !== null) {
    const plate = logoSize * canvasSize + 2 * imageMargin;
    if (plate / canvasSize >= 0.5) {
      return { key: "readability.logoPlateTooBig" };
    }
  }
  // A big logo hurts whether or not it has a plate, so that advice comes first
  // and the plate note below only covers the mid-size case.
  if (config.logoDataUrl && logoSize !== null && logoSize >= 0.35) {
    return { key: "readability.largeLogo" };
  }
  // Without a margin no backing plate is drawn, so the logo's own transparent
  // pixels expose the modules underneath. Small logos barely cover anything;
  // warn once the overlay is big enough to matter.
  if (config.logoDataUrl && imageMargin <= 0 && logoSize !== null && logoSize >= 0.2) {
    return { key: "readability.logoNoPlate" };
  }
  if (config.bgTransparent) {
    return { key: "readability.transparent" };
  }
  /** @type {[string, unknown][]} */
  const pairs = [
    ["readability.lowContrastBody", config.dotsColor],
    ["readability.lowContrastCornersSquare", config.cornersSquareColor],
    ["readability.lowContrastCornersDot", config.cornersDotColor],
  ];
  for (const [key, color] of pairs) {
    // Equality is the extreme case of low contrast (ratio 1) and the most
    // actionable to report: "body matches the background".
    if (typeof color === "string" && isLowContrast(color, bg)) {
      return { key, params: { color, background: bg } };
    }
  }
  // Dot modules never touch, so the boundaries a scanner locks onto thin out.
  // That only bites when the modules are already small: at a normal output size
  // a dot body scans fine, and warning on every dot choice made the badge cry
  // wolf over a deliberate design decision.
  if (
    (config.shapeBody === "dots" || config.shapeBody === "dot") &&
    modulePx > 0 &&
    modulePx < MIN_DOT_MODULE_PX
  ) {
    return { key: "readability.dotBody" };
  }
  // A mask crops the code into the silhouette, so its quiet zone is whatever
  // margin is left over. With the default margin there is one; with a thin one
  // the code needs it back.
  if (
    typeof config.maskType === "string" &&
    config.maskType !== "none" &&
    typeof config.margin === "number" &&
    config.margin < MIN_QUIET_ZONE_PX
  ) {
    return { key: "readability.mask" };
  }
  return null;
}

/**
 * The hint key for a config, or "" when nothing is wrong. Convenience wrapper
 * for callers and tests that only care which advice applies.
 * @param {ReadabilityConfig | null | undefined} config
 * @param {ReadabilityMetrics} [metrics]
 * @returns {string}
 */
export function readabilityHintKey(config, metrics) {
  return readabilityHintDescriptor(config, metrics)?.key || "";
}
