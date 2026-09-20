import { state } from "../state";
import { SVG_NS, parseSvgDocument, findMaskSilhouette, clipToShape } from "./mask.js";

/**
 * The library paints its background as a canvas-sized direct-child <rect>;
 * rects inside <defs> clipPaths must never match or the image lands in <defs>.
 * Prefers a canvas-sized rect, falling back to the first direct rect.
 */
function backgroundRect(parent, w, h) {
  let first = null;
  for (const child of parent.children) {
    if (child.tagName !== "rect") continue;
    if (!first) first = child;
    const cw = Number(child.getAttribute("width"));
    const ch = Number(child.getAttribute("height"));
    if (Math.abs(cw - w) <= 0.5 && Math.abs(ch - h) <= 0.5) return child;
  }
  return first;
}

/** The radius pass' content group, when one is present. */
function radiusGroup(container) {
  for (const child of container.children) {
    if (child.tagName !== "g") continue;
    if ((child.getAttribute("clip-path") || "").includes("qr-canvas-radius-clip")) return child;
  }
  return null;
}

/**
 * Doc-level background pass: insert the cover-fit image (and the scrim)
 * behind the code, inside the active mask silhouette / radius group.
 * Returns true when the tree was modified.
 */
export function applyBackgroundImageToDoc(doc, w, h) {
  const dataUrl = state.generator.bgImageDataUrl;
  if (!dataUrl) return false;

  const root = doc.documentElement;
  // Framed renders nest the library SVG, so the background rect is one level in.
  const container = Array.from(root.children).find((child) => child.tagName === "svg") || root;
  const image = doc.createElementNS(SVG_NS, "image");
  image.setAttribute("x", "0");
  image.setAttribute("y", "0");
  image.setAttribute("width", String(w));
  image.setAttribute("height", String(h));
  image.setAttribute("preserveAspectRatio", "xMidYMid slice");
  image.setAttribute("href", dataUrl);
  image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", dataUrl);

  // Scrim between the image and the code: without it the picture shows through
  // the code's light modules and the result reads as a broken/clipped QR.
  const scrim = doc.createElementNS(SVG_NS, "rect");
  scrim.setAttribute("x", "0");
  scrim.setAttribute("y", "0");
  scrim.setAttribute("width", String(w));
  scrim.setAttribute("height", String(h));
  scrim.setAttribute("fill", state.generator.bgColor || "#000000");
  scrim.setAttribute("fill-opacity", "0.78");

  // A mask replaces the background rect with its own silhouette: the image
  // must be clipped to that shape, otherwise it either hides behind the
  // opaque silhouette or spills past it as a full-canvas square.
  const silhouette = findMaskSilhouette(container);
  if (silhouette) {
    const clipId = clipToShape(doc, container, "qr-bg-image-mask-clip", silhouette);
    image.setAttribute("clip-path", `url(#${clipId})`);
    scrim.setAttribute("clip-path", `url(#${clipId})`);
    silhouette.after(image);
    image.after(scrim);
    return true;
  }

  // With a border radius the background rect is outside the clipped content
  // group; inserting the image inside that group keeps it behind the code and
  // inside the rounded canvas instead of hidden below the opaque background.
  const group = radiusGroup(container);
  if (group) {
    group.insertBefore(scrim, group.firstChild);
    group.insertBefore(image, scrim);
    return true;
  }

  const bgRect = backgroundRect(container, w, h);
  if (bgRect) bgRect.after(image);
  else container.insertBefore(image, container.firstChild);
  image.after(scrim);
  return true;
}

/**
 * Paint the user's background image behind the code. The library's background
 * rect stays below the image so a transparent code still reads over it.
 * Returns the input untouched when there is no image or the SVG can't be parsed.
 */
export function applyBackgroundImage(svgText, w, h) {
  if (!state.generator.bgImageDataUrl) return svgText;
  if (typeof DOMParser === "undefined") return svgText;
  const doc = parseSvgDocument(svgText);
  if (!doc) return svgText;
  if (!applyBackgroundImageToDoc(doc, w, h)) return svgText;
  return new XMLSerializer().serializeToString(doc.documentElement);
}
