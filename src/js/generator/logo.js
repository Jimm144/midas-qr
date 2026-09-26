import { state } from "../state";
import { SVG_NS, findMaskSilhouette, clipToShape } from "./mask.js";

/**
 * Doc-level logo overlay pass: insert the centered logo image and backing
 * plate over the code. This ensures reliable SVG rendering without depending
 * on library-internal async image loaders.
 *
 * @param {Document} doc Parsed SVG document
 * @param {number} w Width of the QR canvas in pixels
 * @param {number} h Height of the QR canvas in pixels
 * @returns {boolean} True if the document was modified
 */
export function applyLogoToDoc(doc, w, h) {
  const dataUrl = state.generator.logoDataUrl;
  if (!dataUrl) return false;

  const root = doc.documentElement;
  if (!root.getAttribute("xmlns:xlink")) {
    root.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }

  const container =
    Array.from(root.children).find((child) => child.tagName && child.tagName.toLowerCase() === "svg") || root;

  // Clean up any previously injected logo elements to prevent duplicates
  container.querySelectorAll(".qr-logo-overlay").forEach((el) => el.remove());

  const logoProp = Math.min(0.5, Math.max(0.1, state.generator.logoSizeProportion ?? 0.4));
  const size = Math.round(w * logoProp);
  const margin = Math.max(0, state.generator.imageMargin ?? 0);
  // A mask shifts the code inside the canvas; the logo must ride that same
  // offset or it floats over the empty part of the shape.
  const maskContent = container.querySelector(".qr-mask-content");
  const shiftX = maskContent ? Number(maskContent.getAttribute("data-qr-dx")) || 0 : 0;
  const shiftY = maskContent ? Number(maskContent.getAttribute("data-qr-dy")) || 0 : 0;
  const x = Math.round((w - size) / 2) + shiftX;
  const y = Math.round((h - size) / 2) + shiftY;

  const group = doc.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "qr-logo-overlay");

  // Contain the overlay: to the mask silhouette when one is active (a wide
  // backing plate would otherwise paint a square over the shape), otherwise
  // to the canvas (a large imageMargin would otherwise bleed over the frame
  // in framed renders, where the QR svg is nested with overflow:visible).
  const silhouette = findMaskSilhouette(container);
  let clipId;
  if (silhouette) {
    clipId = clipToShape(doc, container, "qr-logo-mask-clip", silhouette);
  } else {
    const canvasRect = doc.createElementNS(SVG_NS, "rect");
    canvasRect.setAttribute("x", "0");
    canvasRect.setAttribute("y", "0");
    canvasRect.setAttribute("width", String(w));
    canvasRect.setAttribute("height", String(h));
    clipId = clipToShape(doc, container, "qr-logo-canvas-clip", canvasRect);
  }
  group.setAttribute("clip-path", `url(#${clipId})`);

  // Backing plate to guarantee high contrast and block dots under the logo.
  // It only exists when the user asked for image margin: at margin 0 the plate
  // would be exactly the logo's square, which an opaque logo hides completely
  // but which paints a solid block behind a transparent one — the "my
  // transparent logo grew a background" case.
  //
  // The margin is capped so the plate can never swallow the code: at the
  // maximum 100px margin with a small logo the plate would cover most of the
  // canvas and nothing would scan. Half the canvas is the ceiling; the badge
  // reports the same threshold via readability.logoPlateTooBig.
  const canvasSide = Math.min(w, h);
  const pad = Math.max(0, Math.min(margin, (canvasSide * 0.5 - size) / 2));
  if (pad > 0) {
    const backing = doc.createElementNS(SVG_NS, "rect");
    backing.setAttribute("class", "qr-logo-backing");
    backing.setAttribute("x", String(x - pad));
    backing.setAttribute("y", String(y - pad));
    backing.setAttribute("width", String(size + 2 * pad));
    backing.setAttribute("height", String(size + 2 * pad));
    backing.setAttribute("rx", "4");
    backing.setAttribute("ry", "4");
    const bg = state.generator.bgTransparent ? "#ffffff" : state.generator.bgColor || "#ffffff";
    backing.setAttribute("fill", bg);
    group.appendChild(backing);
  }

  // Logo image
  const img = doc.createElementNS(SVG_NS, "image");
  img.setAttribute("class", "qr-logo-image");
  img.setAttribute("x", String(x));
  img.setAttribute("y", String(y));
  img.setAttribute("width", String(size));
  img.setAttribute("height", String(size));
  img.setAttribute("preserveAspectRatio", "xMidYMid meet");
  img.setAttribute("href", dataUrl);
  img.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", dataUrl);
  group.appendChild(img);

  container.appendChild(group);
  return true;
}
