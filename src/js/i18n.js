// @ts-check
import en from "./locales/en.js";
import es from "./locales/es.js";
import fr from "./locales/fr.js";
import de from "./locales/de.js";
import lt from "./locales/lt.js";
import ja from "./locales/ja.js";

const CATALOGS = { en, es, fr, de, lt, ja };
const STORAGE_KEY = "qr-language";
const DEFAULT_LOCALE = "en";
let currentLocale = DEFAULT_LOCALE;

export const SUPPORTED_LOCALES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "lt", label: "Lietuvių" },
  { code: "ja", label: "日本語" },
];

function isSupportedLocale(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CATALOGS, value);
}

function storedLocale() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isSupportedLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function browserLocale() {
  const languages = typeof navigator !== "undefined" && navigator.languages ? navigator.languages : [];
  const candidates = [
    ...languages,
    typeof navigator !== "undefined" ? navigator.language : "",
    DEFAULT_LOCALE,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const lower = candidate.toLowerCase();
    if (isSupportedLocale(lower)) return lower;
    const base = lower.split("-")[0];
    if (isSupportedLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export function getLocale() {
  return currentLocale;
}

export function getIntlLocale() {
  // Timestamps, date pickers and plural rules all format in the active UI
  // locale. Falling back to navigator.language here (e.g. German formats
  // while the UI is English) left the history lists disagreeing after a
  // language switch, so the active locale is the single source.
  return currentLocale;
}

export function resolveInitialLocale() {
  currentLocale = storedLocale() || browserLocale();
  return currentLocale;
}

/** True when either the active catalog or the English fallback defines `key`. */
function hasKey(key) {
  return (
    (CATALOGS[currentLocale] && CATALOGS[currentLocale][key] !== undefined) ||
    CATALOGS[DEFAULT_LOCALE][key] !== undefined
  );
}

export function t(key, params = {}) {
  const catalog = CATALOGS[currentLocale] || CATALOGS[DEFAULT_LOCALE];
  const fallback = CATALOGS[DEFAULT_LOCALE];
  let value = catalog[key];
  if (value === undefined) value = fallback[key];
  if (value === undefined) {
    // A raw key on screen is a bug signal, not a translation: log it so the
    // missing-key audit (and the parity test) can find it, then return the key
    // as before so the UI stays debuggable.
    console.warn(
      `[i18n] missing key "${key}" for locale "${currentLocale}" (no "${DEFAULT_LOCALE}" fallback)`
    );
    return key;
  }
  return value.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

export function tp(baseKey, count, params = {}) {
  if (typeof baseKey !== "string" || baseKey === "") {
    console.warn("[i18n] tp() called with an empty base key");
    return "";
  }
  const n = typeof count === "number" && Number.isFinite(count) ? count : 0;
  let category;
  try {
    // Full CLDR set per locale: lt resolves one/few/many/other, so asking
    // only for one/other dropped the few/many forms Lithuanian needs.
    category = new Intl.PluralRules(currentLocale).select(n);
  } catch {
    category = n === 1 ? "one" : "other";
  }
  // Resolution order: the rule's category, then the locale-neutral
  // singular/plural pair, then the bare base key. The first key the catalogs
  // define wins; a computed "base_category" string must never leak to the UI.
  const candidates = [`${baseKey}_${category}`, `${baseKey}_other`, `${baseKey}_one`, baseKey];
  for (const key of candidates) {
    if (hasKey(key)) return t(key, { count: n, ...params });
  }
  console.warn(`[i18n] missing plural table for "${baseKey}" (count ${n}, category ${category})`);
  return String(n);
}

/**
 * Render a translation into HTML safely. Catalog strings are trusted markup;
 * interpolated params are NOT — they are escaped first so a value like
 * "<img onerror=…>" can never break out. Tags outside the allow-list are
 * stripped (attributes too, except http(s) hrefs on <a>), so even a hostile
 * catalog edit degrades to plain text instead of script.
 */
const I18N_HTML_ALLOWLIST = new Set(["a", "b", "strong", "em", "i", "span", "br", "code"]);

export function tHtml(key, params = {}) {
  const escaped = {};
  for (const name of Object.keys(params)) escaped[name] = escapeHtml(String(params[name]));
  const raw = t(key, escaped);
  return sanitizeI18nHtml(raw);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function sanitizeI18nHtml(html) {
  return String(html).replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (tag, name) => {
    const lower = name.toLowerCase();
    if (!I18N_HTML_ALLOWLIST.has(lower)) return "";
    if (lower === "br") return "<br>";
    if (lower === "a") {
      const href = (tag.match(/\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i) || [])[1] || "";
      const url = href.replace(/^["']|["']$/g, "");
      if (/^https?:\/\//i.test(url)) return `<a href="${escapeHtml(url)}">`;
      return "<a>";
    }
    return tag.startsWith("</") ? `</${lower}>` : `<${lower}>`;
  });
}

function setAttributeTranslation(element, attribute, key) {
  const value = element.getAttribute(`data-i18n-${attribute}`);
  if (value || key) element.setAttribute(attribute, t(value || key));
}

export function applyStaticTranslations(root = document) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    if (key) node.textContent = t(key);
  });
  root.querySelectorAll("[data-i18n-html]").forEach((node) => {
    const key = node.getAttribute("data-i18n-html");
    if (key) node.innerHTML = tHtml(key);
  });
  ["aria-label", "title", "placeholder", "alt"].forEach((attribute) => {
    root.querySelectorAll(`[data-i18n-${attribute}]`).forEach((node) => {
      setAttributeTranslation(node, attribute, null);
    });
  });
}

let localeChangeHandler = null;

export function onLocaleChange(handler) {
  localeChangeHandler = handler;
}

export function setLocale(locale, persist = true) {
  if (!isSupportedLocale(locale)) return false;
  currentLocale = locale;
  document.documentElement.lang = locale;
  document.documentElement.dir = "ltr";
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch (err) {
      console.warn("[i18n] language persist failed:", err);
    }
  }
  applyStaticTranslations();
  if (localeChangeHandler) localeChangeHandler(locale);
  document.dispatchEvent(new CustomEvent("app:localechange", { detail: { locale } }));
  return true;
}

export function initI18n() {
  return setLocale(resolveInitialLocale(), false);
}
