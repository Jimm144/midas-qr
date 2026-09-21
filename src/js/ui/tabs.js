import { DOM } from "./dom.js";
import { announce } from "./announce.js";
import { state } from "../state";
import { startWebcamScan, stopWebcamScan, initScanner } from "../scanner/scanner.js";
import { clearScannerOutput } from "../scanner/result.js";
import { loadVendoredScript } from "../lib-loader.js";

let scannerInitialized = false;

/** Single-flight lazy load of the vendored jsQR library. */
function loadJsQR() {
  return loadVendoredScript("src/lib/jsqr.min.js", "jsQR");
}

/** Boot the scanner once jsQR is available, then restore its last view. */
function bootScanner() {
  if (scannerInitialized) return;
  initScanner();
  scannerInitialized = true;
}

function resumeScannerView() {
  if (state.activeTab !== "scanner") return;
  if (state.scanner.mode === "webcam") {
    startWebcamScan();
  } else if (DOM.uploadedPreviewContainer && DOM.uploadedPreviewContainer.classList.contains("hidden")) {
    clearScannerOutput();
  }
}

const TAB_TITLES = {
  generator: "Midas QR — Generator",
  scanner: "Midas QR — Scanner",
  history: "Midas QR — History",
};

function setTabTitle(tab) {
  const t = TAB_TITLES[tab];
  if (t && document.title !== t) document.title = t;
}

function updateTabAria(targetTab) {
  [DOM.tabBtnGenerator, DOM.tabBtnScanner, DOM.tabBtnHistory].filter(Boolean).forEach((btn) => {
    btn.setAttribute("tabindex", "-1");
    btn.setAttribute("aria-selected", "false");
  });
  const activeBtn =
    targetTab === "generator"
      ? DOM.tabBtnGenerator
      : targetTab === "scanner"
        ? DOM.tabBtnScanner
        : DOM.tabBtnHistory;
  if (!activeBtn) return;
  activeBtn.setAttribute("tabindex", "0");
  activeBtn.setAttribute("aria-selected", "true");
}

function announceTab(tab) {
  announce(`Switched to ${tab} tab`);
}

function focusPanelHeading(tab) {
  const panel =
    tab === "generator" ? DOM.panelGenerator : tab === "scanner" ? DOM.panelScanner : DOM.panelHistory;
  if (!panel) return;
  const heading = panel.querySelector("h2") || panel.querySelector('[role="heading"]');
  const target = heading || panel;
  target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

function setPanelVisibility(activePanel) {
  [DOM.panelGenerator, DOM.panelScanner, DOM.panelHistory].forEach((p) => {
    if (!p) return;
    const isActive = p === activePanel;
    p.classList.toggle("hidden", !isActive);
    if (isActive) p.removeAttribute("aria-hidden");
    else p.setAttribute("aria-hidden", "true");
  });
}

export function switchTab(targetTab, skipHistory = false, focusHeading = false) {
  // Unknown tab names must not blank every panel and announce nonsense.
  if (!Object.prototype.hasOwnProperty.call(TAB_TITLES, targetTab)) return;
  if (state.activeTab === targetTab) return;
  state.activeTab = targetTab;
  setTabTitle(targetTab);

  if (!skipHistory && window.location.hash !== `#${targetTab}`) {
    window.history.pushState({ tab: targetTab }, "", `#${targetTab}`);
  }

  const tabButtons = {
    generator: DOM.tabBtnGenerator,
    scanner: DOM.tabBtnScanner,
    history: DOM.tabBtnHistory,
  };
  Object.entries(tabButtons).forEach(([tab, btn]) => {
    if (!btn) return;
    // Toggle only the active state so any extra classes on the button
    // (icons, custom hooks) survive a tab switch.
    btn.classList.add("tab-btn");
    btn.classList.toggle("is-active", tab === targetTab);
  });

  if (targetTab === "generator") {
    setPanelVisibility(DOM.panelGenerator);
    stopWebcamScan();
  } else if (targetTab === "scanner") {
    setPanelVisibility(DOM.panelScanner);
    if (!scannerInitialized) {
      loadJsQR().then((ok) => {
        if (!ok || state.activeTab !== "scanner") return;
        bootScanner();
        resumeScannerView();
      });
    } else {
      resumeScannerView();
    }
  } else if (targetTab === "history") {
    setPanelVisibility(DOM.panelHistory);
    stopWebcamScan();
  }
  updateTabAria(targetTab);
  announceTab(targetTab);
  if (focusHeading) {
    focusPanelHeading(targetTab);
  }
}

let tabsInitialized = false;

export function initTabs() {
  // Idempotent: repeated calls must not stack click/keydown/hashchange listeners.
  if (tabsInitialized) return;
  tabsInitialized = true;

  if (DOM.tabBtnGenerator) {
    DOM.tabBtnGenerator.addEventListener("click", () => switchTab("generator"));
  }
  if (DOM.tabBtnScanner) {
    DOM.tabBtnScanner.addEventListener("click", () => switchTab("scanner"));
  }
  if (DOM.tabBtnHistory) {
    DOM.tabBtnHistory.addEventListener("click", () => switchTab("history"));
  }

  [DOM.tabBtnGenerator, DOM.tabBtnScanner, DOM.tabBtnHistory].filter(Boolean).forEach((btn, _idx, btns) => {
    btn.addEventListener("keydown", (e) => {
      const isArrow = e.key === "ArrowRight" || e.key === "ArrowLeft";
      const isEdge = e.key === "Home" || e.key === "End";
      if (!isArrow && !isEdge) return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      let curIdx = btns.indexOf(document.activeElement);
      if (curIdx === -1) {
        // Focus escaped the tablist: continue from the selected tab.
        curIdx = btns.findIndex((b) => b.getAttribute("aria-selected") === "true");
      }
      if (curIdx === -1) curIdx = 0;
      const nextIdx = isEdge
        ? e.key === "Home"
          ? 0
          : btns.length - 1
        : (curIdx + dir + btns.length) % btns.length;
      // Activate on arrow/Home/End, per the WAI-ARIA tabs pattern.
      btns[nextIdx].focus();
      btns[nextIdx].click();
    });
  });

  updateTabAria(state.activeTab);

  window.addEventListener("hashchange", () => {
    const hash = window.location.hash.replace("#", "");
    if (["generator", "scanner", "history"].includes(hash)) {
      switchTab(hash, true);
    }
  });

  const initialHash = window.location.hash.replace("#", "");
  if (["generator", "scanner", "history"].includes(initialHash)) {
    if (initialHash !== state.activeTab) {
      // Force a UI update by temporarily clearing activeTab before switching.
      const target = initialHash;
      state.activeTab = "";
      switchTab(target, true);
    } else {
      setTabTitle(initialHash);
    }
  } else {
    window.history.replaceState({ tab: state.activeTab }, "", `#${state.activeTab}`);
    setTabTitle(state.activeTab);
  }
}
