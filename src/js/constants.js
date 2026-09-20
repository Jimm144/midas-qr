// @ts-check
export const MAX_SCAN_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_LOGO_BYTES = 4 * 1024 * 1024;
export const SHARE_LOGO_MAX_BYTES = 2048;
export const MAX_GENERATOR_HISTORY = 50;
export const MAX_SCAN_HISTORY = 20;
export const DEBOUNCE_GENERATE_MS = 150;
export const SCAN_COOLDOWN_MS = 1500;
export const DEFAULT_WIDTH = 300;
export const DEFAULT_HEIGHT = 300;
export const DEFAULT_LOGO_SIZE = 0.4;
export const MAX_FRAME_TEXT_LEN = 15;

/** Persistence guards: cap strings so a corrupt blob can't bloat state/localStorage. */
export const MAX_STATE_TEXT_LEN = 4096;
export const MAX_STATE_FIELD_LEN = 4096;
export const MAX_STATE_FILENAME_LEN = 256;
export const MAX_STATE_TIME_LEN = 64;
export const MAX_STATE_FIELDS = 100;
/** Base64 data URL cap for a 4 MB upload (base64 is ~4/3 of the raw bytes). */
export const MAX_STATE_IMAGE_LEN = MAX_LOGO_BYTES * 2;

/** Payload kind for the generator tab. */
/** @typedef {"url"|"text"|"wifi"|"contact"|"crypto"|"geo"|"event"|"sms"|"phone"|"email"} DataType */
/** QR error-correction level. */
/** @typedef {"L"|"M"|"Q"|"H"} EccLevel */
/** Dot / corner shape name understood by the renderer. */
/** @typedef {"square"|"rounded"|"extra-rounded"|"classy-rounded"|"classy"|"dots"|"dot"} ShapeName */
/** Overall shape-mask name. */
/** @typedef {"none"|"circle"|"heart"|"triangle"|"star"|"diamond"|"hexagon"|"shield"|"custom"} MaskName */
/** Frame style name. */
/** @typedef {"none"|"scan"|"dashed"|"rounded"|"label"|"badge"} FrameName */
/** Two-stop gradient interpolation type. */
/** @typedef {"linear"|"radial"} GradientType */

/**
 * Inclusive bounds for one numeric generator field. `integer` rounds to the
 * nearest integer after clamping (the UI only produces whole numbers).
 * @typedef {{ min: number, max: number, integer?: boolean }} NumericBounds
 */

/** Value allow-lists shared by persisted-state sanitizing and share-URL decoding. */
/** @type {readonly DataType[]} */
export const ALLOWED_DATA_TYPES = [
  "url",
  "text",
  "wifi",
  "contact",
  "crypto",
  "geo",
  "event",
  "sms",
  "phone",
  "email",
];
/** @type {readonly EccLevel[]} */
export const ALLOWED_ECC = ["L", "M", "Q", "H"];
/** @type {readonly ShapeName[]} */
export const ALLOWED_SHAPES = [
  "square",
  "rounded",
  "extra-rounded",
  "classy-rounded",
  "classy",
  "dots",
  "dot",
];
/** @type {readonly MaskName[]} */
export const ALLOWED_MASKS = [
  "none",
  "circle",
  "heart",
  "triangle",
  "star",
  "diamond",
  "hexagon",
  "shield",
  "custom",
];
/** @type {readonly FrameName[]} */
export const ALLOWED_FRAMES = ["none", "scan", "dashed", "rounded", "label", "badge"];
/** @type {readonly GradientType[]} */
export const ALLOWED_GRADIENT_TYPES = ["linear", "radial"];

/** Frame label size in percent of the frame's base text size. */
export const FRAME_TEXT_SIZE_BOUNDS = { min: 60, max: 200, integer: true };

/**
 * Pre-number frame-size presets, mapped to percent when a legacy value is
 * loaded from persisted state or decoded from an old share URL.
 * @type {Readonly<Record<string, number>>}
 */
export const LEGACY_FRAME_TEXT_SIZES = { small: 85, medium: 100, large: 125 };

/**
 * Bounds for every numeric generator field, shared by persisted-state
 * sanitizing (state.ts) and share-URL decoding (share.js) so the two
 * validators cannot drift apart.
 * @type {Readonly<Record<string, NumericBounds>>}
 */
export const GENERATOR_NUMERIC_BOUNDS = {
  width: { min: 50, max: 2000, integer: true },
  height: { min: 50, max: 2000, integer: true },
  margin: { min: 0, max: 100, integer: true },
  qrRadius: { min: 0, max: 1000, integer: true },
  imageMargin: { min: 0, max: 100, integer: true },
  logoSizeProportion: { min: 0.1, max: 0.5 },
  frameTextSize: FRAME_TEXT_SIZE_BOUNDS,
};
