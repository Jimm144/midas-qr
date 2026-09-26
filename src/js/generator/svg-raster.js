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
export function readSvgLength(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag);
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
export function svgIntrinsicSize(svg) {
  if (typeof svg !== "string") return null;
  const root = /<svg\b[^>]*>/i.exec(svg);
  if (!root) return null;
  const w = readSvgLength(root[0], "width");
  const h = readSvgLength(root[0], "height");
  if (!w || !h) return null;
  return { w, h };
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
export async function drawSvgBitmap(ctx, svgBlob, w, h) {
  try {
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      /** @type {Promise<void>} */
      const decoded = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          // An SVG with no intrinsic size decodes to 0x0; drawing it would
          // silently produce a blank export, so make it fail loudly instead.
          if (!img.naturalWidth || !img.naturalHeight) {
            reject(new Error("SVG has no intrinsic size"));
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve();
        };
        img.onerror = () => reject(new Error("SVG decode failed"));
        img.src = svgUrl;
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
      bitmap = await createImageBitmap(svgBlob);
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
