// @ts-check
/**
 * Single owner of the SVG post-processing order.
 *
 * One interface — `renderSvg({ svgText, layout, moduleCount, qrMatrix })` —
 * takes the library's raw SVG and returns the finished SVG plus the parsed
 * document, so framed assembly can consume the same tree instead of
 * re-parsing. Pass policy (mask, radius, corner styles, gradients, background
 * image, logo) is decided here; callers never order passes themselves.
 */
import { state } from "../state";
import {
  applySurroundShapeToDoc,
  applyCornerStylesToDoc,
  applyGlobalDotGradientToDoc,
  needsCornerStylePass,
  needsGlobalGradientPass,
  optimizeSvgRects,
  parseSvgDocument,
  SVG_NS,
} from "./mask.js";
import { applyBackgroundImageToDoc } from "./background.js";
import { applyLogoToDoc } from "./logo.js";
import { getCombinedSvgString } from "./frame.js";

/**
 * First direct-child rect that spans the whole canvas. The visible background
 * is the only canvas-sized direct rect; matching by geometry means a library
 * that ever emits a different first rect (or an overlay rect) can never get
 * its `rx` rewritten by mistake.
 */
function canvasBackgroundRect(parent, w, h) {
  for (const child of parent.children) {
    if (child.tagName.toLowerCase() !== "rect") continue;
    const cw = Number(child.getAttribute("width"));
    const ch = Number(child.getAttribute("height"));
    if (Math.abs(cw - w) <= 0.5 && Math.abs(ch - h) <= 0.5) return child;
  }
  return null;
}

/**
 * Largest border radius whose rounded clip still fully contains the QR data
 * square, so rounding can never cut into a module.
 *
 * The clip's corner is a quarter circle of radius r centred at (r, r). Its
 * deepest intrusion along the canvas diagonal is r*(1 - 1/√2), which must stop
 * before the data corner at (margin, margin): r ≤ margin / (1 - 1/√2). The
 * result is also capped at half the canvas minus the quiet zone (never a
 * circle, and never larger than half the data area) so hostile persisted or
 * shared values cannot collapse the shape.
 */
export function maxSafeRadius(w, h, marginPx) {
  const side = Math.min(Number(w) || 0, Number(h) || 0);
  if (!(side > 0)) return 0;
  const margin = Math.max(0, Math.min(Number(marginPx) || 0, side / 2));
  const cornerSafe = margin / (1 - Math.SQRT1_2);
  return Math.max(0, Math.min(side / 2, side / 2 - margin, cornerSafe));
}

/**
 * Apply border radius to the QR SVG background rect and clip matrix modules.
 * The effective radius is clamped so no data module is ever cut (and the
 * shape can never collapse into a circle), even for an out-of-range value
 * arriving from persisted state or a share link.
 */
export function applyRadiusToDoc(doc, qrRadius, w, h, userMarginPx = 0) {
  if (!(Number(qrRadius) > 0)) return false;
  const root = doc.documentElement;
  const effectiveRadius = Math.floor(Math.min(Number(qrRadius), maxSafeRadius(w, h, userMarginPx)));
  if (!(effectiveRadius > 0)) return false;

  // The visible background is the first canvas-sized *direct-child* rect. The
  // first rect in document order lives inside <defs> (a clip path); rounding
  // that one leaves the real background square and can distort a module clip.
  const bgRect = canvasBackgroundRect(root, w, h);
  if (bgRect) {
    bgRect.setAttribute("rx", String(effectiveRadius));
    bgRect.setAttribute("ry", String(effectiveRadius));
  }
  let defs = root.querySelector("defs");
  if (!defs) {
    defs = doc.createElementNS(SVG_NS, "defs");
    root.insertBefore(defs, root.firstChild);
  }
  const clipId = "qr-canvas-radius-clip";
  const existingClip = defs.querySelector(`#${clipId}`);
  if (existingClip) existingClip.remove();

  const clip = doc.createElementNS(SVG_NS, "clipPath");
  clip.setAttribute("id", clipId);
  const clipRect = doc.createElementNS(SVG_NS, "rect");
  clipRect.setAttribute("x", "0");
  clipRect.setAttribute("y", "0");
  clipRect.setAttribute("width", String(w));
  clipRect.setAttribute("height", String(h));
  clipRect.setAttribute("rx", String(effectiveRadius));
  clipRect.setAttribute("ry", String(effectiveRadius));
  clip.appendChild(clipRect);
  defs.appendChild(clip);

  const contentChildren = Array.from(root.children).filter(
    (el) => el !== defs && el !== bgRect && el.tagName.toLowerCase() !== "clippath"
  );
  if (contentChildren.length > 0) {
    const clipGroup = doc.createElementNS(SVG_NS, "g");
    clipGroup.setAttribute("clip-path", `url(#${clipId})`);
    contentChildren[0].before(clipGroup);
    contentChildren.forEach((child) => clipGroup.appendChild(child));
  }
  return true;
}

/**
 * Run every post-processing pass over one parse, then either serialize once or
 * hand the parsed document to the frame assembly (framed renders run the mask
 * pass inside the frame artwork, so the pipeline leaves it to `frame.js`).
 * @param {{ svgText: string, layout: { userMarginPx: number, w: number, h: number, moduleSize?: number, totalMarginPx?: number, maskDx?: number, maskDy?: number }, moduleCount?: number, qrMatrix?: unknown }} input
 * @returns {Promise<{ svg: string, doc: Document|null }>}
 */
export async function renderSvg({ svgText, layout, moduleCount = 21, qrMatrix = null }) {
  const { userMarginPx, w, h } = layout;
  const framed = state.generator.frameStyle !== "none";
  const maskActive = state.generator.maskType !== "none";
  const radiusActive = state.generator.maskType === "none" && (state.generator.qrRadius || 0) > 0;
  // The mask pass takes the resolved layout when the caller has one; partial
  // layouts (synthetic test renders) fall back to its positional geometry.
  const maskLayout = layout && Number.isFinite(layout.moduleSize) ? layout : null;
  const needsDomPass =
    maskActive ||
    radiusActive ||
    needsCornerStylePass() ||
    needsGlobalGradientPass() ||
    Boolean(state.generator.bgImageDataUrl) ||
    Boolean(state.generator.logoDataUrl);
  // The string-only module merge runs first so the occasional DOM parse is
  // handed a much smaller tree (and plain renders never need a parse at all).
  // It runs for framed renders too: the frame assembly parses the supplied
  // string/doc as-is and would otherwise keep one rect per module.
  const optimized = optimizeSvgRects(svgText);
  if (!framed && !needsDomPass) return { svg: optimized, doc: null };
  const doc = parseSvgDocument(optimized);
  if (!doc) return { svg: optimized, doc: null };
  let changed = false;
  if (maskActive) {
    changed = applySurroundShapeToDoc(doc, userMarginPx, w, h, moduleCount, qrMatrix, maskLayout) || changed;
  }
  if (radiusActive) {
    changed = applyRadiusToDoc(doc, state.generator.qrRadius, w, h, userMarginPx) || changed;
  }
  changed = applyCornerStylesToDoc(doc) || changed;
  changed = applyGlobalDotGradientToDoc(doc, w, h) || changed;
  changed = applyBackgroundImageToDoc(doc, w, h) || changed;
  changed = applyLogoToDoc(doc, w, h) || changed;
  if (framed) {
    // Framed renders hand the parsed doc straight to the frame assembly, so
    // the serialized string would be discarded: skip it and let frame.js
    // serialize the combined artwork.
    return {
      svg: await getCombinedSvgString(w, h, userMarginPx, moduleCount, qrMatrix, optimized, doc, layout),
      doc,
    };
  }
  if (!changed) return { svg: optimized, doc };
  return { svg: new XMLSerializer().serializeToString(doc.documentElement), doc };
}
