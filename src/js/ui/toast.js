// @ts-check
let undoData = null;
let undoTimer = null;
let undoToastInitialized = false;

function initUndoToast() {
  if (undoToastInitialized) return;
  const toast = document.getElementById("undo-toast");
  if (!toast) return;
  toast.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest("#undo-toast-btn") : null;
    if (btn && undoData) {
      undoData();
      undoData = null;
      hideUndoToast();
    }
  });
  undoToastInitialized = true;
}

export function showUndoToast(msg, onUndo) {
  let toast = document.getElementById("undo-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "undo-toast";
    toast.className = "fixed bottom-4 left-4 z-[100] flex items-center gap-3";
    // Undo is a confirmation/status message, not an error: polite announcement
    // avoids interrupting the user's current screen-reader output.
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.setAttribute("aria-atomic", "true");
    document.body.appendChild(toast);
  }
  initUndoToast();
  // Built via DOM APIs (not innerHTML) so a caller-supplied message can never
  // inject markup, and the one delegated click listener is never duplicated.
  toast.textContent = "";
  const label = document.createElement("span");
  label.textContent = msg == null ? "" : String(msg);
  const btn = document.createElement("button");
  btn.id = "undo-toast-btn";
  btn.type = "button";
  btn.textContent = "UNDO";
  toast.append(label, btn);
  toast.classList.remove("hidden");
  undoData = onUndo;
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndoToast, 5000);
}

function hideUndoToast() {
  const toast = document.getElementById("undo-toast");
  if (toast) {
    // The auto-hide timer can fire while UNDO has focus; never strand focus
    // inside a hidden element.
    const active = document.activeElement;
    if (active instanceof HTMLElement && toast.contains(active)) active.blur();
    toast.classList.add("hidden");
  }
  undoData = null;
  if (undoTimer) clearTimeout(undoTimer);
}
