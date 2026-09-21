/**
 * Midas QR — bootstrap.
 *
 * initApp() only orchestrates: every cohesive concern lives in its own module
 * (theme-runtime, pwa, ui/shell, generator/inputs, generator/controls), and
 * this file wires them together in the order the app depends on.
 */
import { initDOM } from "./ui/dom.js";
import { state, loadState, setupStatePersistence, applyGeneratorFields } from "./state";
import { initCustomSelects } from "./ui/components.js";
import { initSearchableSelects } from "./ui/searchable-select.js";
import { initDateTimePickers } from "./ui/datetime-picker.js";
import { initTabs } from "./ui/tabs.js";
import { initColorPicker } from "./ui/color-picker.js";
import { initExport } from "./generator/export.js";
import { initBatchExport } from "./generator/batch.js";
import { initGeneratorHistory, renderGeneratorHistory } from "./generator/history.js";
import { ensureQrcodeLoaded } from "./generator/encoder.js";
import { generateQR, initGenerator, syncConfigToUI } from "./generator/generator.js";
import { renderHistoryList } from "./scanner/scanner.js";
import { decodeStateFromUrl, applyHydratedPayload } from "./share.js";
import { initThemeSystem, restoreSavedThemeMode } from "./theme-runtime.js";
import { initCreditsModal, initGlobalListeners, initSectionToggles } from "./ui/shell.js";
import { initDataInputPanels, initInputHandlers, resetSampleForms } from "./generator/inputs.js";
import {
  initBackgroundImageControls,
  initColorControls,
  initDimensionControls,
  initLogoControls,
  initSaveButton,
  initShareLinkButton,
  initShapeAndFrameControls,
  syncUIFromState,
} from "./generator/controls.js";
import { initInstallButton } from "./pwa.js";

let appInitialized = false;

const initApp = () => {
  // Start the ~20 KB encoder download immediately instead of letting the
  // first render's await serialize it behind all app wiring. The loader is
  // single-flight, so the later `await ensureQrcodeLoaded()` reuses this
  // same promise and costs nothing.
  void ensureQrcodeLoaded();
  // Guard: a second boot (e.g. DOMContentLoaded racing the readyState check)
  // must not wire every control twice.
  if (appInitialized) return;
  appInitialized = true;
  try {
    initDOM();
    resetSampleForms();
    loadState();
    // Restore what the user typed before the reload (share URLs decoded next
    // still win, since decodeStateFromUrl repopulates from the payload).
    applyGeneratorFields(state.generator.fields);
    // Stale-state guard: a mask saved by an older session used to come back as
    // a circle trapping the code inside frames. Clear it before share URLs
    // decode, so an explicit ?mask= link still wins.
    state.generator.maskType = "none";
    state.generator.qrRadius = 0;
    decodeStateFromUrl();
    // Pin the frame color to what it currently resolves to, so later body
    // colour changes can't drag the frame along.
    if (!state.generator.frameColor) state.generator.frameColor = state.generator.dotsColor;
    setupStatePersistence();
    initCustomSelects();
    initSearchableSelects(document);
    initDateTimePickers(document);
    initTabs();
    initColorPicker();
    initExport();
    initBatchExport();
    initGeneratorHistory();
    initGenerator();
    restoreSavedThemeMode();

    initGlobalListeners();
    renderHistoryList();
    renderGeneratorHistory();
    initCreditsModal();
    initThemeSystem();
    initDataInputPanels();
    initInputHandlers();
    initColorControls();
    initDimensionControls();
    initShapeAndFrameControls();
    initLogoControls();
    initBackgroundImageControls();
    initSaveButton();
    initShareLinkButton();
    initSectionToggles();
    syncConfigToUI();
    syncUIFromState();
    // Restore any payload decoded from a share URL after the init recompiles.
    applyHydratedPayload();
    generateQR(true);
    initInstallButton();
  } catch (err) {
    console.error("[QR] initApp CRASHED:", err);
    showFatalError(err);
  }
};

/** Visible fallback UI if init crashes — keeps users from staring at a blank shell. */
function showFatalError(err) {
  let banner = document.getElementById("init-fatal-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "init-fatal-banner";
    banner.setAttribute("role", "alert");
    banner.className = "fixed inset-x-0 top-0 z-[100] bg-red-500 text-white text-center p-3 font-semibold";
    document.body.appendChild(banner);
  }
  banner.textContent = "App failed to start. Reload or clear site data.";
  void err;
}

// P13: scripts now load in parallel, so defer initApp until the vendored
// libraries have actually executed (their globals are needed at runtime).
function runWhenReady() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
}

if (window.__qrLibsLoaded && typeof window.__qrLibsLoaded.then === "function") {
  window.__qrLibsLoaded.then(runWhenReady).catch((err) => {
    console.error("[QR] init deferred until libraries load:", err);
  });
} else {
  runWhenReady();
}

// Surface stray promise rejections in the console so silent failures aren't missed.
window.addEventListener("unhandledrejection", (event) => {
  console.warn("[QR] Unhandled promise rejection:", event.reason);
});
