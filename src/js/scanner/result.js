import { DOM } from "../ui/dom.js";
import { getSafeHttpUrl } from "./history.js";
import { openModal } from "../ui/modal.js";
import { SCAN_COOLDOWN_MS } from "../constants.js";

let lastScanResult = "";
let lastScanSuccessTime = 0;
let successFlashTimer = null;

export function setScanStatus(status, text) {
  if (!DOM.scanStatusBadge) return;
  DOM.scanStatusBadge.classList.remove("status-idle", "status-scanning", "status-detected", "status-error");
  DOM.scanStatusBadge.classList.add(`status-${status}`);
  // Idle is the resting state: no pill, no label — only active states appear.
  if (status === "idle") {
    DOM.scanStatusBadge.textContent = "";
    DOM.scanStatusBadge.classList.add("hidden");
    return;
  }
  DOM.scanStatusBadge.textContent = text;
  DOM.scanStatusBadge.classList.remove("hidden");
}

/**
 * Forget the last decoded value so the same payload is accepted again after
 * the user clears the panel or a decode fails.
 */
function resetScanThrottle() {
  lastScanResult = "";
  lastScanSuccessTime = 0;
}

/** Enable the Open/Visit action for a safe href. */
function setVisitAction(href, label) {
  DOM.btnVisitResult.setAttribute("aria-disabled", "false");
  DOM.btnVisitResult.classList.remove("opacity-50", "pointer-events-none");
  DOM.btnVisitResult.removeAttribute("tabindex");
  DOM.btnVisitResult.href = href;
  DOM.btnVisitResult.textContent = label;
}

/**
 * Disable the Open/Visit action and return it to its neutral label. The link
 * is also removed from the tab order: `pointer-events-none` stops the mouse
 * but an anchor with href="#" is still keyboard-activatable.
 */
function clearVisitAction() {
  DOM.btnVisitResult.setAttribute("aria-disabled", "true");
  DOM.btnVisitResult.classList.add("opacity-50", "pointer-events-none");
  DOM.btnVisitResult.setAttribute("tabindex", "-1");
  DOM.btnVisitResult.href = "#";
  DOM.btnVisitResult.textContent = "Open";
}

/**
 * Present a decoded payload (textarea value + action buttons) without the
 * cooldown, flash or haptics that belong to a live detection. Values are
 * assigned as DOM properties, never as markup.
 */
export function renderScanResult(text) {
  DOM.emptyStateScan.classList.add("hidden");
  DOM.scanResultText.classList.remove("hidden");
  DOM.scanResultText.value = text;
  DOM.btnCopyResult.disabled = false;
  DOM.btnSaveScan.disabled = false;

  const safeUrl = getSafeHttpUrl(text);
  if (safeUrl) {
    setVisitAction(safeUrl, "Visit URL");
  } else if (/^tel:/i.test(text)) {
    setVisitAction(text, "Call");
  } else if (/^mailto:/i.test(text)) {
    setVisitAction(text, "Email");
  } else if (/^SMSTO:/i.test(text)) {
    const parts = text.split(":");
    setVisitAction(`sms:${parts[1] || ""}`, "SMS");
  } else {
    clearVisitAction();
  }
}

export function clearScannerOutput() {
  resetScanThrottle();
  if (successFlashTimer) {
    clearTimeout(successFlashTimer);
    successFlashTimer = null;
  }
  if (DOM.scannerReticle) DOM.scannerReticle.classList.remove("scan-success");
  DOM.scanResultText.value = "";
  DOM.scanResultText.classList.add("hidden");
  DOM.btnCopyResult.disabled = true;
  DOM.btnSaveScan.disabled = true;
  clearVisitAction();
  DOM.emptyStateScan.classList.remove("hidden");
  setScanStatus("idle", "Idle");
}

function flashScanSuccess() {
  if (!DOM.scannerReticle) return;
  DOM.scannerReticle.classList.add("scan-success");
  if (successFlashTimer) clearTimeout(successFlashTimer);
  successFlashTimer = setTimeout(() => {
    DOM.scannerReticle.classList.remove("scan-success");
  }, 800);
}

export function handleScanError() {
  resetScanThrottle();
  DOM.emptyStateScan.classList.remove("hidden");
  DOM.scanResultText.value = "";
  DOM.scanResultText.classList.add("hidden");
  DOM.btnCopyResult.disabled = true;
  DOM.btnSaveScan.disabled = true;
  clearVisitAction();
  setScanStatus("error", "Error");
  if (DOM.errorModal) {
    DOM.errorModalMsg.textContent = "Couldn't decode this image";
    openModal(DOM.errorModal, document.body);
  } else {
    alert("Couldn't decode this image");
  }
}

export function handleScanSuccess(text) {
  const now = Date.now();
  if (text === lastScanResult && now - lastScanSuccessTime < SCAN_COOLDOWN_MS) {
    return;
  }
  lastScanResult = text;
  lastScanSuccessTime = now;

  renderScanResult(text);
  setScanStatus("detected", "Detected");
  flashScanSuccess();

  if (navigator.vibrate) {
    try {
      navigator.vibrate(50);
    } catch (e) {
      console.warn("[QR] vibrate failed:", e);
    }
  }
}
