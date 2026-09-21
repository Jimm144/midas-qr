import { state } from "../state";
import { framesConfig, FRAME_FONTS } from "../frames";
import { getQrCode } from "./qr-instance.js";
import { applySurroundShapeToDoc, optimizeSvgRects, parseSvgDocument, SVG_NS } from "./mask.js";
import { resolveFrameGeometry, frameOutputSize } from "./layout.js";
import { parseGradient, diagonalSpan, linearEndpoints } from "./gradient.js";
import { escapeHTML, HEX_COLOR_RE } from "../utils.js";

/**
 * Assemble the framed artwork around an already post-processed QR document.
 * @param {number} w
 * @param {number} h
 * @param {number} userMarginPx
 * @param {number} [moduleCount]
 * @param {unknown} [qrMatrix]
 * @param {string|null} [processedQrSvg]
 * @param {Document|null} [processedQrDoc]
 * @param {{ moduleSize?: number, totalMarginPx?: number, maskDx?: number, maskDy?: number }|null} [layout]
 * @returns {Promise<string>}
 */
export async function getCombinedSvgString(
  w,
  h,
  userMarginPx,
  moduleCount = 21,
  qrMatrix = null,
  processedQrSvg = null,
  processedQrDoc = null,
  layout = null
) {
  const frameConfig = framesConfig[state.generator.frameStyle];
  let innerDoc;
  let fallbackText;

  if (processedQrDoc) {
    // Shared with postProcessSvgWithDoc: skip the serialize->parse round-trip
    // between the post-processing passes and the frame assembly.
    fallbackText = processedQrSvg || "";
    innerDoc = processedQrDoc;
  } else if (processedQrSvg) {
    fallbackText = processedQrSvg;
    innerDoc = parseSvgDocument(processedQrSvg);
  } else {
    const qrSvgBlob = await getQrCode().getRawData("svg");
    const rawSvgText = await qrSvgBlob.text();
    fallbackText = rawSvgText;
    innerDoc = parseSvgDocument(optimizeSvgRects(rawSvgText));
    if (innerDoc && state.generator.maskType !== "none") {
      applySurroundShapeToDoc(innerDoc, userMarginPx, w, h, moduleCount, qrMatrix, layout);
    }
  }

  if (!innerDoc) return fallbackText;
  const innerSvg = innerDoc.documentElement;

  if (!frameConfig) {
    return new XMLSerializer().serializeToString(innerDoc);
  }
  if (!innerSvg.getAttribute("viewBox")) {
    innerSvg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
  innerSvg.setAttribute("width", "100%");
  innerSvg.setAttribute("height", "100%");
  innerSvg.setAttribute("overflow", "visible");
  const serializer = new XMLSerializer();
  const cleanQrSvg = serializer.serializeToString(innerSvg).replace(/<\?xml.*?\?>/, "");

  const textStr = escapeHTML(state.generator.frameText).trim();
  const hasText = textStr.length > 0;
  const geo = resolveFrameGeometry(
    state.generator.frameStyle,
    state.generator.frameText,
    state.generator.frameTextEnabled
  );
  const showText = hasText && geo.showText;
  const { vbHeight, qrArea, frameArt } = geo;
  const { w: outWidth, h: outHeight } = frameOutputSize(w, geo);
  const dots = state.generator.dotsColor;
  const bg = state.generator.bgColor;
  let framePaint = state.generator.frameColor || dots;
  let frameGradientDefs = "";
  const fg = parseGradient(state.generator.frameGradient);
  if (fg) {
    const id = "qr-frame-grad";
    const base = state.generator.frameColor || dots;
    let geom;
    if (fg.type === "radial") {
      geom = `cx="12" cy="${vbHeight / 2}" r="${Math.max(24, vbHeight) / 2}"`;
    } else {
      const len = diagonalSpan(24, vbHeight, fg.rotation);
      const { x1, y1, x2, y2 } = linearEndpoints(12, vbHeight / 2, len, fg.rotation);
      geom = `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`;
    }
    frameGradientDefs = `<defs><${
      fg.type === "radial" ? "radialGradient" : "linearGradient"
    } id="${id}" gradientUnits="userSpaceOnUse" ${geom}><stop offset="0" stop-color="${base}"/><stop offset="1" stop-color="${fg.color2}"/></${
      fg.type === "radial" ? "radialGradient" : "linearGradient"
    }></defs>`;
    framePaint = `url(#${id})`;
  }
  const strokeWidth = frameConfig.strokeWidth ?? 0.5;
  const frameSvg = frameArt.replace(/__ACCENT__/g, framePaint).replace(/__BG__/g, bg);
  let textEl = "";
  let frameTextGradientDefs = "";
  if (showText) {
    const font = resolveFrameFont();
    const sizePercent = Number(state.generator.frameTextSize);
    const sizeScale = (Number.isFinite(sizePercent) && sizePercent > 0 ? sizePercent : 115) / 100;
    const textX = frameConfig.textArea.x;
    const fontFace = await frameFontFaceCss(font);
    let textPaint = frameTextFill(frameConfig);
    const ftg = parseGradient(state.generator.frameTextGradient);
    if (ftg) {
      const id = "qr-frame-text-grad";
      const base = textPaint;
      let geom;
      if (ftg.type === "radial") {
        geom = `cx="${textX}" cy="${frameConfig.textArea.y}" r="${frameConfig.textArea.size * 2}"`;
      } else {
        const { x1, y1, x2, y2 } = linearEndpoints(textX, frameConfig.textArea.y, 16, ftg.rotation);
        geom = `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`;
      }
      frameTextGradientDefs = `<${
        ftg.type === "radial" ? "radialGradient" : "linearGradient"
      } id="${id}" gradientUnits="userSpaceOnUse" ${geom}><stop offset="0" stop-color="${base}"/><stop offset="1" stop-color="${ftg.color2}"/></${
        ftg.type === "radial" ? "radialGradient" : "linearGradient"
      }>`;
      textPaint = `url(#${id})`;
    }
    const fontSize = frameConfig.textArea.size * sizeScale;
    const outline = frameTextOutline(textPaint, frameConfig);
    const outlineAttrs = outline ? ` stroke="${outline}" stroke-width="0.28" paint-order="stroke"` : "";
    const maxTextWidth = frameConfig.textColor === "bg" ? FRAME_BAR_TEXT_MAX_WIDTH : FRAME_TEXT_MAX_WIDTH;
    const fitAttrs =
      estimatedTextWidth(state.generator.frameText.trim(), fontSize) > maxTextWidth
        ? ` textLength="${maxTextWidth}" lengthAdjust="spacingAndGlyphs"`
        : "";
    textEl = `${fontFace}<text x="${textX}" y="${frameConfig.textArea.y}" font-size="${fontSize.toFixed(
      2
    )}" font-family="${escapeHTML(font.stack)}" font-weight="600" fill="${textPaint}"${outlineAttrs}${fitAttrs} text-anchor="middle" dominant-baseline="central">${textStr}</text>`;
  }
  const allDefs =
    frameGradientDefs || frameTextGradientDefs
      ? `<defs>${frameGradientDefs.replace(/<\/?defs>/g, "")}${frameTextGradientDefs}</defs>`
      : "";
  // The QR carries its own background inside qrArea; the frame card stays
  // transparent around it so the background never spans the frame.
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 24 ${vbHeight}" width="${outWidth}" height="${outHeight}">
      ${allDefs}
      <g fill="none" stroke="${framePaint}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
        ${frameSvg}
      </g>
      <svg x="${qrArea.x}" y="${qrArea.y}" width="${qrArea.w}" height="${qrArea.h}" overflow="visible">
        ${cleanQrSvg}
      </svg>
      ${textEl}
    </svg>`;
}

/**
 * Resolve the frame label colour: an explicit text colour wins, then the
 * frame's own convention (bars use the background so the label reads on the
 * bar), then the frame/dots colour. A bar gradient's second stop counts as
 * bar paint too, so the label never blends into either end of the bar.
 */
export function frameTextFill(frameConfig) {
  const g = state.generator;
  const explicit = g.frameTextColor && HEX_COLOR_RE.test(g.frameTextColor) ? g.frameTextColor : "";
  const barPaints = frameBarPaints();
  if (frameConfig && frameConfig.textColor === "bg") {
    if (explicit && !barPaints.includes(explicit.toLowerCase())) return explicit;
    const bg = g.bgColor || "#ffffff";
    if (!barPaints.includes(bg.toLowerCase())) return bg;
    return contrastTextColor(barPaints);
  }
  return explicit || g.frameColor || g.dotsColor || "#000000";
}

/** Solid colours the label bar can paint with (frame colour + gradient stop 2). */
function frameBarPaints() {
  const g = state.generator;
  const bar = (g.frameColor || g.dotsColor || "#000000").toLowerCase();
  const paints = [bar];
  const fg = parseGradient(g.frameGradient);
  if (fg) {
    const stop = fg.color2.toLowerCase();
    if (stop !== bar) paints.push(stop);
  }
  return paints;
}

/** Relative luminance (0 black – 1 white) of a six-digit hex colour. */
function hexLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever reads best over the average of the bar paints. */
function contrastTextColor(paints) {
  const sum = paints.reduce((total, color) => total + hexLuminance(color), 0);
  const preferred = sum / paints.length > 0.5 ? "#000000" : "#ffffff";
  const other = preferred === "#000000" ? "#ffffff" : "#000000";
  return paints.includes(preferred) ? other : preferred;
}

/**
 * Outline colour for a bar label whose fill collides with a bar stop (only
 * possible for a gradient spanning both black and white): a black fill with a
 * white outline stays readable over every stop, and vice versa.
 */
export function frameTextOutline(textPaint, frameConfig) {
  if (!frameConfig || frameConfig.textColor !== "bg") return "";
  if (!textPaint || textPaint.startsWith("url(") || !HEX_COLOR_RE.test(textPaint)) return "";
  if (!frameBarPaints().includes(textPaint.toLowerCase())) return "";
  return hexLuminance(textPaint) > 0.5 ? "#000000" : "#ffffff";
}

/** Ranges whose glyphs are ~1em wide (CJK, Hangul, full-width forms). */
function isWideGlyph(code) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

/** Estimate the rendered width (in 24-unit frame space) of the label. */
function estimatedTextWidth(text, fontSize) {
  let units = 0;
  for (const char of text) {
    // 0.58em average advance is conservative for the bundled sans faces;
    // wide scripts get a full em so they can never overflow the bar.
    units += isWideGlyph(char.codePointAt(0)) ? 1 : 0.58;
  }
  return units * fontSize;
}

const FRAME_TEXT_MAX_WIDTH = 22;
/** Solid label bars span x 2.5-21.5; keep the text inside them with padding. */
const FRAME_BAR_TEXT_MAX_WIDTH = 18.5;

// Cached stylesheet-defined --font-family-body: theme switches always write the
// variable inline, so the computed-style read (which can force a style recalc)
// only ever runs for the stylesheet default and is reused while inline stays empty.
let themeFontComputed = null;
function themeBodyFontStack() {
  if (typeof document === "undefined") return "";
  const inline = document.documentElement.style.getPropertyValue("--font-family-body").trim();
  if (inline) return inline;
  if (themeFontComputed !== null) return themeFontComputed;
  try {
    themeFontComputed = getComputedStyle(document.documentElement)
      .getPropertyValue("--font-family-body")
      .trim();
  } catch {
    themeFontComputed = "";
  }
  return themeFontComputed;
}

/** Resolve the frame text font: "theme" follows the active --font-family-body. */
function resolveFrameFont() {
  const chosen = FRAME_FONTS.find((f) => f.value === state.generator.frameFont) || FRAME_FONTS[0];
  if (chosen.value !== "theme") return { stack: chosen.stack, family: chosen.family, file: chosen.file };
  const stack = themeBodyFontStack();
  const hosted = FRAME_FONTS.find((f) => f.family && stack.includes(f.family));
  return hosted
    ? { stack, family: hosted.family, file: hosted.file }
    : { stack: stack || "system-ui, sans-serif", family: null, file: null };
}

/**
 * Everything the resolved frame label font depends on, for render-cache keys.
 * Empty when no frame label is painted (the font cannot affect the output).
 */
export function frameFontSignature() {
  if (state.generator.frameStyle === "none") return "";
  if (!state.generator.frameTextEnabled) return "";
  if (!String(state.generator.frameText || "").trim()) return "";
  const frameConfig = framesConfig[state.generator.frameStyle];
  if (!frameConfig || !frameConfig.textArea) return "";
  return resolveFrameFont().stack;
}

const fontFaceCache = new Map();

/**
 * Exports rasterize the frame SVG inside an <img>, where external fonts are
 * unavailable — so hosted families are embedded as base64 @font-face rules.
 * Cached per file; failures resolve to "" (system fallback, never breaks).
 */
async function frameFontFaceCss(font) {
  if (!font || !font.family || !font.file) return "";
  if (!fontFaceCache.has(font.file)) {
    fontFaceCache.set(
      font.file,
      fetch(font.file)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((buf) => {
          const bytes = new Uint8Array(buf);
          let bin = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          return `<style>@font-face{font-family:'${font.family}';font-style:normal;font-weight:300 900;src:url(data:font/woff2;base64,${btoa(
            bin
          )}) format('woff2');}</style>`;
        })
        .catch(() => "")
    );
  }
  return fontFaceCache.get(font.file);
}
