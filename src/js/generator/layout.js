// @ts-check
/**
 * Single owner of rendered geometry.
 *
 * Every consumer that needs pixel numbers for the QR canvas — the render
 * pipeline, the mask pass, the frame builder and the exporter — takes them
 * from `resolveLayout` instead of re-deriving them from generator state, so
 * changing how the canvas is sized (or how a mask shifts it) happens here
 * once.
 */
import { DEFAULT_WIDTH } from "../constants.js";
import { framesConfig } from "../frames";

/**
 * How much room each silhouette needs around the code, and where the code must
 * sit inside it so no module is ever clipped.
 *
 * `padding` is a multiple of the QR side D (0.6 => the silhouette measures
 * D + 2*0.6D across), `shift` is also a multiple of D (positive = code moves
 * down). Values come from the largest centred axis-aligned square that fits
 * inside each path (numeric probe of the shape geometry) plus ~5% safety so the
 * 0.5px outline stroke and the edge surround-dots can never touch the code.
 * Both the render pipeline and the mask pass read this one table so the
 * margins can't drift.
 */
export const MASK_FIT = {
  circle: { padding: 0.26, shift: 0 },
  triangle: { padding: 0.59, shift: 0.54 },
  heart: { padding: 0.68, shift: -0.12 },
  star: { padding: 1.07, shift: 0.09 },
  diamond: { padding: 0.81, shift: 0 },
  hexagon: { padding: 0.53, shift: 0 },
  shield: { padding: 0.54, shift: -0.09 },
  custom: { padding: 0.75, shift: 0 },
};

/** Ring thickness added around the code, in modules (0 for no mask/unknown). */
export function innerPaddingForMask(maskType, moduleCount) {
  const fit = MASK_FIT[maskType];
  return fit ? Math.ceil(moduleCount * fit.padding) : 0;
}

/** Vertical code offset inside the silhouette, in modules (positive = down). */
export function maskVerticalShift(maskType, moduleCount) {
  const fit = MASK_FIT[maskType];
  return fit ? Math.round(moduleCount * fit.shift) : 0;
}

/**
 * Pixel size of one module. Floor keeps the rendered data area within the
 * requested width; rounding up could silently emit a larger code than asked.
 */
export function moduleSizeFor(requestedW, moduleCount) {
  const width = requestedW || DEFAULT_WIDTH;
  const size = Math.floor(width / moduleCount);
  return size < 1 ? 1 : size;
}

/**
 * Resolve every pixel number the render pipeline needs from a generator
 * config. Pure: no state import, no DOM.
 * @param {{ width?: number, margin?: number, maskType?: string }} gen
 * @param {number} moduleCount
 */
export function resolveLayout(gen, moduleCount) {
  const requestedW = gen.width || DEFAULT_WIDTH;
  const moduleSize = moduleSizeFor(requestedW, moduleCount);
  const dataW = moduleCount * moduleSize;
  const innerPaddingModules = innerPaddingForMask(gen.maskType, moduleCount);
  const scale = requestedW / DEFAULT_WIDTH;
  const userMarginPx = Math.max(0, Math.round((gen.margin || 0) * scale));
  const innerPaddingPx = innerPaddingModules * moduleSize;
  const totalMarginPx = userMarginPx + innerPaddingPx;
  const w = dataW + totalMarginPx * 2;
  return {
    requestedW,
    moduleCount,
    moduleSize,
    dataW,
    innerPaddingModules,
    innerPaddingPx,
    userMarginPx,
    totalMarginPx,
    w,
    h: w,
    maskDx: 0,
    maskDy: maskVerticalShift(gen.maskType, moduleCount) * moduleSize,
  };
}

/**
 * Which frame artwork, viewBox height and QR area a frame style resolves to
 * for the current text toggle. Null when the style is unknown.
 * @param {string} frameStyle
 * @param {unknown} frameText
 * @param {unknown} frameTextEnabled
 */
export function resolveFrameGeometry(frameStyle, frameText, frameTextEnabled) {
  const frameConfig = framesConfig[frameStyle];
  if (!frameConfig) return null;
  const hasText =
    typeof frameText === "string" && frameText.trim().length > 0;
  const showText = hasText && Boolean(frameTextEnabled) && Boolean(frameConfig.textArea);
  const vbHeight = showText ? frameConfig.vbHeight : 24;
  const qrArea = showText ? frameConfig.qrArea : (frameConfig.noTextQrArea ?? frameConfig.qrArea);
  const frameArt = showText ? frameConfig.svg : (frameConfig.noTextSvg ?? frameConfig.svg);
  return { frameConfig, showText, vbHeight, qrArea, frameArt };
}

/** Output size of a framed render for a given QR-canvas width. */
export function frameOutputSize(baseW, geo) {
  const outW = baseW * (24 / geo.qrArea.w);
  return { w: outW, h: outW * (geo.vbHeight / 24) };
}
