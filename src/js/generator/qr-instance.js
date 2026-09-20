// @ts-check
/**
 * Owns the single QRCodeStyling instance and the option builders that feed it.
 *
 * Split out of generator.js so the render pipeline (generator.js) and the
 * SVG post-processing pipeline (export.js) can both depend on it without
 * importing each other — that pair used to be a circular import.
 */
import { state } from "../state";
import { DEFAULT_WIDTH, DEFAULT_HEIGHT } from "../constants.js";
import { parseGradient, gradientStops } from "./gradient.js";

let qrCodeInstance = null;
let qrCodeInstanceHasLogo = null;

/**
 * Map a stored GradientSpec (+ the target's solid stop-0 color) onto the
 * qr-code-styling options shape. Returns {} when no valid gradient is set.
 */
export function gradientOptions(gradient, baseColor) {
  const spec = parseGradient(gradient);
  if (!spec) return {};
  return {
    gradient: {
      type: spec.type,
      rotation: (spec.rotation * Math.PI) / 180,
      colorStops: gradientStops(baseColor, spec.color2),
    },
  };
}

/**
 * The vendored library only knows square / extra-rounded / dot for corner
 * squares and square / dot for corner dots. Our extended styles (rounded,
 * classy, classy-rounded / rounded, extra-rounded, classy, classy-rounded)
 * are drawn from the plain-square geometry by applyCornerStyles, so the
 * library is always asked for `square` and the SVG is restyled afterwards.
 */
const EXTENDED_CORNER_STYLES = ["rounded", "classy", "classy-rounded"];
function libraryCornerType(style) {
  return EXTENDED_CORNER_STYLES.includes(style) ? "square" : style;
}
function libraryInnerCornerType(style) {
  return ["rounded", "extra-rounded", "classy", "classy-rounded"].includes(style) ? "square" : style;
}

function buildImageOptions() {
  const g = state.generator;
  return {
    ...(g.logoDataUrl ? { crossOrigin: "anonymous" } : {}),
    hideBackgroundDots: g.hideBackgroundDots,
    imageSize: g.logoSizeProportion,
    margin: g.imageMargin,
  };
}

export function buildQrStylingOptions(w, h, opts = {}) {
  const g = state.generator;
  const {
    data = g.dataString || " ",
    margin = g.margin,
    roundSize = true,
    background = g.bgColor,
    image,
  } = opts;
  return {
    type: "svg",
    // Explicitly square: nothing downstream may switch the renderer into its
    // circular 'shape' mode (which arranges the modules in a circle).
    shape: "square",
    width: w,
    height: h,
    data,
    margin,
    qrOptions: {
      errorCorrectionLevel: g.ecc,
    },
    imageOptions: buildImageOptions(),
    dotsOptions: {
      color: g.dotsColor,
      type: g.shapeBody,
      roundSize,
    },
    backgroundOptions: {
      color: background,
      // Square output only: background rounding is disabled (rounding past the
      // margin used to clip the code's corners into a circle).
      round: 0,
      ...(background === "transparent" ? {} : gradientOptions(g.bgGradient, g.bgColor)),
    },
    cornersSquareOptions: {
      type: libraryCornerType(g.shapeOuter),
      color: g.cornersSquareColor,
      roundSize: false,
    },
    cornersDotOptions: {
      type: libraryInnerCornerType(g.shapeInner),
      color: g.cornersDotColor,
    },
    image,
  };
}

export function getQrCode() {
  const hasLogo = Boolean(state.generator.logoDataUrl);
  if (!qrCodeInstance || qrCodeInstanceHasLogo !== hasLogo) {
    const options = buildQrStylingOptions(
      state.generator.width || DEFAULT_WIDTH,
      state.generator.height || DEFAULT_HEIGHT
    );
    qrCodeInstance = new QRCodeStyling(options);
    qrCodeInstance.update(options);
    qrCodeInstanceHasLogo = hasLogo;
  }
  return qrCodeInstance;
}
