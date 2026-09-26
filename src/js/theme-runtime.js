/**
 * Theme runtime: maps the selected theme/mode onto CSS custom properties and
 * keeps the theme controls (select, toggle button, system preference) in sync.
 * Split out of main.js.
 */
import { DOM } from "./ui/dom.js";
import { t } from "./i18n.js";
import { themes } from "./themes";
import { generateQR } from "./generator/generator.js";

let preGothicMode = null;

/** Resolve dark-mode for a theme/mode pair; Gothic forces dark and restores the prior mode on leave. */
function resolveIsDark(themeName, modeName) {
  const isDarkOnly = themeName === "gothic";
  if (isDarkOnly) {
    if (preGothicMode === null) {
      try {
        preGothicMode = localStorage.getItem("qr-mode") || "auto";
      } catch {
        // Storage can throw (private mode, blocked cookies): treat as auto.
        preGothicMode = "auto";
      }
    }
    if (DOM.modeSelect.value !== "dark") {
      DOM.modeSelect.value = "dark";
      try {
        localStorage.setItem("qr-mode", "dark");
      } catch (e) {
        console.warn("[QR] mode persist failed:", e);
      }
    }
  } else if (preGothicMode !== null) {
    DOM.modeSelect.value = preGothicMode;
    try {
      localStorage.setItem("qr-mode", preGothicMode);
    } catch (e) {
      console.warn("[QR] mode persist failed:", e);
    }
    modeName = preGothicMode;
    preGothicMode = null;
  }

  if (isDarkOnly) return true;
  if (modeName === "auto") {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return modeName === "dark";
}

/** Sync the light-mode option and theme-toggle icon/aria state for a theme/mode pair. */
function updateThemeToggleUI(themeName, isDark) {
  const isDarkOnly = themeName === "gothic";
  const lightOpt = DOM.modeSelect.querySelector('option[value="light"]');
  if (lightOpt) lightOpt.disabled = isDarkOnly;

  const sunIcon = document.getElementById("icon-theme-sun");
  const moonIcon = document.getElementById("icon-theme-moon");
  if (DOM.btnThemeToggle) {
    if (isDarkOnly) {
      const label = t("theme.gothicLightUnavailable");
      DOM.btnThemeToggle.setAttribute("aria-label", label);
      DOM.btnThemeToggle.setAttribute("title", label);
      DOM.btnThemeToggle.disabled = true;
      DOM.btnThemeToggle.setAttribute("aria-disabled", "true");
      DOM.btnThemeToggle.classList.add("opacity-50", "pointer-events-none");
      if (sunIcon) sunIcon.classList.add("hidden");
      if (moonIcon) moonIcon.classList.remove("hidden");
    } else {
      DOM.btnThemeToggle.disabled = false;
      DOM.btnThemeToggle.removeAttribute("aria-disabled");
      DOM.btnThemeToggle.classList.remove("opacity-50", "pointer-events-none");
      if (isDark) {
        if (sunIcon) sunIcon.classList.remove("hidden");
        if (moonIcon) moonIcon.classList.add("hidden");
        const label = t("theme.switchLight");
        DOM.btnThemeToggle.setAttribute("aria-label", label);
        DOM.btnThemeToggle.setAttribute("title", label);
      } else {
        if (sunIcon) sunIcon.classList.add("hidden");
        if (moonIcon) moonIcon.classList.remove("hidden");
        const label = t("theme.switchDark");
        DOM.btnThemeToggle.setAttribute("aria-label", label);
        DOM.btnThemeToggle.setAttribute("title", label);
      }
    }
  }
}

export function refreshThemeToggleTranslations() {
  if (!DOM.themeSelect || !DOM.modeSelect || !DOM.btnThemeToggle) return;
  const themeName = DOM.themeSelect.value;
  const modeName = DOM.modeSelect.value;
  const isDark =
    themeName === "gothic" ||
    modeName === "dark" ||
    (modeName === "auto" &&
      !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches));
  updateThemeToggleUI(themeName, isDark);
}

document.addEventListener("app:localechange", refreshThemeToggleTranslations);

/** Build the CSS custom-property map for the active theme variant. */
function buildCssVarMap(themeName, isDark) {
  const themeFamily = themes[themeName] || themes.default;
  const activeThemeObj = isDark ? themeFamily.dark : themeFamily.light;
  const t = activeThemeObj;
  const styles = {
    "--bg": t.bg,
    "--accent": t.accent,
    "--accent-contrast": t.accentContrast,
    "--accent-soft": t.accentSoft,
    "--text": t.text,
    "--surface": t.surface,
    "--bg-elevated": t.bgElevated,
    "--inset": t.inset,
    "--border": t.border,
    "--border-strong": t.borderStrong,
    "--muted": t.muted,
    "--danger": t.danger,
    "--success": t.success,
    "--warning": t.warning,
    "--shadow-pop": t.shadowPop,
    "--shadow-color": t.shadowColor,
    "--radius-inner": t.radiusInner,
    "--radius-element": t.radiusElement,
    "--radius-container": t.radiusContainer,
    "--btn-radius": t.buttonRadius,
    // Pill-shaped chrome follows the theme: Y2K's zero-radius identity turns
    // tabs/badges/toasts square along with everything else.
    "--radius-pill": themeName === "y2k" ? "0px" : "9999px",
    // Astryx themes carry their own body / heading / code typography.
    "--font-family-body": themeFamily.fonts.body,
    "--font-family-heading": themeFamily.fonts.heading,
    "--font-family-display": themeFamily.fonts.display,
    // Astryx type scale + heading weight overrides per theme.
    "--font-scale": String(themeFamily.fonts.scale / 14),
    "--font-weight-heading": themeFamily.fonts.headingWeight,
    "--font-family-code": themeFamily.fonts.code,
  };
  return { styles, activeThemeObj };
}

/** Apply theme tokens from themes.ts based on theme name and mode. */
function applyThemeTokens(themeName, modeName) {
  const isDark = resolveIsDark(themeName, modeName);
  updateThemeToggleUI(themeName, isDark);
  const { styles, activeThemeObj } = buildCssVarMap(themeName, isDark);
  Object.entries(styles).forEach(([k, v]) => {
    document.documentElement.style.setProperty(k, v);
  });
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  try {
    localStorage.setItem("qr-bg", activeThemeObj.bg);
    localStorage.setItem("qr-accent", activeThemeObj.accent);
    // The whole resolved map, so the inline bootstrap in <head> can replay it
    // before the first paint. It only knows qr-bg/qr-accent plus the OS
    // dark/light preference, so a non-default theme — or light mode chosen on a
    // dark-preferring OS — painted the wrong tokens until the bundle ran, which
    // is the flash of wrong colours on refresh.
    localStorage.setItem("qr-theme-tokens", JSON.stringify(styles));
    localStorage.setItem("qr-scheme", isDark ? "dark" : "light");
  } catch (e) {
    console.warn("[QR] theme color persist failed:", e);
  }
  generateQR(true);
}

/** Apply the currently selected theme and mode. */
export function applyTheme() {
  applyThemeTokens(DOM.themeSelect.value, DOM.modeSelect.value);
}

/** Theme + dark/light/auto mode selects + system color-scheme listener. */
export function initThemeSystem() {
  DOM.themeSelect.addEventListener("change", (e) => {
    try {
      localStorage.setItem("qr-theme", e.target.value);
    } catch (e2) {
      console.warn("[QR] theme persist failed:", e2);
    }
    applyTheme();
  });
  DOM.modeSelect.addEventListener("change", (e) => {
    try {
      localStorage.setItem("qr-mode", e.target.value);
    } catch (e2) {
      console.warn("[QR] mode persist failed:", e2);
    }
    applyTheme();
  });
  if (DOM.btnThemeToggle) {
    DOM.btnThemeToggle.addEventListener("click", () => {
      const themeName = DOM.themeSelect.value;
      if (themeName === "gothic") return;
      const modeName = DOM.modeSelect.value;
      const isDark =
        modeName === "auto"
          ? window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
          : modeName === "dark";
      DOM.modeSelect.value = isDark ? "light" : "dark";
      DOM.modeSelect.dispatchEvent(new Event("change"));
    });
  }
  if (typeof window.matchMedia === "function") {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (DOM.modeSelect.value === "auto") applyTheme();
    });
  }
}

/** Restore saved theme/mode selects from localStorage. */
export function restoreSavedThemeMode() {
  // Legacy keys from pre-Astryx themes map onto the closest new theme.
  const THEME_ALIASES = {
    default: "neutral",
    matrix: "matcha",
    catppuccin: "stone",
    cyber: "y2k",
    mono: "neutral",
  };
  const savedTheme = getSaved("qr-theme");
  const themeKey = (savedTheme && THEME_ALIASES[savedTheme]) || savedTheme;
  if (themeKey && themes[themeKey]) DOM.themeSelect.value = themeKey;
  const savedMode = getSaved("qr-mode");
  if (savedMode && ["auto", "dark", "light"].includes(savedMode)) DOM.modeSelect.value = savedMode;
  applyTheme();
}

/** Read a localStorage key, tolerating blocked/private-mode storage. @param {string} key */
function getSaved(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
