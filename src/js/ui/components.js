import { openPopover, closePopover } from "./popover.js";

let selectCounter = 0;

/** Close one wrapper's dropdown and drop it from the popover dismissal stack. @param {Element} wrapper */
function closeSelectWrapper(wrapper) {
  wrapper.classList.remove("open");
  const trigger = wrapper.querySelector(".custom-select-trigger");
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  closePopover(wrapper);
}

/** Close every open custom select; used before another anchored popup opens. */
export function closeOpenCustomSelects() {
  document.querySelectorAll(".custom-select-wrapper.open").forEach((wrapper) => {
    closeSelectWrapper(wrapper);
  });
}

/** Wire every custom-select wrapper currently in the document. */
export function initCustomSelects() {
  document.querySelectorAll(".custom-select-wrapper").forEach((wrapper) => {
    const select = wrapper.querySelector("select");
    if (select) initCustomSelect(select);
  });
}

/**
 * Wire one native select to its custom-select wrapper: listbox ids/labels,
 * trigger combobox semantics, delegated option clicks and keyboard handling.
 * Idempotent per wrapper.
 * @param {HTMLSelectElement|null|undefined} select
 */
export function initCustomSelect(select) {
  if (!select) return;
  const wrapper = select.closest(".custom-select-wrapper");
  if (!wrapper) return;
  // Idempotent: a second init call must not stack duplicate listeners.
  if (wrapper.dataset.csInit === "true") return;
  const trigger = wrapper.querySelector(".custom-select-trigger");
  const optionsDiv = wrapper.querySelector(".custom-select-options");
  if (!trigger || !optionsDiv) return;
  wrapper.dataset.csInit = "true";

  const selectId = select.id || `custom-select-${selectCounter++}`;
  const listboxId = `${selectId}-listbox`;
  optionsDiv.id = listboxId;

  const label =
    wrapper.getAttribute("data-label") ||
    select.getAttribute("aria-label") ||
    select.options[select.selectedIndex]?.text ||
    "Option";

  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-controls", listboxId);
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", label);
  if (!trigger.hasAttribute("tabindex")) trigger.setAttribute("tabindex", "0");

  optionsDiv.setAttribute("role", "listbox");
  optionsDiv.setAttribute("aria-label", `${label} options`);

  Array.from(optionsDiv.children).forEach((optDiv, idx) => {
    optDiv.setAttribute("role", "option");
    optDiv.setAttribute("id", `${listboxId}-option-${idx}`);
    optDiv.setAttribute("aria-selected", idx === select.selectedIndex ? "true" : "false");
    if (select.options[idx] && select.options[idx].disabled) optDiv.setAttribute("aria-disabled", "true");
  });

  const updateTrigger = () => syncCustomSelect(select);

  updateTrigger();
  select.addEventListener("change", updateTrigger);

  // Delegated on the listbox so options rebuilt by refreshCustomSelect stay
  // live without rebinding handlers to the new nodes.
  optionsDiv.addEventListener("click", (e) => {
    const optDiv = e.target instanceof Element ? e.target.closest("[data-index]") : null;
    if (!optDiv || !optionsDiv.contains(optDiv)) return;
    e.stopPropagation();
    const idx = parseInt(optDiv.getAttribute("data-index"), 10);
    if (isNaN(idx) || !select.options[idx] || select.options[idx].disabled) return;
    select.selectedIndex = idx;
    updateTrigger();
    closeDropdown();
    select.dispatchEvent(new Event("change"));
  });

  const openDropdown = () => {
    document.querySelectorAll(".custom-select-wrapper").forEach((w) => {
      if (w !== wrapper) closeSelectWrapper(w);
    });
    wrapper.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    // Outside clicks and Escape both just close; focus stays where it is.
    openPopover({ root: wrapper, anchor: trigger, onCancel: closeDropdown });
  };

  const closeDropdown = () => {
    closeSelectWrapper(wrapper);
  };

  const toggleDropdown = (e) => {
    e.stopPropagation();
    if (wrapper.classList.contains("open")) closeDropdown();
    else openDropdown();
  };

  /** True when an option is not selectable from the keyboard right now. */
  const isUnselectable = (idx) => {
    const optDiv = optionsDiv.children[idx];
    const option = select.options[idx];
    if (!option) return true;
    const isHidden =
      optDiv &&
      (optDiv.classList.contains("hidden") ||
        (optDiv.classList.contains("full-only") &&
          document.querySelector(".full-only")?.classList.contains("hidden")));
    return !!isHidden || option.disabled;
  };

  /** Move to the next selectable option in `dir` (wraps around). */
  const moveSelection = (dir) => {
    const count = select.options.length;
    if (count === 0) return;
    let newIdx = select.selectedIndex + dir;
    for (let step = 0; step < count; step += 1) {
      if (newIdx < 0) newIdx = count - 1;
      if (newIdx >= count) newIdx = 0;
      if (!isUnselectable(newIdx)) {
        select.selectedIndex = newIdx;
        updateTrigger();
        select.dispatchEvent(new Event("change"));
        return;
      }
      newIdx += dir;
    }
  };

  trigger.addEventListener("click", toggleDropdown);
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleDropdown(e);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      // Matching the native select: arrows also open the listbox so the
      // current option becomes visible while it is being changed.
      if (!wrapper.classList.contains("open")) openDropdown();
      if (e.key === "Home" || e.key === "End") {
        const target = e.key === "Home" ? 0 : select.options.length - 1;
        const step = e.key === "Home" ? 1 : -1;
        if (!isUnselectable(target)) {
          select.selectedIndex = target;
          updateTrigger();
          select.dispatchEvent(new Event("change"));
        } else {
          moveSelection(step);
        }
      } else {
        moveSelection(e.key === "ArrowDown" ? 1 : -1);
      }
    } else if (e.key === "Tab") {
      // The trigger is the only focusable part of the combobox; tabbing
      // away must not leave the listbox open under a released focus.
      closeDropdown();
    }
  });
}

/**
 * Re-read a select's native <option> list into its wrapper: rebuild the option
 * elements when they no longer match, then repaint trigger text, highlight and
 * aria-selected through syncCustomSelect. Used after runtime option changes
 * (camera enumeration, state hydration) that bypass initCustomSelect.
 * @param {HTMLSelectElement|null|undefined} select
 */
export function refreshCustomSelect(select) {
  if (!select) return;
  const wrapper = select.closest(".custom-select-wrapper");
  if (!wrapper) return;
  const optionsDiv = wrapper.querySelector(".custom-select-options");
  if (!optionsDiv) return;

  const optionEls = Array.from(optionsDiv.children);
  const options = Array.from(select.options);
  const aligned =
    optionEls.length === options.length &&
    options.every(
      (opt, idx) =>
        optionEls[idx].getAttribute("data-index") === String(idx) &&
        optionEls[idx].textContent.trim() === opt.text.trim()
    );

  if (!aligned) {
    optionsDiv.innerHTML = "";
    options.forEach((opt, idx) => {
      const optDiv = document.createElement("div");
      // Matches the markup the scanner used to rebuild by hand.
      optDiv.className = "custom-select-option text-xs font-bold" + (opt.selected ? " selected" : "");
      optDiv.setAttribute("data-index", idx);
      optDiv.setAttribute("role", "option");
      optDiv.setAttribute("aria-selected", opt.selected ? "true" : "false");
      optDiv.textContent = opt.textContent;
      optionsDiv.appendChild(optDiv);
    });
  }

  syncCustomSelect(select);
}

/**
 * Refresh a custom select's trigger label/icon and option selection state
 * from its native select. Also used after programmatic value changes
 * (e.g. state hydration) that intentionally do not fire a change event.
 * @param {HTMLSelectElement|null|undefined} select
 */
export function syncCustomSelect(select) {
  if (!select) return;
  const wrapper = select.closest(".custom-select-wrapper");
  if (!wrapper) return;
  const trigger = wrapper.querySelector(".custom-select-trigger");
  const optionsDiv = wrapper.querySelector(".custom-select-options");
  if (!trigger || !optionsDiv) return;
  const optionEls = Array.from(optionsDiv.children);
  const selectedOptEl = optionEls[select.selectedIndex];
  const optText = select.options[select.selectedIndex]?.text || "";
  const iconEl = selectedOptEl ? selectedOptEl.querySelector("svg, .theme-dot") : null;

  if (iconEl) {
    trigger.innerHTML = "";
    const span = document.createElement("span");
    span.className = "trigger-content flex items-center gap-2 overflow-hidden text-ellipsis";
    span.appendChild(iconEl.cloneNode(true));
    const txtNode = document.createElement("span");
    txtNode.className = "truncate";
    txtNode.textContent = optText;
    span.appendChild(txtNode);
    trigger.appendChild(span);
  } else {
    trigger.textContent = optText;
  }

  const listboxId = optionsDiv.id || `${select.id}-listbox`;
  if (selectedOptEl && select.selectedIndex >= 0) {
    trigger.setAttribute("aria-activedescendant", `${listboxId}-option-${select.selectedIndex}`);
  } else {
    // No matching option element (e.g. selectedIndex -1): a dangling
    // activedescendant id would break screen-reader navigation.
    trigger.removeAttribute("aria-activedescendant");
  }
  optionEls.forEach((c, idx) => {
    const selected = idx === select.selectedIndex;
    c.classList.toggle("selected", selected);
    c.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

/** Per-button flash bookkeeping so repeat flashes restore the pristine label. */
const flashStates = new WeakMap();

/**
 * Temporarily swap a button's label + feedback classes, restoring both after
 * `ms`. Used by the copy/save/download feedback patterns across the app.
 * @param {HTMLElement|null|undefined} btn
 * @param {string} label
 * @param {number} [ms]
 * @param {string[]} [classes]
 */
export function flashButton(btn, label, ms = 1500, classes = ["bg-white", "text-black"]) {
  if (!btn || !btn.classList) return;
  const applied = Array.isArray(classes) ? classes.slice() : [];
  let state = flashStates.get(btn);
  if (!state) {
    state = { label: btn.textContent || "", classes: [], timer: null };
    flashStates.set(btn, state);
  }
  // Re-flashing before the timer fires must not capture the flash label as
  // the "original": always restore the label captured on the first flash.
  if (state.timer !== null) clearTimeout(state.timer);
  if (state.classes.length) btn.classList.remove(...state.classes);
  state.classes = applied;
  btn.textContent = label;
  if (applied.length) btn.classList.add(...applied);
  state.timer = setTimeout(() => {
    btn.textContent = state.label;
    if (applied.length) btn.classList.remove(...applied);
    state.classes = [];
    state.timer = null;
  }, ms);
}
