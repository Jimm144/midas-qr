// @ts-check
/**
 * Rasterise a rendered SVG string onto a 2D canvas.
 *
 * Shared by the exporter and the scannability check so both see exactly the
 * same pixels: the badge's verdict is a decode of the file the user downloads,
 * not a guess from the configuration.
 */

/**
 * Read a numeric width/height from an <svg> open tag (percentages ignored).
 * @param {string} tag
 * @param {string} name
 * @returns {number | null}
 */
const WIDTH_ATTR_RE = /\bwidth\s*=\s*["']([^"']+)["']/i;
const HEIGHT_ATTR_RE = /\bheight\s*=\s*["']([^"']+)["']/i;

export function readSvgLength(tag, name) {
  const match = (name === "height" ? HEIGHT_ATTR_RE : WIDTH_ATTR_RE).exec(tag);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0 || match[1].includes("%")) return null;
  return value;
}

/**
 * Intrinsic pixel size of a rendered SVG, taken from its own root tag. The
 * rendered string and its size travel together, so a pending re-render can
 * never make a consumer use one config's pixels for another's artwork. A framed
 * render is taller than wide, so callers must rasterise at this size rather than
 * at the QR canvas size or the artwork is squashed.
 * @param {unknown} svg
 * @returns {{ w: number, h: number } | null}
 */
// One-entry cache: exports and the scannability check read the size of the
// same SVG string back to back, so the root-tag parse runs once per render.
/** @type {{ fp: string | null, val: { w: number, h: number } | null }} */
const intrinsicCache = { fp: null, val: null };
export function svgIntrinsicSize(svg) {
  if (typeof svg !== "string") return null;
  // The root tag always opens the document, so a short head slice identifies
  // the string for caching without hashing megabytes of logo data URLs.
  const fp = `${svg.length}|${svg.slice(0, 256)}`;
  if (intrinsicCache.fp === fp) return intrinsicCache.val;
  const root = /<svg\b[^>]*>/i.exec(svg);
  if (!root) {
    intrinsicCache.fp = fp;
    intrinsicCache.val = null;
    return null;
  }
  const w = readSvgLength(root[0], "width");
  const h = readSvgLength(root[0], "height");
  const out = !w || !h ? null : { w, h };
  intrinsicCache.fp = fp;
  intrinsicCache.val = out;
  return out;
}

/**
 * Draw an SVG blob onto the 2D context. The <img> path is preferred because it
 * is the only SVG decode Chromium supports (createImageBitmap rejects SVG blobs
 * there, which used to log a warning on every export); createImageBitmap stays
 * as a fallback for engines where the image load fails.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Blob} svgBlob
 * @param {number} w
 * @param {number} h
 * @returns {Promise<boolean>}
 */
// Upper bound for one SVG image load: without it a stalled decode leaves the
// awaiting promise (and every export/scannability caller behind it) unsettled.
const SVG_LOAD_TIMEOUT_MS = 15000;

export async function drawSvgBitmap(ctx, svgBlob, w, h) {
  try {
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      /** @type {Promise<void>} */
      const decoded = new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error("SVG decode timed out"));
        }, SVG_LOAD_TIMEOUT_MS);
        const done = (fn, arg) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn(arg);
        };
        const img = new Image();
        img.onload = () => {
          try {
            // An SVG with no intrinsic size decodes to 0x0; drawing it would
            // silently produce a blank export, so make it fail loudly instead.
            // The try/catch matters: a throwing drawImage used to escape the
            // handler and leave this promise unsettled forever.
            if (!img.naturalWidth || !img.naturalHeight) {
              done(reject, new Error("SVG has no intrinsic size"));
              return;
            }
            ctx.drawImage(img, 0, 0, w, h);
            done(resolve);
          } catch (err) {
            done(reject, err instanceof Error ? err : new Error(String(err)));
          }
        };
        img.onerror = () => done(reject, new Error("SVG decode failed"));
        try {
          img.src = svgUrl;
        } catch (err) {
          done(reject, err instanceof Error ? err : new Error(String(err)));
        }
      });
      await decoded;
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
    return true;
  } catch (imgError) {
    if (typeof createImageBitmap !== "function") {
      console.warn("[QR] SVG decode failed:", imgError);
      return false;
    }
    let bitmap = null;
    try {
      // createImageBitmap has no cancellation: race a timeout so the promise
      // always settles even when the engine-side decode stalls.
      bitmap = await Promise.race([
        createImageBitmap(svgBlob),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("SVG bitmap decode timed out")), SVG_LOAD_TIMEOUT_MS)
        ),
      ]);
      if (!bitmap || !bitmap.width || !bitmap.height) {
        console.warn("[QR] SVG decode failed (empty bitmap):", imgError);
        return false;
      }
      ctx.drawImage(bitmap, 0, 0, w, h);
      return true;
    } catch (bitmapError) {
      console.warn("[QR] SVG decode failed:", imgError, bitmapError);
      return false;
    } finally {
      if (bitmap && bitmap.close) bitmap.close();
    }
  }
}
