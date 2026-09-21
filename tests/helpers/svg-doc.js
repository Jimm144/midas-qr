// String-level adapters over the doc-level SVG passes, for tests that assert
// serialized markup. Production code calls the *ToDoc passes through
// svg-pipeline.js; these shims keep the same input/output contract as the
// string wrappers the pipeline replaced (input returned unchanged when the
// pass reports no change).
import {
  applySurroundShapeToDoc,
  applyCornerStylesToDoc,
  applyGlobalDotGradientToDoc,
  parseSvgDocument,
} from "../../src/js/generator/mask.js";
import { applyBackgroundImageToDoc } from "../../src/js/generator/background.js";

/**
 * Parse `svgText`, run `fn(doc)`, and return the serialized document — or the
 * original string when the markup does not parse or `fn` reports no change.
 * @param {string} svgText
 * @param {(doc: Document) => boolean} fn
 * @returns {string}
 */
export function withDoc(svgText, fn) {
  const doc = parseSvgDocument(svgText);
  if (!doc) return svgText;
  if (!fn(doc)) return svgText;
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export const applySurroundShape = (svgText, userMarginPx, w, h, moduleCount = 21, qrMatrix = null) =>
  withDoc(svgText, (doc) => applySurroundShapeToDoc(doc, userMarginPx, w, h, moduleCount, qrMatrix));

export const applyCornerStyles = (svgText) =>
  withDoc(svgText, (doc) => applyCornerStylesToDoc(doc));

export const applyGlobalDotGradient = (svgText, w, h) =>
  withDoc(svgText, (doc) => applyGlobalDotGradientToDoc(doc, w, h));

export const applyBackgroundImage = (svgText, w, h) =>
  withDoc(svgText, (doc) => applyBackgroundImageToDoc(doc, w, h));
