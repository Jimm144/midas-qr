/**
 * App-shell UI wiring shared by every panel: global document listeners,
 * the Credits modal and the collapsible config sections. Split out of main.js.
 */
import { DOM } from "./dom.js";
import { state } from "../state";
import { announce } from "./announce.js";
import { openModal, closeModal } from "./modal.js";
import { generateQR } from "../generator/generator.js";

/**
 * True when focus sits in a text-entry context, where single-letter shortcuts
 * and hijacking Ctrl+C would fight the user's typing. Deliberately narrower
 * than "anything focusable": buttons/links with tabindex are fine to shortcut.
 * @param {Element | null | undefined} el
 */
export function isTextEntryContext(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable === true) return true;
  // `isContentEditable` is unreliable in some engines (and jsdom): fall back
  // to the attribute, where "" and "true" both mean enabled.
  const attr = typeof el.getAttribute === "function" ? el.getAttribute("contenteditable") : null;
  return attr !== null && attr !== "false";
}

/**
 * Map a keydown onto a global shortcut. Pure so the mapping is unit-testable
 * without a live DOM: returns "save" | "copy" | "rerender" | null.
 * Ctrl/Cmd+S saves, Ctrl/Cmd+C copies the QR (unless text is selected or the
 * user is typing), and plain R re-renders the preview.
 * `hasSelection` may be a thunk so a live keydown handler does not pay for a
 * selection read on every keystroke; it is only consulted for Ctrl/Cmd+C.
 * @param {KeyboardEvent} e
 * @param {{activeTab: string, saveDisabled: boolean, copyDisabled: boolean, hasSelection: boolean | (() => boolean), typing: boolean}} ctx
 * @returns {"save" | "copy" | "rerender" | null}
 */
export function shortcutActionFor(e, ctx) {
  if (!e || e.defaultPrevented || e.altKey || e.shiftKey) return null;
  const key = typeof e.key === "string" ? e.key.toLowerCase() : "";
  if (e.ctrlKey || e.metaKey) {
    if (key === "s") return !ctx.saveDisabled && ctx.activeTab === "generator" ? "save" : null;
    if (key === "c") {
      if (ctx.typing || ctx.copyDisabled || ctx.activeTab !== "generator") return null;
      const hasSelection = typeof ctx.hasSelection === "function" ? ctx.hasSelection() : ctx.hasSelection;
      return hasSelection ? null : "copy";
    }
    return null;
  }
  if (key === "r" && !e.repeat && ctx.activeTab === "generator" && !ctx.typing) return "rerender";
  return null;
}

/** Global document-level listeners: Escape fallbacks for the modals, Ctrl+S/Ctrl+C. */
export function initGlobalListeners() {
  const skipLink = document.getElementById("skip-link");
  if (skipLink) {
    skipLink.addEventListener("click", (e) => {
      e.preventDefault();
      let headingId = null;
      if (state.activeTab === "generator") headingId = "panel-generator-heading";
      else if (state.activeTab === "scanner") headingId = "panel-scanner-heading";
      else if (state.activeTab === "history") headingId = "panel-history-gen-heading";
      if (headingId) {
        const heading = document.getElementById(headingId);
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus();
        }
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // Anchored popovers own Escape through their popover seam; only the
      // modal fallback stays here for dialogs opened without a focused trap.
      if (DOM.creditsModal && !DOM.creditsModal.classList.contains("hidden")) closeModal(DOM.creditsModal);
      if (DOM.errorModal && !DOM.errorModal.classList.contains("hidden")) closeModal(DOM.errorModal);
    }
    const action = shortcutActionFor(e, {
      activeTab: state.activeTab,
      saveDisabled: !DOM.btnSave || DOM.btnSave.disabled,
      copyDisabled: !DOM.btnCopy || DOM.btnCopy.disabled,
      // Lazy: every keystroke would otherwise pay for a selection read that
      // only the Ctrl/Cmd+C branch ever consults.
      hasSelection: () => !!window.getSelection && window.getSelection().toString().length > 0,
      typing: isTextEntryContext(document.activeElement),
    });
    if (!action) return;
    e.preventDefault();
    if (action === "save") DOM.btnSave.click();
    else if (action === "copy") DOM.btnCopy.click();
    else if (action === "rerender") generateQR(true);
  });
}

/** Wire the Credits modal: open from button, close via X / backdrop / Escape. */
export function initCreditsModal() {
  if (!(DOM.btnCredits && DOM.creditsModal && DOM.btnCloseCredits)) return;
  DOM.btnCredits.addEventListener("click", () => openModal(DOM.creditsModal, DOM.btnCredits));
  DOM.btnCloseCredits.addEventListener("click", () => closeModal(DOM.creditsModal));
  DOM.creditsModal.addEventListener("click", (e) => {
    if (e.target === DOM.creditsModal) closeModal(DOM.creditsModal);
  });
}

/** Collapsible config sections (COLORS / PARAMETERS / SHAPES / FRAMES / LOGO). */
export function initSectionToggles() {
  document.querySelectorAll(".btn-toggle-section").forEach((btn) => {
    const targetId = btn.getAttribute("data-target");
    if (targetId) btn.setAttribute("aria-controls", targetId);
    // Base name without the state suffix, so announcements and label updates
    // never read "Colors section, currently expanded section opened".
    const rawLabel = btn.getAttribute("aria-label") || btn.textContent.replace(/\s+/g, " ").trim();
    const baseLabel = rawLabel.replace(/,\s*currently\s+(expanded|collapsed)\s*$/i, "").trim();
    // "Shapes section" + "section opened" would read the word twice.
    const announceName = /section$/i.test(baseLabel) ? baseLabel : `${baseLabel} section`;

    btn.addEventListener("click", () => {
      if (!targetId) return;
      const panel = document.getElementById(targetId);
      if (!panel) return;
      const icon = btn.querySelector(".toggle-icon");
      if (panel.classList.contains("hidden")) {
        panel.classList.remove("hidden");
        panel.classList.add("flex");
        if (icon) icon.textContent = "[-]";
        btn.setAttribute("aria-expanded", "true");
        btn.setAttribute("aria-label", `${baseLabel}, currently expanded`);
        announce(`${announceName} opened`);
      } else {
        panel.classList.add("hidden");
        panel.classList.remove("flex");
        if (icon) icon.textContent = "[+]";
        btn.setAttribute("aria-expanded", "false");
        btn.setAttribute("aria-label", `${baseLabel}, currently collapsed`);
        announce(`${announceName} closed`);
      }
    });
  });
}
