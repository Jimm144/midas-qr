// @ts-check
/**
 * Searchable select — enhances a native `<select>` inside a
 * `[data-searchable-select]` wrapper with a trigger button plus a searchable
 * listbox. The native select stays in the DOM as the value store.
 */
import { openPopover, closePopover } from "./popover.js";

let ssCounter = 0;

/** Create an element with an optional class.
 * @param {string} tag @param {string} [className] @returns {HTMLElement} */
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Case- and space-insensitive match key.
 * @param {string} text @returns {string} */
function matchKey(text) {
  return text.toLowerCase().replace(/\s+/g, "");
}

/** Escape text for safe interpolation into innerHTML.
 * @param {string} text @returns {string} */
function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      default:
        return "&quot;";
    }
  });
}

/**
 * Wrap the characters of `text` that participate in the whitespace-insensitive
 * match for `query` in `<mark>` runs. Returns HTML-escaped markup; an empty
 * query returns the escaped plain text.
 * @param {string} text
 * @param {string} query
 * @returns {string}
 */
export function highlightMatches(text, query) {
  const key = matchKey(query);
  if (!key) return escapeHtml(text);
  let out = "";
  let cursor = 0;
  let runStart = -1;
  let searchIdx = 0;
  for (let i = 0; i < text.length && searchIdx < key.length; i += 1) {
    const char = text[i];
    if (char.trim() === "") continue;
    if (char.toLowerCase() === key[searchIdx]) {
      if (runStart < 0) runStart = i;
      searchIdx += 1;
      if (searchIdx === key.length) {
        out += escapeHtml(text.slice(cursor, runStart));
        out += `<mark>${escapeHtml(text.slice(runStart, i + 1))}</mark>`;
        cursor = i + 1;
        runStart = -1;
      }
    } else if (runStart >= 0) {
      // The query skipped this char: close the run that preceded it.
      out += escapeHtml(text.slice(cursor, runStart));
      out += `<mark>${escapeHtml(text.slice(runStart, i))}</mark>`;
      cursor = i;
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    // Partial match (the caller hides non-matching options, so this is only
    // reached defensively): mark what matched so far.
    out += escapeHtml(text.slice(cursor, runStart));
    out += `<mark>${escapeHtml(text.slice(runStart))}</mark>`;
    return out;
  }
  out += escapeHtml(text.slice(cursor));
  return out;
}

/** Hide one field's popover and reset its trigger state. @param {HTMLElement} field */
function closeListbox(field) {
  const popover = field.querySelector(".ss-popover");
  if (!popover || popover.classList.contains("hidden")) return;
  popover.classList.add("hidden");
  const trigger = field.querySelector(".ss-trigger");
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  closePopover(field);
}

/** Close every searchable-select popover except the one inside `keep`. @param {HTMLElement|null} keep */
function closeOtherPopovers(keep) {
  document.querySelectorAll("[data-searchable-select]").forEach((node) => {
    if (/** @type {HTMLElement} */ (node) !== keep) closeListbox(/** @type {HTMLElement} */ (node));
  });
}

/**
 * Refresh a searchable select's trigger label and option selection state from
 * its native select. Call after programmatic value changes that do not fire a
 * change event (e.g. state hydration).
 * @param {HTMLSelectElement|null|undefined} select
 * @returns {void}
 */
export function syncSearchableSelect(select) {
  if (!select) return;
  const field = select.closest("[data-searchable-select]");
  if (!field) return;
  const trigger = field.querySelector(".ss-trigger");
  const list = field.querySelector(".ss-list");
  const option = select.options[select.selectedIndex];
  if (trigger) trigger.textContent = option ? option.text : "";
  if (!list) return;
  list.querySelectorAll(".ss-option").forEach((node) => {
    const optionEl = /** @type {HTMLElement} */ (node);
    const isSelected = Number(optionEl.dataset.index) === select.selectedIndex;
    optionEl.classList.toggle("selected", isSelected);
    optionEl.setAttribute("aria-selected", isSelected ? "true" : "false");
  });
}

/**
 * Build the trigger, search box and option list for one field.
 * @param {HTMLElement} field
 * @param {HTMLSelectElement} select
 */
function buildField(field, select) {
  field.classList.add("ss-field");
  select.classList.add("hidden");
  const selectLabel = select.getAttribute("aria-label");

  const trigger = /** @type {HTMLButtonElement} */ (el("button", "ss-trigger btn-reset"));
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  field.insertBefore(trigger, select);

  const popover = el("div", "ss-popover hidden");
  const search = /** @type {HTMLInputElement} */ (el("input", "ss-search"));
  search.type = "search";
  search.placeholder = "Search";
  search.setAttribute("aria-label", selectLabel || "Search");
  // The magnifier is drawn by CSS (mask + currentColor) so it follows the
  // theme without an extra inline SVG node.
  const searchWrap = el("div", "ss-search-wrap");
  searchWrap.appendChild(search);

  const list = el("div", "ss-list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", selectLabel || "Options");
  // Stable ids even when the source select has no id, so the combobox can
  // reference the listbox and its active option (aria-activedescendant).
  const selectId = select.id || `searchable-select-${ssCounter++}`;
  const listId = `${selectId}-ss-list`;
  list.id = listId;
  trigger.setAttribute("aria-controls", listId);

  // The search box is the combobox: focus stays on it while the arrow keys
  // move a virtual active option, which assistive tech announces through
  // aria-activedescendant.
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-haspopup", "listbox");
  search.setAttribute("aria-controls", listId);
  search.setAttribute("aria-expanded", "false");
  search.setAttribute("aria-autocomplete", "list");

  const empty = el("div", "ss-empty hidden");
  empty.textContent = "No matches";

  const status = el("div", "ss-status sr-only");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  /** @type {HTMLElement[]} */
  const optionEls = Array.from(select.options).map((option, index) => {
    const optionEl = el("div", "ss-option");
    optionEl.setAttribute("role", "option");
    optionEl.setAttribute("aria-selected", "false");
    optionEl.id = `${listId}-option-${index}`;
    optionEl.dataset.index = String(index);
    // Keep the pristine label: rendering the <mark> highlight overwrites
    // textContent and later filtering must still see the original text.
    optionEl.dataset.text = option.text;
    optionEl.textContent = option.text;
    if (option.dataset.font) optionEl.style.fontFamily = option.dataset.font;
    if (option.disabled) optionEl.setAttribute("aria-disabled", "true");
    list.appendChild(optionEl);
    return optionEl;
  });

  popover.append(searchWrap, list, empty, status);
  field.appendChild(popover);

  let activeIndex = -1;

  /** @returns {HTMLElement[]} */
  const visibleOptions = () =>
    optionEls.filter(
      (item) => !item.classList.contains("hidden") && item.getAttribute("aria-disabled") !== "true"
    );

  /** @param {number} index */
  const setActive = (index) => {
    activeIndex = index;
    visibleOptions().forEach((item, i) => item.classList.toggle("active", i === activeIndex));
    const active = visibleOptions()[activeIndex];
    if (active) {
      search.setAttribute("aria-activedescendant", active.id);
      if (typeof active.scrollIntoView === "function") active.scrollIntoView({ block: "nearest" });
    } else {
      search.removeAttribute("aria-activedescendant");
    }
  };

  /** @param {string} query */
  const applyFilter = (query) => {
    const key = matchKey(query);
    let matches = 0;
    optionEls.forEach((item) => {
      const label = item.dataset.text || "";
      const isMatch = !key || matchKey(label).includes(key);
      item.classList.toggle("hidden", !isMatch);
      item.innerHTML = highlightMatches(label, query);
      if (isMatch) matches += 1;
    });
    empty.classList.toggle("hidden", matches > 0);
    // Announce the result count only while a query is active, so the
    // aria-live region stays quiet when the list is simply reopened.
    status.textContent = key ? (matches === 1 ? "1 match" : `${matches} matches`) : "";
    setActive(-1);
  };

  /** @param {number} delta */
  const moveActive = (delta) => {
    const visible = visibleOptions();
    if (!visible.length) return;
    let next = activeIndex === -1 ? (delta > 0 ? 0 : visible.length - 1) : activeIndex + delta;
    if (next < 0) next = visible.length - 1;
    if (next >= visible.length) next = 0;
    setActive(next);
  };

  const open = () => {
    closeOtherPopovers(field);
    popover.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
    search.setAttribute("aria-expanded", "true");
    search.value = "";
    applyFilter("");
    search.focus();
    // Outside clicks only hide the listbox; Escape closes it and returns focus
    // to the trigger, matching the keyboard path.
    openPopover({
      root: field,
      anchor: trigger,
      onCancel: () => close(true),
      onOutsideClick: () => closeListbox(field),
    });
  };

  /** @param {boolean} focusTrigger */
  const close = (focusTrigger) => {
    popover.classList.add("hidden");
    trigger.setAttribute("aria-expanded", "false");
    search.setAttribute("aria-expanded", "false");
    setActive(-1);
    closePopover(field);
    if (focusTrigger) trigger.focus();
  };

  /** @param {number} index */
  const pick = (index) => {
    const option = select.options[index];
    if (!option || option.disabled) return;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    syncSearchableSelect(select);
    close(true);
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popover.classList.contains("hidden")) open();
    else close(false);
  });
  trigger.addEventListener("keydown", (e) => {
    // WAI-ARIA combobox parity: arrows open the listbox and move the active
    // option, Home/End jump to the ends.
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (popover.classList.contains("hidden")) open();
      moveActive(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Home" || e.key === "End") {
      const visible = visibleOptions();
      if (visible.length === 0) return;
      e.preventDefault();
      if (popover.classList.contains("hidden")) open();
      setActive(e.key === "Home" ? 0 : visible.length - 1);
    }
  });
  search.addEventListener("input", () => applyFilter(search.value));
  list.addEventListener("click", (e) => {
    const optionEl = e.target instanceof Element ? e.target.closest(".ss-option") : null;
    if (optionEl instanceof HTMLElement) pick(Number(optionEl.dataset.index));
  });
  popover.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      // Enter picks the highlighted option, or the first visible match when
      // typing narrowed the list without arrowing into it (e.g. typing the
      // exact name and hitting Enter).
      const visible = visibleOptions();
      const active = visible[activeIndex] || visible[0];
      if (active) {
        e.preventDefault();
        pick(Number(active.dataset.index));
      }
    }
  });
  // Keep focus on the search box while clicking an option: without this the
  // pointerdown would blur the input before the click lands. Clicks inside
  // the search box itself keep native caret placement and selection behaviour.
  popover.addEventListener("mousedown", (e) => {
    if (e.target instanceof Node && search.contains(e.target)) return;
    e.preventDefault();
  });
  // Tabbing out of the field closes the listbox. Checked on a timeout because
  // the browser moves focus only after the keydown handler returns.
  field.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    setTimeout(() => {
      if (!field.contains(document.activeElement)) close(false);
    }, 0);
  });
  select.addEventListener("change", () => syncSearchableSelect(select));
}

/**
 * Initialize every `[data-searchable-select]` wrapper under `root`.
 * Idempotent: wrappers already initialized are skipped.
 * @param {Document|Element} [root]
 * @returns {void}
 */
export function initSearchableSelects(root = document) {
  root.querySelectorAll("[data-searchable-select]").forEach((node) => {
    const field = /** @type {HTMLElement} */ (node);
    if (field.dataset.ssInit === "true") return;
    const select = field.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) return;
    buildField(field, select);
    // Marked only after a successful build so a throwing init can be retried.
    field.dataset.ssInit = "true";
    syncSearchableSelect(select);
  });
}
