/**
 * App-shell UI wiring shared by every panel: global document listeners,
 * the Credits modal and the collapsible config sections. Split out of main.js.
 */
import { DOM } from "./dom.js";
import { t } from "../i18n.js";
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

function sectionToggleKey(btn) {
  const labelEl = Array.from(btn.children).find(
    (child) => child.getAttribute("data-i18n") && !child.classList.contains("toggle-icon")
  );
  return labelEl ? labelEl.getAttribute("data-i18n") : null;
}

function sectionToggleName(btn) {
  const key = sectionToggleKey(btn);
  if (key) return t(key);
  const fallback = Array.from(btn.children).find(
    (child) => !child.classList.contains("toggle-icon") && child.textContent.trim()
  );
  return fallback ? fallback.textContent.replace(/\s+/g, " ").trim() : "";
}

function setSectionToggleState(btn, expanded, includeLegacySection = true) {
  const name = sectionToggleName(btn);
  const stateKey = expanded ? "section.expanded" : "section.collapsed";
  const key = sectionToggleKey(btn);
  let label = t(stateKey, { name });
  if (!key && !includeLegacySection) {
    const template = t(stateKey, { name: "" });
    const separatorIndex = template.indexOf(",");
    const stateSuffix = separatorIndex === -1 ? template.trim() : template.slice(separatorIndex);
    label = `${name}${stateSuffix}`;
  }
  btn.setAttribute("aria-expanded", String(expanded));
  btn.setAttribute("aria-label", label);
}

export function refreshSectionToggleTranslations() {
  document.querySelectorAll(".btn-toggle-section").forEach((btn) => {
    if (sectionToggleKey(btn)) setSectionToggleState(btn, btn.getAttribute("aria-expanded") === "true");
  });
}

document.addEventListener("app:localechange", refreshSectionToggleTranslations);

/**
 * Open/close motion for a collapsible section.
 *
 * The panel is a one-row grid whose track animates 1fr <-> 0fr (see
 * .section-body in the stylesheet): one animated property, no measurement, and
 * nothing to compensate for padding. The collapsed *resting* state stays
 * `display: none` — that is what keeps the fields out of the tab order and the
 * a11y tree — so the panel is un-hidden, the 0fr start state is applied while it
 * is still hidden (a display:none element does not transition), and it is parked
 * back in the hidden state once the motion ends. A timer backstops the case
 * where no transition runs at all (reduced motion).
 *
 * SECTION_ANIM_MS mirrors the transition on .section-body.
 */
const SECTION_ANIM_MS = 220;

/** In-flight motion per panel, so a fast second click supersedes it. */
const sectionAnimations = new WeakMap();

/** Wrap a panel's children once, so the animated track has a single item. */
function ensureSectionInner(panel) {
  const first = panel.firstElementChild;
  if (first && first.classList.contains("section-inner")) return first;
  const inner = document.createElement("div");
  inner.className = "section-inner";
  while (panel.firstChild) inner.appendChild(panel.firstChild);
  panel.appendChild(inner);
  return inner;
}

function endSectionAnimation(panel, record) {
  if (sectionAnimations.get(panel) !== record) return;
  sectionAnimations.delete(panel);
  clearTimeout(record.timer);
  panel.removeEventListener("transitionend", record.onEnd);
  // Dropping the clip is what lets the settled collapsed state go
  // visibility: hidden (see the stylesheet), and releases the header's join so
  // its corners can morph back.
  panel.classList.remove("is-animating");
  if (record.btn) record.btn.classList.remove("is-animating");
}

function animateSectionBody(panel, opening, btn) {
  const icon = btn ? btn.querySelector(".toggle-icon") : null;
  if (icon) icon.textContent = opening ? "[-]" : "[+]";

  const running = sectionAnimations.get(panel);
  if (running) {
    clearTimeout(running.timer);
    panel.removeEventListener("transitionend", running.onEnd);
    if (running.btn) running.btn.classList.remove("is-animating");
    sectionAnimations.delete(panel);
  }

  if (opening) {
    if (!panel.classList.contains("is-collapsed")) return;
    // No display flip and no forced reflow: the panel was already laid out at
    // 0fr, so removing the class is a plain transition from a settled value.
    panel.classList.add("is-animating");
    if (btn) {
      // The header has to be square-bottomed *before* the panel is on screen.
      // `no-join-transition` only does that if it survives one style
      // computation: added and removed in the same block, the browser only ever
      // sees the final style — with the transition back on — so the corners
      // morphed while the panel was already appearing.
      btn.classList.add("is-animating", "no-join-transition");
      void getComputedStyle(btn).borderBottomLeftRadius;
    }
    panel.classList.remove("is-collapsed");
    if (btn) btn.classList.remove("no-join-transition");
  } else if (panel.classList.contains("is-collapsed")) {
    return;
  } else {
    panel.classList.add("is-animating");
    if (btn) btn.classList.add("is-animating");
    panel.classList.add("is-collapsed");
  }

  const record = { collapse: !opening, timer: 0, onEnd: null, btn };
  record.onEnd = (event) => {
    if (event.target === panel) endSectionAnimation(panel, record);
  };
  panel.addEventListener("transitionend", record.onEnd);
  record.timer = setTimeout(() => endSectionAnimation(panel, record), SECTION_ANIM_MS + 80);
  sectionAnimations.set(panel, record);
}

/** Collapsible config sections (COLORS / PARAMETERS / SHAPES / FRAMES / LOGO). */
export function initSectionToggles() {
  document.querySelectorAll(".btn-toggle-section").forEach((btn) => {
    const targetId = btn.getAttribute("data-target");
    if (targetId) btn.setAttribute("aria-controls", targetId);
    const includeLegacySection =
      !sectionToggleKey(btn) && btn.getAttribute("aria-label") !== sectionToggleName(btn);
    const targetPanel = targetId ? document.getElementById(targetId) : null;
    if (targetPanel) ensureSectionInner(targetPanel);

    btn.addEventListener("click", () => {
      if (!targetId) return;
      const panel = document.getElementById(targetId);
      if (!panel) return;
      // Collapsed is `is-collapsed` (a 0fr track kept in the flow), not
      // `hidden`: the panel is never display:none.
      const expanded = panel.classList.contains("is-collapsed");
      animateSectionBody(panel, expanded, btn);
      setSectionToggleState(btn, expanded, includeLegacySection);
      announce(t(expanded ? "section.opened" : "section.closed", { name: sectionToggleName(btn) }));
    });
  });
  refreshSectionToggleTranslations();
}
