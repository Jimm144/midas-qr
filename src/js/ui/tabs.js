import { DOM } from "./dom.js";
import { t } from "../i18n.js";
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
  generator: "tabs.documentGenerator",
  scanner: "tabs.documentScanner",
  history: "tabs.documentHistory",
};

const TAB_LABELS = {
  generator: "tabs.generate",
  scanner: "tabs.scan",
  history: "tabs.history",
};

function setTabTitle(tab) {
  const key = TAB_TITLES[tab];
  if (!key) return;
  const title = t(key);
  if (document.title !== title) document.title = title;
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
  const key = TAB_LABELS[tab];
  announce(t("tabs.switched", { tab: key ? t(key) : tab }));
}

export function refreshTabTranslations() {
  if (Object.prototype.hasOwnProperty.call(TAB_TITLES, state.activeTab)) setTabTitle(state.activeTab);
}

document.addEventListener("app:localechange", refreshTabTranslations);

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

/**
 * True when the current hash carries a share payload rather than a tab name.
 * A share link keeps its design in the hash: rewriting it with `#generator`
 * would make the link unre-shareable and unbookmarkable the moment it opened.
 */
function hashCarriesPayload() {
  const hash = window.location.hash.replace(/^#/, "");
  return hash !== "" && hash.includes("=") && !Object.prototype.hasOwnProperty.call(TAB_TITLES, hash);
}

/**
 * Place a segmented control's sliding pill under its active button. Measured
 * rather than computed from the index so it stays correct if the buttons ever
 * differ in width. `offsetLeft` is relative to the container's border box, and
 * the pill is positioned from its padding box, so the border is subtracted.
 *
 * @param {Element} container
 * @returns {boolean} true when the control had a real (visible) geometry to use
 */
function positionSegmentedIndicator(container) {
  const indicator = container.querySelector(":scope > .tab-indicator");
  const active = container.querySelector(".tab-btn.is-active");
  // A hidden panel (the scanner before its tab is opened) has no layout to
  // measure; the placement is retried when it becomes visible.
  if (!indicator || !active || !active.offsetWidth) return false;
  indicator.style.width = `${active.offsetWidth}px`;
  indicator.style.transform = `translateX(${active.offsetLeft - container.clientLeft}px)`;
  return true;
}

/** Position every segmented control (tab rail, scanner source toggle). */
export function positionSegmentedIndicators() {
  document
    .querySelectorAll(".tab-rail, .seg-control")
    .forEach((container) => positionSegmentedIndicator(container));
}

/**
 * Give each segmented control its sliding pill. The transition is enabled only
 * after a placement that had real geometry, so the pill never slides in from the
 * corner: not on load, and not when a hidden panel is first shown.
 */
function initSegmentedIndicators() {
  document.querySelectorAll(".tab-rail, .seg-control").forEach((container) => {
    if (container.querySelector(":scope > .tab-indicator")) return;
    const indicator = document.createElement("span");
    indicator.className = "tab-indicator";
    indicator.setAttribute("aria-hidden", "true");
    container.prepend(indicator);

    const move = () => {
      if (!positionSegmentedIndicator(container)) return;
      // Only once: re-adding an existing class still fires a mutation record in
      // some engines, which would have the observer re-trigger itself forever.
      if (!container.classList.contains("is-indicator-ready")) {
        container.classList.add("is-indicator-ready");
      }
    };
    move();
    // The scanner's Upload/Webcam toggle flips is-active itself, so watch the
    // control rather than plumbing a call through that module. Debounced to a
    // frame: the observer fires for every class change in the control.
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        move();
      });
    }).observe(container, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    window.addEventListener("resize", move);
  });
}

export function switchTab(targetTab, skipHistory = false, focusHeading = false) {
  // Unknown tab names must not blank every panel and announce nonsense.
  if (!Object.prototype.hasOwnProperty.call(TAB_TITLES, targetTab)) return;
  if (state.activeTab === targetTab) return;
  state.activeTab = targetTab;
  setTabTitle(targetTab);

  if (!skipHistory && !hashCarriesPayload() && window.location.hash !== `#${targetTab}`) {
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
  // After the panel is visible: a segmented control inside a hidden panel has no
  // geometry to measure, so its pill would be left at zero width.
  positionSegmentedIndicators();
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
  initSegmentedIndicators();

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
  } else if (!hashCarriesPayload()) {
    window.history.replaceState({ tab: state.activeTab }, "", `#${state.activeTab}`);
    setTabTitle(state.activeTab);
  } else {
    setTabTitle(state.activeTab);
  }
}
