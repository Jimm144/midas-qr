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
  const candidates = [...languages, typeof navigator !== "undefined" ? navigator.language : "", DEFAULT_LOCALE];
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
  if (currentLocale !== DEFAULT_LOCALE) return currentLocale;
  return typeof navigator !== "undefined" && navigator.language ? navigator.language : undefined;
}

export function resolveInitialLocale() {
  currentLocale = storedLocale() || browserLocale();
  return currentLocale;
}

export function t(key, params = {}) {
  const catalog = CATALOGS[currentLocale] || CATALOGS[DEFAULT_LOCALE];
  const fallback = CATALOGS[DEFAULT_LOCALE];
  let value = catalog[key];
  if (value === undefined) value = fallback[key];
  if (value === undefined) return key;
  return value.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

export function tp(baseKey, count, params = {}) {
  const locale = currentLocale;
  let category;
  try {
    category = new Intl.PluralRules(locale).select(count);
  } catch {
    category = count === 1 ? "one" : "other";
  }
  const key = `${baseKey}_${category}`;
  const fallbackKey = category === "one" ? `${baseKey}_one` : `${baseKey}_other`;
  return t(CATALOGS[locale] && CATALOGS[locale][key] !== undefined ? key : fallbackKey, { count, ...params });
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
    if (key) node.innerHTML = t(key);
  });
  ["aria-label", "title", "placeholder", "alt"].forEach((attribute) => {
    root.querySelectorAll(`[data-i18n-${attribute}]`).forEach((node) => {
      setAttributeTranslation(node, attribute, null);
    });
  });}

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
