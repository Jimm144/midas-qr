// @ts-check
/**
 * Anchored popover seam — one owner for document-level outside-click
 * dismissal, the Escape stack and the optional focus containment/restore of
 * anchored popovers (searchable selects, date/time pickers, custom selects and
 * the color picker). Only the top-most open popover reacts to Escape and to an
 * outside click; modal.js keeps its own dialog trap layer and stops Escape
 * before this stack sees it.
 */

/**
 * @typedef {object} PopoverConfig
 * @property {HTMLElement} root Element that counts as "inside" the popover.
 * @property {Element|Element[]|null} [anchor] Trigger(s) that toggle it; a
 *   click on an anchor is not an outside click.
 * @property {() => void} onCancel Dismissal for Escape.
 * @property {() => void} [onOutsideClick] Dismissal for outside clicks;
 *   defaults to onCancel when the widget treats both the same.
 * @property {boolean} [trapFocus] Wrap Tab/Shift+Tab inside the root.
 * @property {HTMLElement|null} [restoreFocus] Focus returned when the popover
 *   is cancelled with Escape (not on outside click or programmatic close).
 */

/**
 * @typedef {object} PopoverEntry
 * @property {HTMLElement} root
 * @property {Element[]} anchor
 * @property {() => void} onCancel
 * @property {() => void} onOutsideClick
 * @property {(e: KeyboardEvent) => void} keyHandler
 * @property {HTMLElement[]} keyTargets
 * @property {((e: KeyboardEvent) => void)|null} trapHandler
 * @property {HTMLElement|null} restoreFocus
 */

/** Open popovers, oldest first; the last entry is the top-most layer. @type {PopoverEntry[]} */
const stack = [];
let outsideBound = false;

/** Color-picker parity: buttons and inputs participate in the Tab wrap. */
const TRAP_SELECTOR = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** True when `target` is `node` or inside it. @param {Node|null|undefined} node @param {EventTarget|null} target @returns {boolean} */
function containsTarget(node, target) {
  return !!node && target instanceof Node && node.contains(target);
}

/** @param {Element[]} anchors @param {EventTarget|null} target @returns {boolean} */
function matchesAnchor(anchors, target) {
  return anchors.some((anchor) => containsTarget(anchor, target));
}

/** Install the single capture-phase outside-click listener on first use. */
function bindOutsideClick() {
  if (outsideBound) return;
  outsideBound = true;
  document.addEventListener(
    "click",
    (e) => {
      const top = stack[stack.length - 1];
      if (!top) return;
      if (containsTarget(top.root, e.target) || matchesAnchor(top.anchor, e.target)) return;
      top.onOutsideClick();
    },
    true
  );
}

/** Tab trap matching the color picker's previous handler: wrap at the ends. @param {HTMLElement} root */
function installTrap(root) {
  return (e) => {
    if (e.key !== "Tab") return;
    const focusables = Array.from(root.querySelectorAll(TRAP_SELECTOR)).filter(
      (node) =>
        node instanceof HTMLElement && (node.offsetParent !== null || node.getClientRects().length > 0)
    );
    if (focusables.length === 0) return;
    const first = /** @type {HTMLElement} */ (focusables[0]);
    const last = /** @type {HTMLElement} */ (focusables[focusables.length - 1]);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
}

/**
 * Restore the remembered focus when a popover is cancelled with Escape.
 * Deliberately not called for outside clicks or programmatic closes: moving
 * focus there stole the caret from the control the user had just clicked.
 * @param {PopoverEntry} entry
 * @returns {void}
 */
function restoreEntryFocus(entry) {
  const target = entry.restoreFocus;
  if (target && target.isConnected !== false && typeof target.focus === "function") {
    target.focus();
  }
}

/**
 * Drop `root` from the stack and its listeners, without touching focus.
 * @param {HTMLElement|null|undefined} root
 * @returns {PopoverEntry|null}
 */
function removeEntry(root) {
  if (!root) return null;
  const index = stack.findIndex((entry) => entry.root === root);
  if (index === -1) return null;
  const [entry] = stack.splice(index, 1);
  entry.keyTargets.forEach((node) => node.removeEventListener("keydown", entry.keyHandler));
  if (entry.trapHandler) root.removeEventListener("keydown", entry.trapHandler);
  return entry;
}

/**
 * Register an open popover as the top dismissal layer. Re-registering the same
 * root replaces its previous entry instead of stacking listeners.
 * @param {PopoverConfig} config
 * @returns {void}
 */
export function openPopover({
  root,
  anchor = null,
  onCancel,
  onOutsideClick = onCancel,
  trapFocus = false,
  restoreFocus = null,
}) {
  if (!root) return;
  bindOutsideClick();
  removeEntry(root);
  /** @type {PopoverEntry} */
  const entry = {
    root,
    anchor: anchor ? (Array.isArray(anchor) ? anchor : [anchor]) : [],
    onCancel,
    onOutsideClick,
    keyHandler: () => {},
    keyTargets: [],
    trapHandler: null,
    restoreFocus,
  };
  entry.keyHandler = (e) => {
    if (e.key !== "Escape") return;
    // Only the top-most layer claims Escape; anything below keeps bubbling so
    // an enclosing dialog or a global shortcut can still react.
    if (stack[stack.length - 1] !== entry) return;
    e.stopPropagation();
    onCancel();
    // Escape is the only dismissal that returns focus: an outside click must
    // leave focus (and the caret) on whatever the user just clicked.
    restoreEntryFocus(entry);
  };
  // Anchors outside the root (the color picker's triggers) also claim Escape,
  // matching the global handler the shell used before this seam.
  entry.keyTargets = /** @type {HTMLElement[]} */ ([
    root,
    ...entry.anchor.filter((node) => !root.contains(node)),
  ]);
  entry.keyTargets.forEach((node) => node.addEventListener("keydown", entry.keyHandler));
  if (trapFocus) {
    entry.trapHandler = installTrap(root);
    root.addEventListener("keydown", entry.trapHandler);
  }
  stack.push(entry);
}

/**
 * Close a registered popover: drop it from the dismissal stack. Focus is only
 * moved when Escape cancelled it (see `openPopover`), so callers that need
 * focus back must ask for it explicitly. Safe to call for a root that is not
 * registered.
 * @param {HTMLElement|null|undefined} root
 * @returns {void}
 */
export function closePopover(root) {
  removeEntry(root);
}

/**
 * True when `root` is the top-most open popover — the only layer that handles
 * Escape and the next outside click.
 * @param {HTMLElement|null|undefined} root
 * @returns {boolean}
 */
export function isTopPopover(root) {
  const top = stack[stack.length - 1];
  return !!top && top.root === root;
}
