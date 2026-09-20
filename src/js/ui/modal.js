/**
 * Lightweight modal helper: manages focus trap and restore for an overlay modal.
 * Returns helpers to open/close the modal while keeping keyboard focus contained.
 */

const trapStack = [];

function getFocusable(el) {
  const sel =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const all = Array.from(el.querySelectorAll(sel));
  // Prefer elements that the layout engine reports as being on-screen. When
  // no layout information is available (jsdom, some embedded webviews) we
  // fall back to all queryable focusables so the trap still works.
  const visible = all.filter((n) => n.offsetParent !== null || n.getClientRects().length > 0);
  return visible.length > 0 ? visible : all;
}

export function openModal(modal, triggerEl) {
  if (!modal) return;
  // Idempotent: an already-open modal keeps its existing trap and focus.
  if (!modal.classList.contains("hidden")) return;
  modal.classList.remove("hidden");
  // `data-modal-role` lets an alert-style dialog (e.g. scanner errors) keep
  // alertdialog semantics while the helper owns set/remove lifecycle.
  modal.setAttribute("role", modal.getAttribute("data-modal-role") || "dialog");
  modal.setAttribute("aria-modal", "true");
  const labelId = `${modal.id || "modal"}-label`;
  const labelEl = modal.querySelector("h2, [data-modal-label]");
  if (labelEl) {
    if (!labelEl.id) labelEl.id = labelId;
    modal.setAttribute("aria-labelledby", labelEl.id);
  } else {
    modal.setAttribute("aria-label", "Dialog");
  }
  // `document.body` is not focus-restorable (scanner errors open with it), so
  // fall back to whatever held focus; if nothing did, closeModal clears focus.
  const explicit = triggerEl && triggerEl !== document.body ? triggerEl : null;
  const current =
    document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const previouslyFocused = explicit || current;
  const focusables = getFocusable(modal);
  const first = focusables[0];
  let addedTabindex = false;
  if (first) {
    first.focus();
  } else {
    // Dialog with no focusable content still needs initial focus.
    addedTabindex = !modal.hasAttribute("tabindex");
    if (addedTabindex) modal.setAttribute("tabindex", "-1");
    modal.focus();
  }

  const handler = (e) => {
    if (e.key === "Escape") {
      // Only the top-most dialog reacts, so Escape closes the active layer.
      const top = trapStack[trapStack.length - 1];
      if (top && top.modal === modal) {
        e.stopPropagation();
        closeModal(modal);
      }
      return;
    }
    if (e.key !== "Tab") return;
    const f = getFocusable(modal);
    if (f.length === 0) return;
    const firstEl = f[0];
    const lastEl = f[f.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };
  modal.addEventListener("keydown", handler);
  trapStack.push({ modal, handler, previouslyFocused, addedTabindex });
}

export function closeModal(modal) {
  if (!modal) return;
  const idx = trapStack.findIndex((t) => t.modal === modal);
  if (idx !== -1) {
    const trap = trapStack[idx];
    trapStack.splice(idx, 1);
    modal.removeEventListener("keydown", trap.handler);
    if (trap.addedTabindex) modal.removeAttribute("tabindex");
    // Skip restoring to an element that was removed while the dialog was open
    // (e.g. a re-rendered list): focusing a detached node is a silent no-op.
    if (
      trap.previouslyFocused &&
      trap.previouslyFocused.isConnected !== false &&
      typeof trap.previouslyFocused.focus === "function"
    ) {
      trap.previouslyFocused.focus();
    }
  }
  const prev = trapStack[trapStack.length - 1];
  if (prev) {
    const f = getFocusable(prev.modal);
    if (f.length > 0) f[0].focus();
  }
  // Never leave focus on content inside a now-hidden dialog (e.g. when the
  // modal was opened without a restorable trigger such as document.body).
  if (document.activeElement && modal.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  modal.classList.add("hidden");
  modal.removeAttribute("role");
  modal.removeAttribute("aria-modal");
  modal.removeAttribute("aria-labelledby");
  modal.removeAttribute("aria-label");
}
