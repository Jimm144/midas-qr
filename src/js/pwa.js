import { t } from "./i18n.js";

/**
 * PWA layer: service-worker registration/update banner and the install prompt.
 * Split out of main.js. The listeners below are registered at import time, so
 * importing this module is enough to keep the offline update flow working.
 */

export function refreshPwaTranslations() {
  const banner = document.getElementById("sw-update-banner");
  if (!banner) return;
  const message = banner.querySelector("span");
  const button = document.getElementById("sw-reload-btn");
  if (message) message.textContent = t("pwa.updateAvailable");
  if (button) button.textContent = t("pwa.reload");
}

function showUpdateBanner() {
  let banner = document.getElementById("sw-update-banner");
  if (banner) return;
  banner = document.createElement("div");
  banner.id = "sw-update-banner";
  banner.className = "update-banner";
  banner.setAttribute("role", "status");
  const message = document.createElement("span");
  message.textContent = t("pwa.updateAvailable");
  const button = document.createElement("button");
  button.id = "sw-reload-btn";
  button.textContent = t("pwa.reload");
  banner.append(message, button);
  document.body.appendChild(banner);
  button.addEventListener("click", () => window.location.reload());
}

document.addEventListener("app:localechange", refreshPwaTranslations);

if ("serviceWorker" in navigator) {
  // First-time visitors get a controller from clients.claim() — that is not an
  // update and must not trigger the "new version" banner. The flag flips once
  // the tab is actually controlled, so a later update does surface the banner.
  let controllerSeen = !!navigator.serviceWorker.controller;
  // A first-visit claim observed during the install's statechange; the
  // matching controllerchange must not be mistaken for an update.
  let firstClaimHandled = false;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js", { scope: "./", updateViaCache: "none" })
      .then((reg) => {
        // Hash-only navigation never triggers an update check, so long-lived
        // tabs would otherwise sit on stale assets forever: re-check when
        // the tab becomes visible and once an hour as a backstop.
        const checkForUpdate = () => {
          reg.update().catch(() => {});
        };
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkForUpdate();
        });
        setInterval(checkForUpdate, 60 * 60 * 1000);
        // Surface a "refresh to update" banner when a new SW takes over.
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state !== "installed" || !navigator.serviceWorker.controller) return;
            if (controllerSeen) {
              showUpdateBanner();
            } else {
              // clients.claim() gave this first-visit tab its controller; the
              // bundle it is running is the one that was just installed.
              controllerSeen = true;
              firstClaimHandled = true;
            }
          });
        });
      })
      .catch((err) => console.warn("SW registration failed:", err));
  });

  // When a freshly-activated SW takes over, prompt once on next reload. The
  // first claim on a first visit only marks the tab as controlled.
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (firstClaimHandled) {
      firstClaimHandled = false;
      return;
    }
    if (!controllerSeen) {
      controllerSeen = true;
      return;
    }
    if (refreshing) return;
    refreshing = true;
    showUpdateBanner();
  });
}

// PWA install prompt capture (no automatic prompt — exposes a button when eligible).
let deferredInstallPrompt = null;

function setInstallButtonVisible(visible) {
  const btn = document.getElementById("btn-install");
  if (btn) btn.classList.toggle("hidden", !visible);
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  window.__qrInstallPrompt = deferredInstallPrompt;
  setInstallButtonVisible(true);
});

// The install prompt event is single-use: once the user has answered it (or the
// app got installed), drop every reference so a later click can never call
// prompt() on a spent event (which throws).
function clearInstallPrompt() {
  deferredInstallPrompt = null;
  window.__qrInstallPrompt = null;
}

window.addEventListener("appinstalled", () => {
  clearInstallPrompt();
  setInstallButtonVisible(false);
});

// Hoisted function declaration: initApp() runs during module evaluation when the
// bundle loads after DOMContentLoaded, i.e. before a `const` here would initialize.
export function initInstallButton() {
  const btn = document.getElementById("btn-install");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const prompt = deferredInstallPrompt || window.__qrInstallPrompt;
    if (!prompt) return;
    // Consume the event before awaiting: a second click while the prompt is up
    // would otherwise reuse it.
    clearInstallPrompt();
    try {
      prompt.prompt();
      // The event is spent once the user answers (accepted or dismissed), so
      // hide the now-inert button; it returns on a later visit when the browser
      // fires beforeinstallprompt again.
      await prompt.userChoice;
      setInstallButtonVisible(false);
    } catch (err) {
      console.warn("[QR] Install prompt failed:", err);
      setInstallButtonVisible(false);
    }
  });
  if (window.__qrInstallPrompt) setInstallButtonVisible(true);
}
