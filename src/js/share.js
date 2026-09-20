// @ts-check
import { state, DEFAULT_GENERATOR, repairLowVisibilityColors } from "./state";
import { FRAME_FONTS, FRAME_TEXT_DEFAULTS } from "./frames";
import { DOM } from "./ui/dom.js";
import {
  HEX_COLOR_RE,
  clampNumber,
  isAllowedValue,
  isSafeBitmapDataUrl,
  isSafeImageSource,
  sanitizeMaskPath,
  toFiniteNumber,
  truncateSafe,
} from "./utils.js";
import {
  ALLOWED_DATA_TYPES,
  ALLOWED_ECC,
  ALLOWED_FRAMES,
  ALLOWED_MASKS,
  ALLOWED_SHAPES,
  GENERATOR_NUMERIC_BOUNDS,
  LEGACY_FRAME_TEXT_SIZES,
  MAX_FRAME_TEXT_LEN,
  SHARE_LOGO_MAX_BYTES,
} from "./constants.js";
import { parseGradient } from "./generator/gradient.js";
import { DATA_TYPES } from "./generator/data-types.js";

/** @typedef {import("./state").GradientSpec} GradientSpec */
/** @typedef {"bgGradient" | "dotsGradient" | "cornersSquareGradient" | "cornersDotGradient"} QrGradientField */
/** @typedef {"frameGradient" | "frameTextGradient"} FrameGradientField */

const ALLOWED_FRAME_FONTS = FRAME_FONTS.map((f) => f.value);
/** Upper bound for share-URL payload fields, generous enough for any encodable QR. */
const MAX_SHARE_DATA_LEN = 4096;
const MAX_MASK_PATH_LEN = 4096;
/** Gradients are tiny ("linear,90,#AABBCC"); anything longer is hostile. */
const MAX_GRADIENT_PARAM_LEN = 64;
/** Numeric bounds shared with the persisted-state sanitizer (single source). */
const BOUNDS = GENERATOR_NUMERIC_BOUNDS;

/** [param, state field] pairs for the four QR color gradients. */
/** @type {ReadonlyArray<[string, QrGradientField]>} */
const QR_GRADIENT_PARAMS = [
  ["bgGrad", "bgGradient"],
  ["dotsGrad", "dotsGradient"],
  ["csGrad", "cornersSquareGradient"],
  ["cdGrad", "cornersDotGradient"],
];

/** [param, state field] pairs for the two frame gradients. */
/** @type {ReadonlyArray<[string, FrameGradientField]>} */
const FRAME_GRADIENT_PARAMS = [
  ["frameGrad", "frameGradient"],
  ["frameTextGrad", "frameTextGradient"],
];

/**
 * Encode a gradient spec as "type,rotation,#color2" ("" when unset/invalid).
 * @param {unknown} g
 * @returns {string}
 */
function encodeGradient(g) {
  const spec = parseGradient(g);
  if (!spec || spec.rotation < 0 || spec.rotation > 360) return "";
  return `${spec.type},${Math.round(spec.rotation)},${spec.color2}`;
}

/**
 * Parse "type,rotation,#color2"; null when invalid.
 * @param {unknown} raw
 * @returns {GradientSpec | null}
 */
function decodeGradient(raw) {
  if (typeof raw !== "string" || raw.length > MAX_GRADIENT_PARAM_LEN) return null;
  const parts = raw.split(",");
  if (parts.length !== 3) return null;
  const [type, rot, color2] = parts;
  // Number() here (not toFiniteNumber) deliberately preserves the historical
  // accept of an empty rotation as 0; encodeGradient never emits that shape.
  const rotation = Number(rot);
  if (!Number.isFinite(rotation) || rotation < 0 || rotation > 360) return null;
  const spec = parseGradient({ type, rotation, color2 });
  if (!spec) return null;
  return { type: spec.type, rotation: Math.round(rotation), color2: spec.color2 };
}

/**
 * Serialize the current generator state into URL search params.
 * Only includes values that differ from defaults to keep URLs short.
 * @returns {string}
 */
export function encodeStateToUrl() {
  const params = new URLSearchParams();
  const g = state.generator;

  if (g.dataType !== DEFAULT_GENERATOR.dataType && isAllowedValue(ALLOWED_DATA_TYPES, g.dataType))
    params.set("type", g.dataType);
  if (typeof g.dataString === "string" && g.dataString && g.dataString.length <= MAX_SHARE_DATA_LEN)
    params.set("data", g.dataString);
  if (g.ecc !== DEFAULT_GENERATOR.ecc && isAllowedValue(ALLOWED_ECC, g.ecc)) params.set("ecc", g.ecc);
  if (Number.isFinite(g.width) && g.width !== DEFAULT_GENERATOR.width) params.set("w", String(g.width));
  if (Number.isFinite(g.height) && g.height !== DEFAULT_GENERATOR.height) params.set("h", String(g.height));
  if (Number.isFinite(g.margin) && g.margin !== DEFAULT_GENERATOR.margin)
    params.set("margin", String(g.margin));
  if (Number.isFinite(g.qrRadius) && g.qrRadius !== DEFAULT_GENERATOR.qrRadius)
    params.set("radius", String(g.qrRadius));
  if (g.dotsColor !== DEFAULT_GENERATOR.dotsColor && HEX_COLOR_RE.test(g.dotsColor))
    params.set("dots", g.dotsColor);
  if (g.bgColor !== DEFAULT_GENERATOR.bgColor && HEX_COLOR_RE.test(g.bgColor)) params.set("bg", g.bgColor);
  if (g.bgTransparent) params.set("bgT", "1");
  if (
    g.cornersSquareColor !== DEFAULT_GENERATOR.cornersSquareColor &&
    HEX_COLOR_RE.test(g.cornersSquareColor)
  )
    params.set("cs", g.cornersSquareColor);
  if (g.cornersDotColor !== DEFAULT_GENERATOR.cornersDotColor && HEX_COLOR_RE.test(g.cornersDotColor))
    params.set("cd", g.cornersDotColor);
  for (const [key, field] of QR_GRADIENT_PARAMS) {
    const encoded = encodeGradient(g[field]);
    if (encoded) params.set(key, encoded);
  }
  if (g.shapeBody !== DEFAULT_GENERATOR.shapeBody && isAllowedValue(ALLOWED_SHAPES, g.shapeBody))
    params.set("body", g.shapeBody);
  if (g.shapeOuter !== DEFAULT_GENERATOR.shapeOuter && isAllowedValue(ALLOWED_SHAPES, g.shapeOuter))
    params.set("outer", g.shapeOuter);
  if (g.shapeInner !== DEFAULT_GENERATOR.shapeInner && isAllowedValue(ALLOWED_SHAPES, g.shapeInner))
    params.set("inner", g.shapeInner);
  if (g.maskType !== DEFAULT_GENERATOR.maskType && isAllowedValue(ALLOWED_MASKS, g.maskType))
    params.set("mask", g.maskType);
  if (typeof g.maskCustom === "string" && g.maskCustom && g.maskCustom.length <= MAX_MASK_PATH_LEN)
    params.set("maskPath", g.maskCustom);
  if (g.frameStyle !== DEFAULT_GENERATOR.frameStyle && isAllowedValue(ALLOWED_FRAMES, g.frameStyle))
    params.set("frame", g.frameStyle);
  if (g.frameText !== DEFAULT_GENERATOR.frameText)
    params.set("frameText", g.frameText.slice(0, MAX_FRAME_TEXT_LEN));
  if (Number.isFinite(g.frameTextSize) && g.frameTextSize !== DEFAULT_GENERATOR.frameTextSize)
    params.set("frameSize", String(g.frameTextSize));
  // Off always travels (`noText=1`); on travels only when the current style
  // would otherwise default to off (`text=1`). Decode restores the style
  // default when neither param is present.
  if (!g.frameTextEnabled) params.set("noText", "1");
  else if (FRAME_TEXT_DEFAULTS[g.frameStyle] === false) params.set("text", "1");
  if (g.frameFont !== DEFAULT_GENERATOR.frameFont && ALLOWED_FRAME_FONTS.includes(g.frameFont))
    params.set("font", g.frameFont);
  if (g.frameColor && HEX_COLOR_RE.test(g.frameColor)) params.set("frameColor", g.frameColor);
  if (g.frameTextColor && HEX_COLOR_RE.test(g.frameTextColor)) params.set("frameTextColor", g.frameTextColor);
  for (const [key, field] of FRAME_GRADIENT_PARAMS) {
    const encoded = encodeGradient(g[field]);
    if (encoded) params.set(key, encoded);
  }
  if (isSafeImageSource(g.logoDataUrl, { maxLength: SHARE_LOGO_MAX_BYTES, allowHttp: true }))
    params.set("logo", /** @type {string} */ (g.logoDataUrl));
  if (isSafeImageSource(g.bgImageDataUrl, { maxLength: SHARE_LOGO_MAX_BYTES }))
    params.set("bgImage", /** @type {string} */ (g.bgImageDataUrl));
  if (Number.isFinite(g.logoSizeProportion) && g.logoSizeProportion !== DEFAULT_GENERATOR.logoSizeProportion)
    params.set("logoSize", String(g.logoSizeProportion));
  if (Number.isFinite(g.imageMargin) && g.imageMargin !== DEFAULT_GENERATOR.imageMargin)
    params.set("logoMargin", String(g.imageMargin));

  let url;
  try {
    url = new URL(window.location.href);
  } catch {
    url = new URL(window.location.origin);
  }
  // Keep the payload in the fragment: it never reaches the static host's
  // request logs, and the decoder reads the hash before the query anyway.
  url.search = "";
  url.hash = params.toString();
  return url.toString();
}

/**
 * Parse a numeric URL param and clamp it into `bounds`; `fallback` when the
 * param is absent or not a finite number.
 * @param {unknown} raw
 * @param {{ min: number, max: number, integer?: boolean }} bounds
 * @param {number} fallback
 * @returns {number}
 */
function clampParam(raw, bounds, fallback) {
  const n = toFiniteNumber(raw);
  return n === null ? fallback : clampNumber(n, bounds);
}

/**
 * Read a scalar param. Duplicated keys are ignored entirely: first/last-wins
 * ambiguity between parsers is a parameter-pollution vector, and nothing the
 * app itself encodes ever repeats a key.
 * @param {URLSearchParams} params
 * @param {string} key
 * @returns {string | null}
 */
function getSingleParam(params, key) {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : null;
}

/**
 * Keep a single param only when it is in the allow-list.
 * @template {string} T
 * @param {readonly T[]} allowed
 * @param {string | null} value
 * @returns {T | null}
 */
function getEnumParam(allowed, value) {
  return isAllowedValue(allowed, value) ? value : null;
}

/** @type {{ dataString: string, dataType: import("./constants.js").DataType } | null} */
let hydratedPayload = null;

/**
 * Read the share payload from the hash when it looks like one, else from the
 * query string. Null when the location is unreadable.
 * @returns {URLSearchParams | null}
 */
function readUrlParams() {
  try {
    const hash = (window.location.hash || "").replace(/^#/, "");
    if (hash && (hash.includes("=") || hash.includes("type") || hash.includes("data"))) {
      return new URLSearchParams(hash);
    }
    return new URLSearchParams(window.location.search);
  } catch {
    return null;
  }
}

/**
 * A remote logo is fetched by the browser the moment the shared design
 * renders, handing the link's author the recipient's IP and User-Agent. Ask
 * before applying one; when a prompt cannot be shown, deny by default.
 * @param {string} url
 * @returns {boolean}
 */
function confirmRemoteLogo(url) {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return false;
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  try {
    return window.confirm(`This shared link loads a logo from ${host}. Load it?`);
  } catch {
    return false;
  }
}

/**
 * Decode URL search params and apply them to the generator state.
 * Returns true if any params were applied. All values are validated + clamped
 * so a crafted share URL can't push generator into a broken state.
 * @returns {boolean}
 */
export function decodeStateFromUrl() {
  // A decode with no payload must not leave a previous decode's payload armed.
  hydratedPayload = null;
  const params = readUrlParams();
  if (!params || params.toString() === "") return false;
  const searchParams = params;

  try {
    const g = state.generator;
    /** @type {(key: string) => string | null} */
    const get = (key) => getSingleParam(searchParams, key);

    const dataType = get("type");
    if (isAllowedValue(ALLOWED_DATA_TYPES, dataType)) g.dataType = dataType;
    const data = get("data");
    if (data !== null && data.length <= MAX_SHARE_DATA_LEN) g.dataString = data;

    const ecc = get("ecc");
    if (isAllowedValue(ALLOWED_ECC, ecc)) g.ecc = ecc;
    const w = get("w");
    if (w !== null) g.width = clampParam(w, BOUNDS.width, g.width);
    const h = get("h");
    if (h !== null) g.height = clampParam(h, BOUNDS.height, g.height);
    const margin = get("margin");
    if (margin !== null) g.margin = clampParam(margin, BOUNDS.margin, g.margin);
    const radius = get("radius");
    if (radius !== null) g.qrRadius = clampParam(radius, BOUNDS.qrRadius, g.qrRadius);

    /** @type {(key: string) => string | null} */
    const hexGet = (key) => {
      const v = get(key);
      return v !== null && HEX_COLOR_RE.test(v) ? v : null;
    };
    const dots = hexGet("dots");
    if (dots) g.dotsColor = dots;
    const bg = hexGet("bg");
    if (bg) g.bgColor = bg;
    if (get("bgT") === "1") g.bgTransparent = true;
    const cs = hexGet("cs");
    if (cs) g.cornersSquareColor = cs;
    const cd = hexGet("cd");
    if (cd) g.cornersDotColor = cd;

    const body = getEnumParam(ALLOWED_SHAPES, get("body"));
    if (body) g.shapeBody = body;
    const outer = getEnumParam(ALLOWED_SHAPES, get("outer"));
    if (outer) g.shapeOuter = outer;
    const inner = getEnumParam(ALLOWED_SHAPES, get("inner"));
    if (inner) g.shapeInner = inner;
    const mask = get("mask");
    if (isAllowedValue(ALLOWED_MASKS, mask)) g.maskType = mask;
    const maskPath = get("maskPath");
    if (maskPath !== null && maskPath.length <= MAX_MASK_PATH_LEN) {
      g.maskCustom = sanitizeMaskPath(maskPath);
    }

    const frame = get("frame");
    if (isAllowedValue(ALLOWED_FRAMES, frame)) g.frameStyle = frame;
    const frameText = get("frameText");
    if (frameText !== null) g.frameText = truncateSafe(frameText, MAX_FRAME_TEXT_LEN);
    for (const [key, field] of QR_GRADIENT_PARAMS) {
      // A shared link is the whole design: an absent param means "no gradient",
      // so a recipient's own gradients never bleed into a shared solid design.
      g[field] = decodeGradient(get(key)) || null;
    }
    const frameSize = get("frameSize");
    if (frameSize !== null) {
      // Old links carry the string presets; map them before numeric clamping.
      const legacy = LEGACY_FRAME_TEXT_SIZES[frameSize];
      g.frameTextSize =
        typeof legacy === "number" ? legacy : clampParam(frameSize, BOUNDS.frameTextSize, g.frameTextSize);
    }
    // Explicit toggle params win; otherwise a shared frame style restores its
    // own default (open frames without text, bar/plain frames with it).
    if (get("noText") === "1") g.frameTextEnabled = false;
    else if (get("text") === "1") g.frameTextEnabled = true;
    else if (isAllowedValue(ALLOWED_FRAMES, frame))
      g.frameTextEnabled = FRAME_TEXT_DEFAULTS[g.frameStyle] !== false;
    const frameFont = get("font");
    if (isAllowedValue(ALLOWED_FRAME_FONTS, frameFont)) g.frameFont = frameFont;
    const frameColor = get("frameColor");
    if (frameColor && HEX_COLOR_RE.test(frameColor)) g.frameColor = frameColor;
    const frameTextColor = get("frameTextColor");
    if (frameTextColor && HEX_COLOR_RE.test(frameTextColor)) g.frameTextColor = frameTextColor;
    for (const [key, field] of FRAME_GRADIENT_PARAMS) {
      g[field] = decodeGradient(get(key)) || null;
    }

    const logo = get("logo");
    // Bitmap data: URLs are inert and apply directly; a remote http(s) logo is
    // only applied after the recipient explicitly confirms the fetch.
    if (logo !== null && isSafeImageSource(logo, { maxLength: SHARE_LOGO_MAX_BYTES, allowHttp: true })) {
      if (isSafeBitmapDataUrl(logo) || confirmRemoteLogo(logo)) {
        g.logoDataUrl = logo;
        g.logoFilename = "url";
      }
    }
    const logoSize = get("logoSize");
    if (logoSize !== null) {
      g.logoSizeProportion = clampParam(logoSize, BOUNDS.logoSizeProportion, g.logoSizeProportion);
    }
    const logoMargin = get("logoMargin");
    if (logoMargin !== null) {
      g.imageMargin = clampParam(logoMargin, BOUNDS.imageMargin, g.imageMargin);
    }
    const bgImage = get("bgImage");
    if (bgImage !== null && isSafeImageSource(bgImage, { maxLength: SHARE_LOGO_MAX_BYTES })) {
      g.bgImageDataUrl = bgImage;
    }

    populateInputsFromState();
    // A shared link whose corner colors match the background would render as
    // noise on the receiving side; land on visible colors instead.
    repairLowVisibilityColors(state.generator);
    // Later init steps (syncConfigToUI/syncUIFromState) recompile the payload
    // from form fields, which are empty for most types. Remember the decoded
    // payload so applyHydratedPayload() can restore it after those steps.
    hydratedPayload = data !== null ? { dataString: g.dataString, dataType: g.dataType } : null;
    return true;
  } catch {
    return false;
  }
}

/**
 * Restore the payload decoded from a share URL after the init flow has run
 * its recompiles. Safe no-op when no share URL was present.
 * @returns {void}
 */
export function applyHydratedPayload() {
  if (!hydratedPayload) return;
  state.generator.dataString = hydratedPayload.dataString;
  state.generator.isValid = true;
  hydratedPayload = null;
}

/**
 * Resolve a DOM ref to a form control; null when the ref is missing or not a
 * form element (mocked/partially initialized DOMs never throw). Textareas
 * count: the text, SMS-message and email-body fields are textareas.
 * @param {string} id
 * @returns {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null}
 */
function field(id) {
  const el = DOM[id];
  return el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
    ? el
    : null;
}

function populateInputsFromState() {
  const def = DATA_TYPES[state.generator.dataType];
  if (!def) return;
  def.hydrate(state.generator.dataString || "", { field });
}
