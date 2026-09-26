// @ts-check
import { getIntlLocale } from "./i18n.js";

/**
 * Shared utilities — pure functions, no DOM dependency.
 * Extracted so callers don't depend on main.js (avoids circular imports).
 */

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
};

/**
 * @param {string|null|undefined} str
 * @returns {string}
 */
export function escapeHTML(str) {
  return (str || "").replace(/[&<>'"]/g, (t) => HTML_ESCAPE_MAP[t]);
}

/**
 * Escape special characters for WI-FI QR payloads (backslash, semicolon, colon, comma, quote).
 * @param {string|null|undefined} s
 * @returns {string}
 */
export function escapeWifiStr(s) {
  return (s || "").replace(/([\\;:,"])/g, "\\$1");
}

/**
 * Escape special characters for vCard / iCal text values. CRLF and lone CR
 * are normalized to LF first: a raw CR would otherwise terminate the content
 * line and let the rest of the value inject new properties.
 * @param {string|null|undefined} s
 * @returns {string}
 */
export function escapeVCard(s) {
  return (s || "").replace(/\r\n?/g, "\n").replace(/([\\,;\n])/g, (m) => (m === "\n" ? "\\n" : "\\" + m));
}

/**
 * Strip leading protocol if present (used for display comparisons).
 * @param {string|null|undefined} url
 * @returns {string}
 */
export function stripProtocol(url) {
  return (url || "").replace(/^(https?:)?\/\//i, "");
}

/**
 * Sanitize a user-supplied SVG path `d` value. Keeps only path-data tokens
 * (command letters, numbers, signs, decimals, whitespace) so no quotes,
 * angle brackets, or other markup can escape the `d` attribute of an
 * exported SVG file. Empty input yields an empty string.
 * @param {string|null|undefined} path
 * @returns {string}
 */
export function sanitizeMaskPath(path) {
  if (!path) return "";
  return String(path)
    .replace(/[^a-zA-Z0-9.,\s\-+()]/g, "")
    .trim();
}

/**
 * Truncate to at most `max` UTF-16 units without splitting a surrogate pair
 * (a lone surrogate would be encoded as U+FFFD in the QR payload).
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
export function truncateSafe(value, max) {
  const str = typeof value === "string" ? value : String(value ?? "");
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Copy text to the clipboard, preferring the async Clipboard API with a
 * legacy execCommand fallback for restricted contexts (denied permission,
 * insecure contexts, embedded webviews).
 * @param {string} text
 * @returns {Promise<boolean>} true when the copy succeeded.
 */
export async function copyTextToClipboard(text) {
  const value = typeof text === "string" ? text : String(text ?? "");
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (err) {
    console.warn("[QR] Async clipboard copy failed, trying legacy fallback:", err);
  }
  try {
    if (typeof document === "undefined" || !document.body) return false;
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    try {
      ta.select();
      const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
      return !!ok;
    } finally {
      // Always detach the scratch element, even when execCommand throws.
      ta.remove();
    }
  } catch (err) {
    console.warn("[QR] Legacy clipboard copy failed:", err);
    return false;
  }
}

/** Canonical six-digit hex color (`#RRGGBB`). */
export const HEX_COLOR_RE = /^#[0-9A-F]{6}$/i;

/**
 * Allow-list for user-supplied image payloads (logo overlays, shared state).
 * Bitmap data URLs only — anything else (remote URLs, SVG, `javascript:`)
 * is rejected before it reaches the canvas or the renderer.
 * @param {unknown} url
 * @returns {boolean}
 */
export function isSafeBitmapDataUrl(url) {
  return typeof url === "string" && /^data:image\/(png|jpeg|webp|gif|bmp|avif);base64,/i.test(url);
}

/**
 * True for http(s) URLs; the single source of truth for that rule.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

/**
 * Normalize a six-digit hex color (leading `#` optional, no surrounding
 * whitespace) to lowercase without the hash; `null` when invalid. Used for
 * equality checks between colors that may or may not carry the `#`.
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeHexColor(value) {
  if (typeof value !== "string") return null;
  const match = /^#?([0-9A-Fa-f]{6})$/.exec(value);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Allow-list guard: true when `value` is one of `allowed`. The `value is T`
 * predicate narrows string unions for callers that validate enums against the
 * constants.js tables.
 * @template {string} T
 * @param {readonly T[]} allowed
 * @param {unknown} value
 * @returns {value is T}
 */
export function isAllowedValue(allowed, value) {
  return typeof value === "string" && allowed.includes(/** @type {T} */ (value));
}

/**
 * Parse a numeric string parameter: trimmed, finite, else `null`. Non-strings
 * (including numbers) are rejected so callers can't accidentally accept a
 * non-parameter value.
 * @param {unknown} value
 * @returns {number | null}
 */
export function toFiniteNumber(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Clamp a finite number into inclusive bounds; `integer` rounds to the
 * nearest integer after clamping.
 * @param {number} value
 * @param {{ min: number, max: number, integer?: boolean }} bounds
 * @returns {number}
 */
export function clampNumber(value, bounds) {
  const clamped = Math.max(bounds.min, Math.min(bounds.max, value));
  return bounds.integer ? Math.round(clamped) : clamped;
}

/**
 * Allow-list for user-supplied image sources: bitmap data URLs, plus http(s)
 * URLs when `allowHttp`, capped at `maxLength` UTF-16 units.
 * @param {unknown} value
 * @param {{ maxLength: number, allowHttp?: boolean }} options
 * @returns {boolean}
 */
export function isSafeImageSource(value, options) {
  if (typeof value !== "string" || value.length > options.maxLength) return false;
  return isSafeBitmapDataUrl(value) || (options.allowHttp === true && isHttpUrl(value));
}

/**
 * Compact timestamp used by the generator and scan history lists: "14:32 Sep 16".
 * @param {number} ts epoch milliseconds
 * @returns {string}
 */
export function formatHistoryTimestamp(ts, locale = getIntlLocale()) {
  const activeLocale = locale || getIntlLocale();
  let d;
  try {
    d = new Date(ts);
  } catch {
    return "";
  }
  if (!Number.isFinite(d.getTime())) return "";
  try {
    return (
      d.toLocaleTimeString(activeLocale, { hour: "2-digit", minute: "2-digit" }) +
      " " +
      d.toLocaleDateString(activeLocale, { month: "short", day: "numeric" })
    );
  } catch {
    return "";
  }
}

/**
 * Deep copy for JSON-safe state payloads. structuredClone when available; a
 * value it cannot clone (a live DOM node such as a cached SVG) degrades to a
 * JSON copy instead of throwing away the caller's whole operation.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function snapshot(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (err) {
      console.warn("[QR] structuredClone failed; falling back to JSON copy:", err);
    }
  }
  return JSON.parse(JSON.stringify(value));
}
