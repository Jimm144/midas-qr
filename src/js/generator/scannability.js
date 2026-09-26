// @ts-check
/**
 * The generator's scannability verdict.
 *
 * "Can this be scanned?" is answered by decoding the render, not by judging the
 * configuration: the badge rasterises the exact SVG the preview shows (and the
 * download would contain) and runs it through the same decoder the scanner
 * ships. That makes the verdict accurate by construction — a logo, a mask, a
 * dot body or a colour pair is only reported as a problem when the resulting
 * image genuinely fails to decode — and free of tuned thresholds.
 *
 * Deterministic: the input is the published SVG string, rasterised at a fixed
 * size with image smoothing off, so the same render always yields the same
 * verdict. The previous decode-based badge read the live preview DOM at an
 * arbitrary moment, which is what made it flip between renders.
 */

import { loadVendoredScript } from "../lib-loader.js";
import { drawSvgBitmap, svgIntrinsicSize } from "./svg-raster.js";

/**
 * Largest canvas edge the check will rasterise. A 2000px export decoded at full
 * size allocates a 16MB ImageData on the render path; capping keeps that bounded
 * while staying far above the ~3px-per-module floor a decoder needs, so a code
 * that only scans because it is large still decodes here.
 */
export const MAX_DECODE_EDGE = 1024;

/**
 * Canvas size used to decode a `w`×`h` render: the intrinsic size, scaled down
 * proportionally when it exceeds `maxEdge`.
 * @param {unknown} w
 * @param {unknown} h
 * @param {number} [maxEdge]
 * @returns {{ w: number, h: number }}
 */
export function decodeCanvasSize(w, h, maxEdge = MAX_DECODE_EDGE) {
  const width = Math.max(1, Math.round(Number(w) || 0));
  const height = Math.max(1, Math.round(Number(h) || 0));
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { w: width, h: height };
  const scale = maxEdge / longest;
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

/** @type {Promise<boolean> | null} */
let jsQrLoad = null;

/** Lazily load the vendored decoder, single-flight. */
function loadDecoder() {
  if (!jsQrLoad) jsQrLoad = loadVendoredScript("src/lib/jsqr.min.js", "jsQR");
  return jsQrLoad;
}

/**
 * Decode a rendered SVG. Resolves `true` when it decodes and `false` when it
 * does not; `null` means the verdict could not be established (no canvas, the
 * decoder failed to load, or the raster failed), so callers must not read it as
 * a failure.
 * @param {unknown} svg
 * @param {unknown} w
 * @param {unknown} h
 * @param {number} [moduleCount] Module count of the render, used to size the
 *   quiet zone that is restored before decoding.
 * @returns {Promise<boolean | null>}
 */
export async function svgDecodes(svg, w, h, moduleCount = 0) {
  if (typeof svg !== "string" || svg === "") return null;

  // Rasterise at the SVG's own size: a framed render is taller than wide, and
  // squashing it into the QR canvas size would distort the code. The caller's
  // size is the fallback for an SVG that carries no width/height.
  const intrinsic = svgIntrinsicSize(svg);
  const { w: cw, h: ch } = decodeCanvasSize(
    intrinsic ? intrinsic.w : w,
    intrinsic ? intrinsic.h : h
  );
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  // Resolve the context before loading the decoder: without a 2D canvas there
  // is no verdict to give, and jsdom (which returns null here) must not be made
  // to fetch the vendored script.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  if (!(await loadDecoder())) return null;
  const decode = /** @type {any} */ (globalThis).jsQR;
  if (typeof decode !== "function") return null;

  // Nearest-neighbour: a crisp raster tests the design, and smoothing would make
  // the result depend on the resampling rather than on the code itself.
  ctx.imageSmoothingEnabled = false;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  if (!(await drawSvgBitmap(ctx, blob, cw, ch))) return null;

  // Restore the quiet zone the standard requires (four modules, ISO/IEC 18004).
  // The export is cropped to the configured margin - 4px by default, a fraction
  // of one module - and a decoder handed that crop cannot lock onto the finder
  // patterns even though the code reads fine on a page or screen. Padding with
  // the code's own background models that surface; the verdict would otherwise
  // condemn every default render.
  const pad =
    moduleCount > 0
      ? Math.max(2, Math.round((4 * cw) / moduleCount))
      : Math.max(2, Math.round(cw * 0.12));
  const out = document.createElement("canvas");
  out.width = cw + pad * 2;
  out.height = ch + pad * 2;
  const octx = out.getContext("2d", { willReadFrequently: true });
  if (!octx) return null;

  try {
    const corner = ctx.getImageData(0, 0, 1, 1).data;
    // A light corner is the code's background; a dark one means the crop starts
    // on a module, so fall back to the usual white surface.
    const light = (corner[0] + corner[1] + corner[2]) / 3 >= 128;
    octx.fillStyle = light ? `rgb(${corner[0]}, ${corner[1]}, ${corner[2]})` : "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(canvas, pad, pad);

    const imageData = octx.getImageData(0, 0, out.width, out.height);
    return Boolean(
      decode(imageData.data, out.width, out.height, { inversionAttempts: "attemptBoth" })
    );
  } catch (err) {
    console.warn("[QR] Scannability decode failed:", err);
    return null;
  }
}
