/**
 * Global application state for Midas QR.
 * Single source of truth for persistence: serializeAppState() / loadState().
 */
import { announce } from "./ui/announce.js";
import { t } from "./i18n.js";
import { refreshCustomSelect } from "./ui/components.js";
import { syncDateTimeField } from "./ui/datetime-picker.js";
import { FRAME_FONTS } from "./frames";
import { parseGradient } from "./generator/gradient.js";
import {
  ALLOWED_DATA_TYPES,
  ALLOWED_ECC,
  ALLOWED_FRAMES,
  ALLOWED_MASKS,
  ALLOWED_SHAPES,
  GENERATOR_NUMERIC_BOUNDS,
  LEGACY_FRAME_TEXT_SIZES,
  MAX_FRAME_TEXT_LEN,
  MAX_GENERATOR_HISTORY,
  MAX_SCAN_HISTORY,
  MAX_STATE_FIELD_LEN,
  MAX_STATE_FIELDS,
  MAX_STATE_FILENAME_LEN,
  MAX_STATE_IMAGE_LEN,
  MAX_STATE_TEXT_LEN,
  MAX_STATE_TIME_LEN,
} from "./constants.js";
import type { DataType, EccLevel, FrameName, GradientType, MaskName, ShapeName } from "./constants.js";
import {
  HEX_COLOR_RE,
  clampNumber,
  isAllowedValue,
  isSafeImageSource,
  normalizeHexColor,
  sanitizeMaskPath,
  truncateSafe,
} from "./utils.js";
import { contrastRatio } from "./utils.js";

/** JSON-safe value captured from one DOM input. */
export type GeneratorFieldValue = string | number | boolean;
/** Snapshot of DOM input values keyed by element id. */
export type GeneratorFieldBag = Record<string, GeneratorFieldValue>;

/** State for the QR code generator tab. */
export interface QRGeneratorState {
  dataType: DataType;
  dataString: string;
  isValid: boolean;
  fgColor: string;
  bgColor: string;
  bgTransparent: boolean;
  dotsColor: string;
  cornersSquareColor: string;
  cornersDotColor: string;
  bgGradient: GradientSpec | null;
  dotsGradient: GradientSpec | null;
  cornersSquareGradient: GradientSpec | null;
  cornersDotGradient: GradientSpec | null;
  width: number;
  height: number;
  margin: number;
  imageMargin: number;
  hideBackgroundDots: boolean;
  qrRadius: number;
  shapeBody: ShapeName;
  shapeOuter: ShapeName;
  shapeInner: ShapeName;
  maskType: MaskName;
  maskCustom: string;
  ecc: EccLevel;
  logoDataUrl: string | null;
  logoFilename: string | null;
  bgImageDataUrl: string | null;
  logoSizeProportion: number;
  frameStyle: FrameName;
  frameText: string;
  /** Whether the frame renders its text band at all. */
  frameTextEnabled: boolean;
  /** Frame label size in percent (60-200) of the frame's base text size. */
  frameTextSize: number;
  frameFont: string;
  /** Frame stroke / label-bar color; empty string follows the dots color. */
  frameColor: string;
  /** Frame label color; empty string follows the frame color (or bg for bars). */
  frameTextColor: string;
  frameGradient: GradientSpec | null;
  frameTextGradient: GradientSpec | null;
  fields?: GeneratorFieldBag;
}

/**
 * A previously generated QR config saved to history. After a persistence
 * round-trip the config is whatever `sanitizeGeneratorConfig` kept, so only a
 * partial shape is guaranteed.
 */
export interface GeneratorHistoryItem {
  id: number;
  config: Partial<QRGeneratorState>;
  time: string;
}

/** State for the QR code scanner tab. */
export interface QRScannerState {
  mode: "upload" | "webcam";
  stream: MediaStream | null;
  animationFrameId: number | null;
  cameras: MediaDeviceInfo[];
  selectedCameraId: string;
  history: Array<{ id: number; content: string; time: string }>;
}

/** Top-level application state. */
export interface AppState {
  activeTab: "generator" | "scanner" | "history";
  generatorHistory: GeneratorHistoryItem[];
  generator: QRGeneratorState;
  scanner: QRScannerState;
}

export const APP_SCHEMA_VERSION = 1;
export const STATE_KEY = "qr_state_v1";
// P10: the live logo (up to 4MB base64) is persisted under its own key so the
// main state blob stays small and is not re-serialized on every flush.
export const LOGO_STATE_KEY = "qr_logo_v1";

export const DEFAULT_GENERATOR = {
  dataType: "url",
  dataString: "https://example.com",
  isValid: true,
  fgColor: "#000000",
  bgColor: "#ffffff",
  bgTransparent: false,
  dotsColor: "#000000",
  cornersSquareColor: "#000000",
  cornersDotColor: "#000000",
  bgGradient: null,
  dotsGradient: null,
  cornersSquareGradient: null,
  cornersDotGradient: null,
  width: 300,
  height: 300,
  margin: 4,
  imageMargin: 0,
  hideBackgroundDots: false,
  qrRadius: 0,
  shapeBody: "square",
  shapeOuter: "square",
  shapeInner: "square",
  maskType: "none",
  maskCustom: "",
  ecc: "H",
  logoDataUrl: null,
  logoFilename: null,
  bgImageDataUrl: null,
  logoSizeProportion: 0.4,
  frameStyle: "none",
  frameText: "Scan me!",
  frameTextEnabled: true,
  frameTextSize: 115,
  frameFont: "theme",
  frameColor: "",
  frameTextColor: "",
  frameGradient: null,
  frameTextGradient: null,
} as const;

export const state: AppState = {
  activeTab: "generator",
  generatorHistory: [],
  generator: {
    dataType: "url",
    dataString: "https://example.com",
    isValid: true,
    fgColor: "#000000",
    bgColor: "#ffffff",
    bgTransparent: false,
    dotsColor: "#000000",
    cornersSquareColor: "#000000",
    cornersDotColor: "#000000",
    bgGradient: null,
    dotsGradient: null,
    cornersSquareGradient: null,
    cornersDotGradient: null,
    width: 300,
    height: 300,
    margin: 4,
    imageMargin: 0,
    hideBackgroundDots: false,
    qrRadius: 0,
    shapeBody: "square",
    shapeOuter: "square",
    shapeInner: "square",
    maskType: "none",
    maskCustom: "",
    ecc: "H",
    logoDataUrl: null,
    logoFilename: null,
    bgImageDataUrl: null,
    logoSizeProportion: 0.4,
    frameStyle: "none",
    frameText: "Scan me!",
    frameTextEnabled: true,
    frameTextSize: 115,
    frameFont: "theme",
    frameColor: "",
    frameTextColor: "",
    frameGradient: null,
    frameTextGradient: null,
  },
  scanner: {
    mode: "upload",
    stream: null,
    animationFrameId: null,
    cameras: [],
    selectedCameraId: "",
    history: [],
  },
};

/** Two-stop color gradient for one color target (stop 0 is the solid color). */
export interface GradientSpec {
  type: GradientType;
  /** Degrees, 0-360 (linear only; radial ignores it). */
  rotation: number;
  color2: string;
}
const inputIds: string[] = [
  "input-text",
  "input-url",
  "wifi-ssid",
  "wifi-pass",
  "wifi-enc",
  "wifi-hidden",
  "contact-first",
  "contact-last",
  "contact-org",
  "contact-title",
  "contact-phone",
  "contact-work",
  "contact-fax",
  "contact-email",
  "contact-url",
  "contact-street",
  "contact-city",
  "contact-state",
  "contact-zip",
  "contact-country",
  "crypto-coin",
  "crypto-address",
  "crypto-amount",
  "geo-lat",
  "geo-lon",
  "event-title",
  "event-start",
  "event-end",
  "event-location",
  "event-desc",
  "sms-phone",
  "sms-msg",
  "phone-number",
  "email-to",
  "email-subject",
  "email-body",
  "logo-url",
];

/** Strip non-serializable / cache fields from the generator state. */
export function serializableGenerator(g: QRGeneratorState): QRGeneratorState {
  return { ...g };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STRING_FIELDS = [
  "dataType",
  "dataString",
  "fgColor",
  "bgColor",
  "dotsColor",
  "cornersSquareColor",
  "cornersDotColor",
  "shapeBody",
  "shapeOuter",
  "shapeInner",
  "maskType",
  "maskCustom",
  "ecc",
  "frameStyle",
  "frameText",
  "frameFont",
  "frameColor",
  "frameTextColor",
] as const;

const BOOLEAN_FIELDS = ["isValid", "bgTransparent", "hideBackgroundDots", "frameTextEnabled"] as const;

const GRADIENT_FIELDS = [
  "bgGradient",
  "dotsGradient",
  "cornersSquareGradient",
  "cornersDotGradient",
  "frameGradient",
  "frameTextGradient",
] as const;

/** Fixed palette fields: only canonical six-digit hex survives. */
const COLOR_FIELDS: ReadonlySet<string> = new Set([
  "fgColor",
  "bgColor",
  "dotsColor",
  "cornersSquareColor",
  "cornersDotColor",
]);

/** Frame colors may legitimately be empty ("follow the dots color"). */
const OPTIONAL_COLOR_FIELDS: ReadonlySet<string> = new Set(["frameColor", "frameTextColor"]);

/** Enum fields: an unknown value is dropped so the caller keeps its default. */
const ENUM_FIELDS: Record<string, readonly string[]> = {
  dataType: ALLOWED_DATA_TYPES,
  ecc: ALLOWED_ECC,
  shapeBody: ALLOWED_SHAPES,
  shapeOuter: ALLOWED_SHAPES,
  shapeInner: ALLOWED_SHAPES,
  maskType: ALLOWED_MASKS,
  frameStyle: ALLOWED_FRAMES,
  frameFont: FRAME_FONTS.map((f) => f.value),
};

/** Per-field length policy; unlisted strings fall back to a generic cap. */
const STRING_LIMITS: Record<string, { max: number; mode: "drop" | "slice" }> = {
  dataString: { max: MAX_STATE_TEXT_LEN, mode: "drop" },
  maskCustom: { max: MAX_STATE_TEXT_LEN, mode: "drop" },
  frameText: { max: MAX_FRAME_TEXT_LEN, mode: "slice" },
  logoFilename: { max: MAX_STATE_FILENAME_LEN, mode: "slice" },
};

/** Keep only primitive, bounded field values so a corrupt blob can't bloat state. */
function sanitizeGeneratorFields(raw: unknown): GeneratorFieldBag | null {
  if (!isPlainObject(raw)) return null;
  const out: GeneratorFieldBag = {};
  const keys = Object.keys(raw);
  for (let i = 0; i < keys.length && Object.keys(out).length < MAX_STATE_FIELDS; i++) {
    const id = keys[i];
    if (id.length > 128) continue;
    const value = raw[id];
    if (typeof value === "string")
      out[id] = value.length <= MAX_STATE_FIELD_LEN ? value : truncateSafe(value, MAX_STATE_FIELD_LEN);
    else if (typeof value === "number" && Number.isFinite(value)) out[id] = value;
    else if (typeof value === "boolean") out[id] = value;
  }
  return out;
}

/**
 * Saved and shared configs can carry corner/body colors that exactly match an
 * opaque background — the corner squares then vanish and the code renders as
 * noise. Repair any such color to the foreground (or to whichever of
 * black/white contrasts best when the foreground matches the background too).
 * Returns true when anything changed. Idempotent: a second call is a no-op.
 */
export function repairLowVisibilityColors(generator: QRGeneratorState): boolean {
  if (generator.bgTransparent) return false;
  const bgKey = normalizeHexColor(generator.bgColor);
  if (bgKey === null) return false;
  const matchesBg = (value: unknown): boolean => normalizeHexColor(value) === bgKey;
  if (
    !matchesBg(generator.dotsColor) &&
    !matchesBg(generator.cornersSquareColor) &&
    !matchesBg(generator.cornersDotColor)
  ) {
    return false;
  }
  const black = contrastRatio("#000000", generator.bgColor) ?? 21;
  const white = contrastRatio("#ffffff", generator.bgColor) ?? 1;
  if (matchesBg(generator.dotsColor)) generator.dotsColor = black >= white ? "#000000" : "#ffffff";
  if (matchesBg(generator.cornersSquareColor)) generator.cornersSquareColor = generator.dotsColor;
  if (matchesBg(generator.cornersDotColor)) generator.cornersDotColor = generator.dotsColor;
  return true;
}

const OLD_STOCK_PALETTE = {
  bgColor: "#ffffff",
  dotsColor: "#000000",
  cornersSquareColor: "#000000",
  cornersDotColor: "#000000",
} as const;

/**
 * One-time polarity migration: the stock palette is inverted (white code on a
 * black card), so a stored config still on the exact old stock palette is
 * flipped to it instead of keeping the old polarity. Custom palettes are left
 * alone, as are transparent backgrounds.
 */
export function migrateInvertedStockPalette(generator: QRGeneratorState): boolean {
  if (generator.bgTransparent) return false;
  const same = (value: unknown, expected: string): boolean =>
    typeof value === "string" && value.toLowerCase() === expected;
  if (
    !same(generator.bgColor, OLD_STOCK_PALETTE.bgColor) ||
    !same(generator.dotsColor, OLD_STOCK_PALETTE.dotsColor) ||
    !same(generator.cornersSquareColor, OLD_STOCK_PALETTE.cornersSquareColor) ||
    !same(generator.cornersDotColor, OLD_STOCK_PALETTE.cornersDotColor)
  ) {
    return false;
  }
  generator.bgColor = "#000000";
  generator.dotsColor = "#ffffff";
  generator.cornersSquareColor = "#ffffff";
  generator.cornersDotColor = "#ffffff";
  return true;
}

/**
 * Validate a persisted/history config against the known generator fields.
 * Unknown keys are dropped, wrong-typed values are ignored (the caller keeps
 * its current value), numbers are clamped to the UI's ranges, strings are
 * length-capped, and images/enums/colors must be in their allow-lists. Never
 * throws, whatever the blob.
 */
export function sanitizeGeneratorConfig(raw: unknown): Partial<QRGeneratorState> {
  if (!isPlainObject(raw)) return {};
  const out: Record<string, unknown> = {};
  try {
    return sanitizeGeneratorConfigInner(raw, out);
  } catch {
    // Hostile accessor objects can throw mid-read; the caller still gets the
    // fields that were validated before the failure (usually none).
    return out as Partial<QRGeneratorState>;
  }
}

function sanitizeGeneratorConfigInner(
  raw: Record<string, unknown>,
  out: Record<string, unknown>
): Partial<QRGeneratorState> {
  for (const key of STRING_FIELDS) {
    const value = raw[key];
    if (typeof value !== "string") continue;
    const allowed = ENUM_FIELDS[key];
    if (allowed && !isAllowedValue(allowed, value)) continue;
    if (COLOR_FIELDS.has(key) && !HEX_COLOR_RE.test(value)) continue;
    if (OPTIONAL_COLOR_FIELDS.has(key) && value !== "" && !HEX_COLOR_RE.test(value)) continue;
    const limit = STRING_LIMITS[key] ?? { max: MAX_STATE_FIELD_LEN, mode: "drop" as const };
    if (value.length > limit.max) {
      if (limit.mode === "drop") continue;
      out[key] = truncateSafe(value, limit.max);
    } else {
      out[key] = value;
    }
  }
  if (typeof out.maskCustom === "string") out.maskCustom = sanitizeMaskPath(out.maskCustom);

  for (const key of BOOLEAN_FIELDS) {
    const value = raw[key];
    if (typeof value === "boolean") out[key] = value;
  }
  // Legacy string frame-size presets ("small"/"medium"/"large") migrate to
  // their percent equivalent; numeric values are clamped by the bounds loop.
  const rawFrameTextSize = raw.frameTextSize;
  if (typeof rawFrameTextSize === "string") {
    const migrated = LEGACY_FRAME_TEXT_SIZES[rawFrameTextSize];
    if (typeof migrated === "number") out.frameTextSize = migrated;
  }
  for (const [key, bounds] of Object.entries(GENERATOR_NUMERIC_BOUNDS)) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = clampNumber(value, bounds);
    }
  }
  for (const key of ["logoDataUrl", "bgImageDataUrl"] as const) {
    const value = raw[key];
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (!isSafeImageSource(value, { maxLength: MAX_STATE_IMAGE_LEN, allowHttp: true })) continue;
    out[key] = value;
  }
  const logoFilename = raw.logoFilename;
  if (logoFilename === null) out.logoFilename = null;
  else if (typeof logoFilename === "string")
    out.logoFilename = truncateSafe(logoFilename, MAX_STATE_FILENAME_LEN);
  for (const key of GRADIENT_FIELDS) {
    const value = raw[key];
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (!isPlainObject(value)) continue;
    const rotation = value.rotation;
    if (typeof rotation !== "number" || !Number.isFinite(rotation)) continue;
    const spec = parseGradient(value);
    if (spec) {
      out[key] = {
        type: spec.type as GradientSpec["type"],
        rotation: clampNumber(rotation, { min: 0, max: 360, integer: true }),
        color2: spec.color2,
      };
    }
  }
  const fields = sanitizeGeneratorFields(raw.fields);
  if (fields) out.fields = fields;
  return out as Partial<QRGeneratorState>;
}

/**
 * Schema version of a parsed persisted blob. `null` means unsupported: either
 * newer than this build, or a corrupt/negative/non-integer tag. Blobs without
 * a `v` key are pre-versioned legacy state (version 0).
 */
export function persistedSchemaVersion(raw: unknown): number | null {
  if (!isPlainObject(raw)) return null;
  try {
    const value = raw.v;
    if (value === undefined) return 0;
    let version: number;
    if (typeof value === "number") version = value;
    else if (typeof value === "string" && value.trim() !== "") version = Number(value);
    else return null;
    if (!Number.isInteger(version) || version < 0 || version > APP_SCHEMA_VERSION) return null;
    return version;
  } catch {
    return null;
  }
}

/**
 * Turn a parsed persisted blob into the current schema shape. Unknown
 * top-level keys are ignored. Never throws; unsupported versions yield {}.
 */
export function migratePersistedState(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw) || persistedSchemaVersion(raw) === null) return {};
  // Schema 1 is the first versioned shape; older blobs (v0 / no tag) already
  // match it and need no field moves. Future versions chain their migrations
  // here, one step per version, so a partial upgrade can never reach the app.
  return raw;
}

/** Keep a persisted entry id when it is a finite number, else mint a stable one. */
function historyId(raw: unknown, fallbackIndex: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : Date.now() + fallbackIndex;
}

/** Validate and cap persisted generator history: unknown entries are dropped. */
export function sanitizeGeneratorHistory(raw: unknown): GeneratorHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: GeneratorHistoryItem[] = [];
  const items = raw.slice(0, MAX_GENERATOR_HISTORY);
  for (const entry of items) {
    try {
      if (!isPlainObject(entry) || !isPlainObject(entry.config)) continue;
      const time = typeof entry.time === "string" ? truncateSafe(entry.time, MAX_STATE_TIME_LEN) : "";
      out.push({
        id: historyId(entry.id, out.length),
        config: sanitizeGeneratorConfig(entry.config),
        time,
      });
    } catch {
      // A hostile accessor entry must not abort the rest of the history.
      continue;
    }
  }
  return out;
}

/** Validate and cap the persisted scanner history: unknown entries are dropped. */
export function sanitizeScannerHistory(raw: unknown): QRScannerState["history"] {
  if (!Array.isArray(raw)) return [];
  const out: QRScannerState["history"] = [];
  const items = raw.slice(0, MAX_SCAN_HISTORY);
  for (const entry of items) {
    try {
      if (!isPlainObject(entry) || typeof entry.content !== "string") continue;
      const id = historyId(entry.id, out.length);
      const content =
        entry.content.length <= MAX_STATE_TEXT_LEN
          ? entry.content
          : truncateSafe(entry.content, MAX_STATE_TEXT_LEN);
      const time = typeof entry.time === "string" ? truncateSafe(entry.time, MAX_STATE_TIME_LEN) : "";
      out.push({ id, content, time });
    } catch {
      // A hostile accessor entry must not abort the rest of the history.
      continue;
    }
  }
  return out;
}

/** True when a persisted image payload is a bitmap data URL or an http(s) URL. */
function isPersistableImage(value: string): boolean {
  return isSafeImageSource(value, { maxLength: MAX_STATE_IMAGE_LEN, allowHttp: true });
}

/** Write one captured field value onto its form control (no events). */
function applyFieldValue(el: HTMLElement, value: unknown): void {
  if ((el as HTMLInputElement).type === "checkbox") (el as HTMLInputElement).checked = !!value;
  else (el as HTMLInputElement | HTMLSelectElement).value = String(value);
  // Date/time inputs hide behind a trigger button whose label is only
  // refreshed by input/change events; sync it after programmatic writes.
  if (el instanceof HTMLInputElement) syncDateTimeField(el);
}

/**
 * Apply persisted field values back into the DOM inputs (values only, no
 * events). Used at boot and by history load; unknown ids are ignored.
 * Selects also refresh their custom-select trigger + option highlight.
 */
export function applyGeneratorFields(fields: GeneratorFieldBag | null | undefined): void {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return;
  Object.entries(fields).forEach(([id, value]) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) return;
    applyFieldValue(el, value);
    if (el.tagName === "SELECT") refreshCustomSelect(el as HTMLSelectElement);
  });
}

/**
 * Capture current DOM input field values into state.generator.fields.
 */
export function captureGeneratorFields(): GeneratorFieldBag {
  const fields: GeneratorFieldBag = {};
  inputIds.forEach((id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    fields[id] = el.type === "checkbox" ? el.checked : el.value;
  });
  state.generator.fields = fields;
  return fields;
}

/**
 * The single serializer for the whole app state. Always writes a schema version tag.
 * `includeFields` controls whether input-field values are captured (used by the
 * beforeunload / visibilitychange flush, not by history writes). `omitImages`
 * drops the background image from the blob (quota fallback; the logo never
 * travels in the blob at all).
 */
function serializeAppState(includeFields: boolean, omitImages = false): string {
  // History writes deliberately exclude the input-field snapshot; do not let
  // that serialization detail wipe the live in-memory snapshot (a crash before
  // the next capture would otherwise lose what the user typed).
  const previousFields = state.generator.fields;
  state.generator.fields = {};
  try {
    if (includeFields) {
      captureGeneratorFields();
    }
    const { logoDataUrl: _logo, ...generatorRest } = serializableGenerator(state.generator);
    void _logo;
    return JSON.stringify({
      v: APP_SCHEMA_VERSION,
      generatorHistory: state.generatorHistory,
      scanner: { history: state.scanner.history },
      generator: omitImages ? { ...generatorRest, bgImageDataUrl: null } : generatorRest,
    });
  } finally {
    if (!includeFields) state.generator.fields = previousFields;
  }
}

function isStorageQuotaError(e: unknown): boolean {
  // Some engines throw a plain Error (or a cross-realm DOMException) with a
  // quota `name`; match on the name rather than the DOMException instance.
  const name = e && typeof e === "object" ? (e as { name?: unknown }).name : undefined;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

let lastPersistedString: string | null = null;
let lastPersistedIncludeFields: boolean | null = null;
let lastPersistedLogo: string | null = null;
let quotaImageEvictionNotified = false;

function notifyQuotaImageEviction(): void {
  if (quotaImageEvictionNotified) return;
  quotaImageEvictionNotified = true;
  console.warn("[state] Storage full; background image kept in memory but not persisted.");
  announce(t("storage.backgroundFull"));
}

/** Write serialized state to localStorage; returns false on quota failure. */
export function persistAppState(includeFields = false): boolean {
  // P10: persist the logo once per distinct value under its own key. The main
  // state blob therefore never carries the (often multi-MB) data URL, so the
  // per-flush serialization stays cheap.
  const logo = state.generator.logoDataUrl;
  if (logo !== lastPersistedLogo) {
    try {
      if (logo) localStorage.setItem(LOGO_STATE_KEY, logo);
      else localStorage.removeItem(LOGO_STATE_KEY);
      lastPersistedLogo = logo;
    } catch (e) {
      console.warn("[state] logo persistence failed; logo will not survive reload.", e);
    }
  }

  let serialized: string;
  try {
    serialized = serializeAppState(includeFields);
  } catch (e) {
    console.warn("[state] Failed to serialize state; not persisting.", e);
    return false;
  }
  // P9: closing a tab fires visibilitychange(hidden) then beforeunload, both
  // flushing identical state. Skip the redundant write when nothing changed.
  if (document.hidden && lastPersistedString === serialized && lastPersistedIncludeFields === includeFields) {
    return true;
  }
  try {
    localStorage.setItem(STATE_KEY, serialized);
    lastPersistedString = serialized;
    lastPersistedIncludeFields = includeFields;
    return true;
  } catch (e) {
    if (!isStorageQuotaError(e)) {
      console.error("[state] persist failed:", e);
      return false;
    }
    // Quota fallback: retry once without the (often multi-MB) background
    // image. It stays in memory; only persistence loses it.
    if (!state.generator.bgImageDataUrl) {
      console.warn("[state] localStorage quota exceeded; not persisting this update.", e);
      return false;
    }
    try {
      const reduced = serializeAppState(includeFields, true);
      localStorage.setItem(STATE_KEY, reduced);
      lastPersistedString = reduced;
      lastPersistedIncludeFields = includeFields;
      notifyQuotaImageEviction();
      return true;
    } catch (retryError) {
      console.warn("[state] localStorage quota exceeded even without images; not persisting.", retryError);
      return false;
    }
  }
}

/** Backwards-compatible scanner history persistence (now routes through the unified serializer). */
export function persistScannerHistory(): boolean {
  return persistAppState(false);
}

export function loadState(): void {
  try {
    // Migrate legacy key: if the new key isn't present but the old one is, read old.
    let raw = localStorage.getItem(STATE_KEY);
    const legacyRaw = localStorage.getItem("qr_state");
    if (!raw && legacyRaw) {
      raw = legacyRaw;
      console.info("[state] migrating legacy `qr_state` to `qr_state_v1`.");
      localStorage.removeItem("qr_state");
    }
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      console.warn("[state] Ignoring stored state with an unexpected shape.");
      return;
    }
    const schemaVersion = persistedSchemaVersion(parsed);
    if (schemaVersion === null) {
      console.warn("[state] Ignoring stored state from an unsupported schema version:", parsed.v);
      return;
    }
    const persisted = migratePersistedState(parsed);
    if (Array.isArray(persisted.generatorHistory)) {
      state.generatorHistory = sanitizeGeneratorHistory(persisted.generatorHistory);
    }
    const persistedScanner = persisted.scanner;
    if (isPlainObject(persistedScanner) && Array.isArray(persistedScanner.history)) {
      state.scanner.history = sanitizeScannerHistory(persistedScanner.history);
    }
    if (isPlainObject(persisted.generator)) {
      const { logoDataUrl: legacyLogo, fields: persistedFields, ...rest } = persisted.generator;
      Object.assign(state.generator, sanitizeGeneratorConfig(rest));
      // The inverted stock palette only exists in pre-versioned legacy blobs;
      // flipping a current-schema white-bg design would invert it on every
      // load. Then repair any corner colors matching the background so the
      // preview is never invisible.
      if (schemaVersion === 0) migrateInvertedStockPalette(state.generator);
      repairLowVisibilityColors(state.generator);
      const legacyLogoDataUrl =
        typeof legacyLogo === "string" && isPersistableImage(legacyLogo) ? legacyLogo : null;

      // P10: the live logo now lives under its own key. Prefer it over any
      // in-blob value (legacy) so current-storage wins.
      let storedLogo: string | null = null;
      try {
        storedLogo = localStorage.getItem(LOGO_STATE_KEY);
      } catch (e) {
        console.warn("[state] Failed to read stored logo:", e);
      }
      if (storedLogo && isPersistableImage(storedLogo)) {
        state.generator.logoDataUrl = storedLogo;
        lastPersistedLogo = storedLogo;
      } else {
        if (storedLogo) {
          // Corrupt/unsafe logo under its own key: drop it and force the next
          // flush to rewrite, otherwise the key would linger forever and the
          // valid legacy/in-memory logo would never be persisted.
          try {
            localStorage.removeItem(LOGO_STATE_KEY);
          } catch (e) {
            console.warn("[state] Failed to remove invalid stored logo:", e);
          }
        }
        state.generator.logoDataUrl = legacyLogoDataUrl ?? null;
        lastPersistedLogo = null;
      }

      const savedFields = sanitizeGeneratorFields(persistedFields);
      if (savedFields) {
        Object.entries(savedFields).forEach(([id, value]) => {
          const el = document.getElementById(id) as HTMLInputElement | null;
          if (!el) return;
          applyFieldValue(el, value);
        });
        // Keep the in-memory snapshot aligned with what was restored.
        state.generator.fields = savedFields;
      }
    }
  } catch (e) {
    console.warn("[state] Failed to load state:", e);
  }
}

let plaintextStorageWarned = false;

export function setupStatePersistence(): void {
  if (!plaintextStorageWarned) {
    plaintextStorageWarned = true;
    console.warn(
      "[QR] QR data (incl. Wi-Fi passwords and crypto addresses) is stored in localStorage in plaintext. Do not use on shared devices."
    );
  }
  const saveState = (): void => {
    // Keep the persisted field snapshot fresh so a refresh restores what the
    // user actually typed (structured forms don't recompile from dataString).
    captureGeneratorFields();
    if (!persistAppState(true)) {
      // Quota is genuinely full: evict the separately-stored logo (any size,
      // since it lives outside the reduced blob) and retry once so the rest
      // of the state still survives. The logo stays in memory for this session.
      const logo = state.generator.logoDataUrl;
      if (logo) {
        try {
          localStorage.removeItem(LOGO_STATE_KEY);
        } catch (e) {
          console.warn("[state] Failed to remove stored logo:", e);
        }
        persistAppState(true);
        console.warn("[state] Storage full; logo kept in memory but not persisted.");
        announce(t("storage.logoFull"));
      }
    }
  };
  window.addEventListener("beforeunload", saveState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveState();
  });
}
