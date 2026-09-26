import { DOM } from "../ui/dom.js";
import { state } from "../state";
import { resolveFrameGeometry, frameOutputSize } from "./layout.js";
import { getQrCode } from "./qr-instance.js";
import { renderOnce } from "./generator.js";
import { copyTextToClipboard, snapshot } from "../utils.js";
import { announce } from "../ui/announce.js";
import { t } from "../i18n.js";
import { flashButton } from "../ui/components.js";
import { getRenderInfo } from "./render-info.js";
import { ensureQrcodeLoaded, generateUnicodeQR } from "./encoder.js";

const ALLOWED_EXPORT_FORMATS = new Set(["png", "svg", "jpeg", "webp", "txt"]);
// Largest canvas edge the exporter will allocate. Preview sizes are clamped to
// 2000px and frames scale that up ~1.5x, so this only ever trips on corrupt
// state — but it turns a silent toBlob failure into a clear console error.
const MAX_EXPORT_DIMENSION = 8192;

function normalizeFormat(value) {
  return ALLOWED_EXPORT_FORMATS.has(value) ? value : "png";
}

/** Read a numeric width/height from an <svg> open tag (percentages ignored). */
function readSvgLength(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0 || match[1].includes("%")) return null;
  return value;
}

/**
 * Intrinsic pixel size of a rendered SVG, taken from its own root tag. The
 * rendered string and its size travel together, so a pending re-render can
 * never make the export use one config's pixels for another's artwork.
 */
function svgIntrinsicSize(svg) {
  if (typeof svg !== "string") return null;
  const root = /<svg\b[^>]*>/i.exec(svg);
  if (!root) return null;
  const w = readSvgLength(root[0], "width");
  const h = readSvgLength(root[0], "height");
  if (!w || !h) return null;
  return { w, h };
}

/**
 * Output dimensions for the current render. Prefer the SVG's own size; fall
 * back to the state that produced an SVG without width/height (same math the
 * frame builder used for framed output, 24-unit-wide viewBox included).
 */
function exportDimensions(info) {
  const intrinsic = svgIntrinsicSize(info.svg);
  if (intrinsic) {
    return { w: Math.max(1, Math.round(intrinsic.w)), h: Math.max(1, Math.round(intrinsic.h)) };
  }
  if (!Number.isFinite(info.w) || !Number.isFinite(info.h) || info.w <= 0 || info.h <= 0) return null;
  let outW = info.w;
  let outH = info.h;
  if (state.generator.frameStyle !== "none") {
    const geo = resolveFrameGeometry(
      state.generator.frameStyle,
      state.generator.frameText,
      state.generator.frameTextEnabled
    );
    if (!geo || !geo.qrArea || !geo.qrArea.w) return null;
    const out = frameOutputSize(info.w, geo);
    outW = out.w;
    outH = out.h;
  }
  return { w: Math.max(1, Math.round(outW)), h: Math.max(1, Math.round(outH)) };
}

/** Rasterize an SVG string into a blob, optionally compositing a background. */
/**
 * Draw an SVG blob onto the 2D context. The <img> path is preferred because it
 * is the only SVG decode Chromium supports (createImageBitmap rejects SVG blobs
 * there, which used to log a warning on every export); createImageBitmap stays
 * as a fallback for engines where the image load fails.
 */
async function drawSvgBitmap(ctx, svgBlob, w, h) {
  try {
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      await new Promise((resolve, reject) => {
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
        img.onerror = () => reject(new Error("Export failed"));
        img.src = svgUrl;
      });
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

async function rasterizeSvg(svgStr, ext, w, h, backgroundFill) {
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  if (ext === "svg") return svgBlob;
  if (w > MAX_EXPORT_DIMENSION || h > MAX_EXPORT_DIMENSION) {
    throw new Error(`Export size ${w}x${h} exceeds the ${MAX_EXPORT_DIMENSION}px limit`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable in this browser");
  if (backgroundFill) {
    ctx.fillStyle = backgroundFill;
    ctx.fillRect(0, 0, w, h);
  }

  if (!(await drawSvgBitmap(ctx, svgBlob, w, h))) {
    throw new Error("Export failed");
  }

  if (typeof canvas.toBlob !== "function") {
    throw new Error("Canvas encoding is not supported in this browser");
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Export failed"))),
      `image/${ext === "jpeg" || ext === "png" || ext === "webp" ? ext : "png"}`,
      1.0
    );
  });
}

/**
 * Render the live config through the queued one-off renderer and return the
 * info shape exportRenderedBlob consumes. Using getRenderInfo() directly races
 * a state change that is still rendering (or debounced): a removed logo could
 * still appear in the downloaded file when Download was clicked before the
 * re-render finished. The renderer's memo makes this a no-op when the preview
 * is already current.
 */
async function currentRenderInfo() {
  try {
    const result = await renderOnce(snapshot(state.generator));
    return { svg: result.svg, w: result.w, h: result.h };
  } catch {
    return null;
  }
}

/**
 * Export exactly what the preview shows: rasterizes the last rendered SVG, so
 * masks (circle/heart/triangle/custom) survive download and copy, framed output
 * keeps its computed size (read from the SVG itself), and transparent JPEG
 * output fills the configured background colour. `infoOverride` lets callers
 * export a specific (e.g. freshly awaited) render instead of the published one.
 * `dataOverride` carries payload/background fields for renders performed on
 * behalf of a row/history entry, whose config is restored before this runs:
 * `{ dataString, ecc }` feed the TXT encoder and `{ bgTransparent, bgColor }`
 * decide the opaque fill (so a saved transparent design stays transparent).
 */
export async function exportRenderedBlob(ext, infoOverride = null, dataOverride = null) {
  const format = normalizeFormat(ext);
  // TXT needs no raster pipeline: it is the Unicode block-art rendering of the
  // data, so batch/history exporters get a real text file instead of PNG bytes
  // under a .txt name.
  if (format === "txt") {
    if (!(await ensureQrcodeLoaded())) return null;
    const text = overrideValue(dataOverride, "dataString", state.generator.dataString);
    const ecc = overrideValue(dataOverride, "ecc", state.generator.ecc);
    const ascii = generateUnicodeQR(text, ecc);
    return ascii ? new Blob([ascii], { type: "text/plain;charset=utf-8" }) : null;
  }
  const info = infoOverride || getRenderInfo();
  if (!info || !info.svg) return null;
  const size = exportDimensions(info);
  if (!size) return null;
  const bgTransparent = overrideValue(dataOverride, "bgTransparent", state.generator.bgTransparent);
  const bgColor = overrideValue(dataOverride, "bgColor", state.generator.bgColor);
  const needsOpaqueFill = format === "jpeg" || !bgTransparent;
  const fill = needsOpaqueFill ? bgColor || "#FFFFFF" : null;
  return rasterizeSvg(info.svg, format, size.w, size.h, fill);
}

/** Read an overridden field, falling back to the live generator value. */
function overrideValue(overrides, key, fallback) {
  return overrides && overrides[key] !== undefined ? overrides[key] : fallback;
}

/**
 * Suggested file name: something a person would recognise, derived from the
 * payload — the host of a URL, a Wi-Fi SSID, a contact name. It used to be
 * `qr-url-2026-09-26-1505`, which said nothing and changed every minute, so the
 * placeholder kept shifting under the user.
 */
function getDefaultFilename() {
  const raw = (state.generator.dataString || "").trim();
  const host = () => {
    try {
      return new URL(raw).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const derived = (() => {
    if (/^https?:\/\//i.test(raw)) return host();
    const wifi = raw.match(/^WIFI:S:([^;]*)/i);
    if (wifi && wifi[1]) return wifi[1];
    if (/^BEGIN:VCARD/i.test(raw)) {
      const name = raw.match(/^FN:(.+)$/m);
      if (name) return name[1];
    }
    if (/^mailto:/i.test(raw)) return raw.slice(7).split("?")[0];
    if (/^tel:/i.test(raw)) return raw.slice(4);
    if (/^SMSTO:/i.test(raw)) return raw.slice(6).split(":")[0];
    if (/^geo:/i.test(raw)) return raw.slice(4).replace(",", "-");
    return raw.replace(/\s+/g, " ").slice(0, 32).trim();
  })();
  // Sanitized here as well as at download time so the placeholder shows exactly
  // what the file will be called.
  return sanitizeFilename(derived, "qr-code");
}

// Windows refuses these as file names regardless of extension.
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Make a user-supplied file name safe for every platform: strip control
 * characters and path separators, drop leading/trailing dots and spaces
 * (hidden/undownloadable names on Windows), dodge reserved device names, cap
 * the length, and fall back to the default when nothing survives.
 */
export function sanitizeFilename(raw, fallback = "qr-code") {
  let name = typeof raw === "string" ? raw : "";
  name = name
    .replace(/\p{Cc}/gu, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim();
  name = name.replace(/^[.\s-]+/, "").replace(/[.\s-]+$/, "");
  if (WINDOWS_RESERVED_NAME_RE.test(name)) name = `${name}-qr`;
  if (name.length > 100) name = name.slice(0, 100).replace(/[.\s-]+$/, "");
  return name || fallback;
}

/** Reflect the current default filename (type-timestamp) in the input placeholder. */
export function updateExportFilenamePlaceholder() {
  if (DOM.exportFilename) DOM.exportFilename.placeholder = getDefaultFilename();
}

/** Trigger a temporary anchor download for a blob, then revoke the URL. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser time to start reading large blobs before the URL dies:
  // revoking too eagerly can abort the download in slower engines.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download the current QR as text, or as the selected raster/vector format. */
async function handleDownloadClick() {
  const ext = normalizeFormat(DOM.exportFormat.value || "png");
  const rawFilename = DOM.exportFilename.value.trim();
  const filename = sanitizeFilename(
    rawFilename.replace(/\.(png|svg|jpeg|jpg|webp|txt)$/i, ""),
    getDefaultFilename()
  );
  if (ext === "txt") {
    await ensureQrcodeLoaded();
    const ascii = generateUnicodeQR(state.generator.dataString, state.generator.ecc);
    if (!ascii) {
      announce(t("export.tooLargeText"));
      return;
    }
    const blob = new Blob([ascii], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `${filename}.txt`);
    announce(t("export.downloadedText"));
    return;
  }
  try {
    const blob = await exportRenderedBlob(ext, await currentRenderInfo());
    if (blob) {
      downloadBlob(blob, `${filename}.${ext}`);
    } else {
      getQrCode().download({ name: filename, extension: ext });
    }
    announce(t("export.downloadedFormat", { format: ext.toUpperCase() }));
  } catch (err) {
    console.error("[QR] export failed:", err);
    announce(t("export.failedFormat", { format: ext.toUpperCase() }));
  }
}

/** Copy the current QR (text, SVG or raster) to the clipboard with button feedback. */
async function handleCopyClick() {
  if (!state.generator.dataString || !state.generator.isValid) return;
  const notifyCopy = (label, classes, time, announcement) => {
    flashButton(DOM.btnCopy, label, time, classes);
    announce(announcement);
  };
  const notifyCopySuccess = () => {
    notifyCopy(t("controls.copied"), ["bg-white", "text-black"], 1500, t("export.copiedClipboard"));
  };
  const notifyCopyFailure = () => {
    notifyCopy(t("export.copyFailed"), ["bg-red-500", "text-white"], 2000, t("export.copyFailed"));
  };
  const notifyResult = (ok) => {
    if (ok) notifyCopySuccess();
    else notifyCopyFailure();
  };
  try {
    const ext = normalizeFormat(DOM.exportFormat.value || "png");
    if (ext === "txt") {
      await ensureQrcodeLoaded();
      const ascii = generateUnicodeQR(state.generator.dataString, state.generator.ecc);
      if (!ascii) {
        notifyCopy(t("export.tooLarge"), ["bg-red-500", "text-white"], 2000, t("export.tooLargeCopy"));
        return;
      }
      notifyResult(await copyTextToClipboard(ascii));
      return;
    }
    // Render the live config once so every copy path matches the current
    // state even if a state change is still rendering or debounced.
    const info = await currentRenderInfo();
    if (ext === "svg") {
      const blob = await exportRenderedBlob("svg", info);
      const text = (blob ? await blob.text() : info?.svg) || "";
      if (!text) {
        notifyCopyFailure();
        return;
      }
      notifyResult(await copyTextToClipboard(text));
      return;
    }
    // Raster formats (PNG, JPEG, WebP): W3C Clipboard API strictly mandates image/png
    let imageOk = false;
    try {
      if (!navigator.clipboard || typeof window.ClipboardItem !== "function") {
        throw new Error("Clipboard image copy not supported");
      }
      const pngBlob = await exportRenderedBlob("png", info);
      if (!pngBlob) throw new Error("Export failed");
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": pngBlob,
        }),
      ]);
      imageOk = true;
    } catch (err) {
      console.warn("Clipboard image write failed, falling back to SVG text:", err);
    }
    if (imageOk) {
      notifyCopySuccess();
      return;
    }
    const svgText = (info && info.svg) || (await (await getQrCode().getRawData("svg")).text());
    if (!svgText) {
      notifyCopyFailure();
      return;
    }
    notifyResult(await copyTextToClipboard(svgText));
  } catch (err) {
    console.error(err);
    notifyCopyFailure();
  }
}

export function initExport() {
  updateExportFilenamePlaceholder();
  if (DOM.exportFilename) {
    DOM.exportFilename.addEventListener("focus", updateExportFilenamePlaceholder);
  }
  DOM.btnDownload.addEventListener("click", handleDownloadClick);
  DOM.btnCopy.addEventListener("click", handleCopyClick);
}
