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

// Reused raster surfaces: a check used to allocate two canvases per render.
// Two pooled entries are enough (the base raster plus the padded fallback).
const canvasPool = [];
/**
 * @param {number} w
 * @param {number} h
 * @returns {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D } | null}
 */
function acquireCanvas(w, h) {
  if (typeof document === "undefined") return null;
  let entry = canvasPool.pop() || null;
  if (!entry) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    entry = { canvas, ctx };
  } else {
    // A pooled canvas keeps its context object across resizes; re-read it in
    // case the spy/mock in tests replaced getContext between checks.
    const ctx = entry.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    entry.ctx = ctx;
  }
  entry.canvas.width = w;
  entry.canvas.height = h;
  return entry;
}

/** @param {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D } | null} entry */
function releaseCanvas(entry) {
  if (entry && canvasPool.length < 2) canvasPool.push(entry);
}

// One shared badge worker: decoding off the main thread keeps the badge from
// janking the config panel. Single-flight — a check already running means the
// caller falls back to the main thread for this pass.
let badgeWorker = null;
let badgeWorkerBusy = false;
let badgeWorkerSeq = 0;
const BADGE_WORKER_TIMEOUT_MS = 8000;

function getBadgeWorker() {
  if (badgeWorker) return badgeWorker;
  if (typeof Worker === "undefined") return null;
  try {
    const created = new Worker("src/js/scanner/worker.js");
    created.onerror = () => {
      try {
        created.terminate();
      } catch {
        // Already gone.
      }
      if (badgeWorker === created) badgeWorker = null;
    };
    badgeWorker = created;
    return badgeWorker;
  } catch {
    return null;
  }
}

/**
 * Decode via the shared worker. Resolves the payload string on success,
 * `false` when the worker decoded nothing, and `null` when the worker path
 * is unavailable (caller falls back to the main thread). Never transfers the
 * buffer, so the caller's ImageData stays usable for the fallback.
 */
function decodeViaWorker(imageData, w, h) {
  const worker = getBadgeWorker();
  if (!worker || badgeWorkerBusy) return Promise.resolve(null);
  badgeWorkerBusy = true;
  const id = ++badgeWorkerSeq;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      badgeWorkerBusy = false;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), BADGE_WORKER_TIMEOUT_MS);
    const onMessage = (e) => {
      const data = e && e.data;
      if (!data || data.id !== id) return;
      finish(data.success && typeof data.data === "string" ? data.data : false);
    };
    worker.addEventListener("message", onMessage);
    try {
      worker.postMessage({
        imageData,
        width: w,
        height: h,
        inversionAttempts: "attemptBoth",
        mode: "badge",
        id,
      });
    } catch {
      finish(null);
    }
  });
}

/**
 * Main-thread decode of one raster. `true` = decodes (and matches `expected`
 * when one is given), `false` = decodes to nothing (or to another payload),
 * `null` = no verdict possible.
 */
function decodeOnMainThread(imageData, w, h, expected) {
  const decode = /** @type {any} */ (globalThis).jsQR;
  if (typeof decode !== "function") return null;
  let out;
  try {
    out = decode(imageData.data, w, h, { inversionAttempts: "attemptBoth" });
  } catch {
    return null;
  }
  if (!out) return false;
  if (typeof expected === "string" && expected !== "" && out.data !== expected) return false;
  return true;
}

/**
 * Decode a rendered SVG. Resolves `true` when it decodes and `false` when it
 * does not; `null` means the verdict could not be established (no canvas, the
 * decoder failed to load, or the raster failed), so callers must not read it as
 * a failure.
 *
 * The unmodified artifact is tested first: the verdict describes exactly the
 * pixels the export contains. Only when that fails is the standard quiet zone
 * restored around a copy (the export is cropped to the configured margin, so a
 * strict decoder can miss the finders on an otherwise fine code). `expected`
 * compares the decoded payload, so a mis-decode never reports success.
 * @param {unknown} svg
 * @param {unknown} w
 * @param {unknown} h
 * @param {number} [moduleCount] Module count of the render, used to size the
 *   quiet zone that is restored before decoding.
 * @param {string} [expected] Payload the decoded data must equal.
 * @returns {Promise<boolean | null>}
 */
export async function svgDecodes(svg, w, h, moduleCount = 0, expected = "") {
  if (typeof svg !== "string" || svg === "") return null;

  // Rasterise at the SVG's own size: a framed render is taller than wide, and
  // squashing it into the QR canvas size would distort the code. The caller's
  // size is the fallback for an SVG that carries no width/height.
  const intrinsic = svgIntrinsicSize(svg);
  const { w: cw, h: ch } = decodeCanvasSize(intrinsic ? intrinsic.w : w, intrinsic ? intrinsic.h : h);
  const base = acquireCanvas(cw, ch);
  if (!base) return null;

  if (!(await loadDecoder())) {
    releaseCanvas(base);
    return null;
  }
  const decode = /** @type {any} */ (globalThis).jsQR;
  if (typeof decode !== "function") {
    releaseCanvas(base);
    return null;
  }

  // Nearest-neighbour: a crisp raster tests the design, and smoothing would make
  // the result depend on the resampling rather than on the code itself.
  base.ctx.imageSmoothingEnabled = false;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  if (!(await drawSvgBitmap(base.ctx, blob, cw, ch))) {
    releaseCanvas(base);
    return null;
  }

  let imageData;
  try {
    imageData = base.ctx.getImageData(0, 0, cw, ch);
  } catch (err) {
    console.warn("[QR] Scannability decode failed:", err);
    releaseCanvas(base);
    return null;
  }

  // Prefer the worker so the decode leaves the main thread; the buffer is
  // posted without transfer, keeping the main-thread fallback viable.
  const viaWorker = await decodeViaWorker(imageData, cw, ch);
  if (typeof viaWorker === "string") {
    releaseCanvas(base);
    if (typeof expected === "string" && expected !== "" && viaWorker !== expected) return false;
    return true;
  }
  if (viaWorker === null) {
    const direct = decodeOnMainThread(imageData, cw, ch, expected);
    if (direct !== false) {
      releaseCanvas(base);
      return direct;
    }
  }
  // The exact artifact did not decode: retry with the standard quiet zone
  // (four modules, ISO/IEC 18004) padded around a copy. The export is cropped
  // to the configured margin — 4px by default, a fraction of one module — and
  // a decoder handed that crop cannot lock onto the finder patterns even
  // though the code reads fine on a page or screen. Padding with the code's
  // own background models that surface; without it every default render would
  // be condemned.
  try {
    const pad =
      moduleCount > 0 ? Math.max(2, Math.round((4 * cw) / moduleCount)) : Math.max(2, Math.round(cw * 0.12));
    const out = acquireCanvas(cw + pad * 2, ch + pad * 2);
    if (!out) return null;
    try {
      const corner = base.ctx.getImageData(0, 0, 1, 1).data;
      // A light corner is the code's background; a dark one means the crop starts
      // on a module, so fall back to the usual white surface.
      const light = (corner[0] + corner[1] + corner[2]) / 3 >= 128;
      out.ctx.fillStyle = light ? `rgb(${corner[0]}, ${corner[1]}, ${corner[2]})` : "#ffffff";
      out.ctx.fillRect(0, 0, out.canvas.width, out.canvas.height);
      out.ctx.drawImage(base.canvas, pad, pad);

      const paddedData = out.ctx.getImageData(0, 0, out.canvas.width, out.canvas.height);
      return decodeOnMainThread(paddedData, out.canvas.width, out.canvas.height, expected);
    } finally {
      releaseCanvas(out);
    }
  } catch (err) {
    console.warn("[QR] Scannability decode failed:", err);
    return null;
  } finally {
    releaseCanvas(base);
  }
}
