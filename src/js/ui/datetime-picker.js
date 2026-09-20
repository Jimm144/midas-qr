// @ts-check
/**
 * Date/time picker — enhances an `<input>` inside a `[data-datetime-field]`
 * wrapper with a date field (calendar popover) and a time field (typed text
 * input with a clock icon), mirroring the native pickers' look. The hidden
 * input stays the value store (`YYYY-MM-DDTHH:mm`), so hydration can
 * write/read it and listen for `input`/`change` to refresh the fields.
 */
import { openPopover, closePopover } from "./popover.js";

const DATE_PLACEHOLDER = "Select a date";
const TIME_PLACEHOLDER = "e.g., 2:30 PM";
/** @type {Record<string, number>} */
const KEY_DELTAS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

const ICON_CALENDAR =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>';
const ICON_CLOCK =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

/** @typedef {{ year: number, month: number, day: number, hour: number, minute: number }} DtParts */

/** Create an element with an optional class. @param {string} tag @param {string} [className] @returns {HTMLElement} */
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** @param {number} value @returns {string} */
function pad(value) {
  return String(value).padStart(2, "0");
}

/** Parse a `YYYY-MM-DDTHH:mm` value (local time, no timezone math). @param {string} value @returns {DtParts|null} */
function parseValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  return { year: +match[1], month: +match[2] - 1, day: +match[3], hour: +match[4], minute: +match[5] };
}

/** Parse typed time text ("2:30 PM", "14:30", "9am"). @param {string} text @returns {{hour: number, minute: number}|null} */
function parseTimeText(text) {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec((text || "").trim());
  if (!match) return null;
  let hour = +match[1];
  const minute = match[2] === undefined ? 0 : +match[2];
  if (minute > 59) return null;
  const suffix = (match[3] || "").toLowerCase();
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    hour = suffix === "am" ? (hour === 12 ? 0 : hour) : hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

/** @param {DtParts} parts @returns {string} */
function toInputValue(parts) {
  return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** @param {Date} date @returns {DtParts} */
function fromDate(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/** ISO `YYYY-MM-DD` for a Date or a parts object. @param {Date|DtParts} value @returns {string} */
function isoDate(value) {
  const parts =
    value instanceof Date
      ? { year: value.getFullYear(), month: value.getMonth(), day: value.getDate() }
      : value;
  return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}`;
}

/** First day of the week from the browser locale (0 = Sunday … 6 = Saturday). @returns {number} */
function localeFirstDay() {
  try {
    const locale = new Intl.Locale(navigator.language || "en");
    const probe = /** @type {{ weekInfo?: { firstDay?: number }, getWeekInfo?: () => { firstDay?: number } }} */ (
      /** @type {unknown} */ (locale)
    );
    const info = typeof probe.getWeekInfo === "function" ? probe.getWeekInfo() : probe.weekInfo;
    const first = info && typeof info.firstDay === "number" ? info.firstDay : 1;
    return first === 7 ? 0 : first; // 1=Mon … 7=Sun -> 0=Sun … 6=Sat
  } catch {
    return 1;
  }
}

const FIRST_DAY = localeFirstDay();
/** Two-letter weekday labels starting at the locale's first day (e.g. Su Mo …). */
const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, i) =>
  new Date(2023, 0, 1 + ((FIRST_DAY + i) % 7))
    .toLocaleDateString(undefined, { weekday: "short" })
    .slice(0, 2)
);

/** Date label for an input value ("Sep 17, 2026") or the date placeholder. @param {string} value @returns {string} */
function formatDateDisplay(value) {
  const parts = parseValue(value);
  if (!parts) return DATE_PLACEHOLDER;
  const date = new Date(parts.year, parts.month, parts.day);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Time text for an input value ("2:30 PM") or "" when unset. @param {string} value @returns {string} */
function formatTimeDisplay(value) {
  const parts = parseValue(value);
  if (!parts) return "";
  const date = new Date(parts.year, parts.month, parts.day, parts.hour, parts.minute);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Build the date trigger (calendar popover) and the time text input for one
 * field.
 * @param {HTMLElement} field
 * @param {HTMLInputElement} input
 */
function buildField(field, input) {
  field.classList.add("dt-field");
  input.classList.add("hidden");
  const baseLabel = input.getAttribute("aria-label") || "Date and time";

  const trigger = /** @type {HTMLButtonElement} */ (el("button", "dt-trigger dt-trigger-date btn-reset"));
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", `${baseLabel} (date)`);
  trigger.innerHTML = `<span class="dt-trigger-icon">${ICON_CALENDAR}</span><span class="dt-trigger-label is-placeholder">${DATE_PLACEHOLDER}</span>`;
  field.insertBefore(trigger, input);

  const timeField = el("div", "dt-time-field");
  const timeIcon = el("span", "dt-time-icon");
  timeIcon.innerHTML = ICON_CLOCK;
  const timeInput = /** @type {HTMLInputElement} */ (el("input", "dt-time-input"));
  timeInput.type = "text";
  timeInput.autocomplete = "off";
  timeInput.placeholder = TIME_PLACEHOLDER;
  timeInput.setAttribute("aria-label", `${baseLabel} (time)`);
  timeField.append(timeIcon, timeInput);
  field.insertBefore(timeField, input);

  const popover = el("div", "dt-popover dt-calendar-popover hidden");
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", `${baseLabel} calendar`);
  popover.innerHTML = `
    <div class="dt-header">
      <button type="button" class="dt-prev-year btn-reset" aria-label="Previous year">«</button>
      <button type="button" class="dt-prev btn-reset" aria-label="Previous month">‹</button>
      <div class="dt-month" aria-live="polite"></div>
      <button type="button" class="dt-next btn-reset" aria-label="Next month">›</button>
      <button type="button" class="dt-next-year btn-reset" aria-label="Next year">»</button>
    </div>
    <div class="dt-weekdays">${WEEKDAY_LABELS.map((name) => `<span class="dt-weekday">${name}</span>`).join("")}</div>
    <div class="dt-grid"></div>`;
  field.appendChild(popover);

  const prev = /** @type {HTMLButtonElement} */ (popover.querySelector(".dt-prev:not(.dt-prev-year)"));
  const next = /** @type {HTMLButtonElement} */ (popover.querySelector(".dt-next:not(.dt-next-year)"));
  const prevYear = /** @type {HTMLButtonElement} */ (popover.querySelector(".dt-prev-year"));
  const nextYear = /** @type {HTMLButtonElement} */ (popover.querySelector(".dt-next-year"));
  const monthLabel = /** @type {HTMLElement} */ (popover.querySelector(".dt-month"));
  const grid = /** @type {HTMLElement} */ (popover.querySelector(".dt-grid"));

  /** @type {DtParts|null} */
  let pending = null;
  let viewYear = 0;
  let viewMonth = 0;
  /** @type {Date|null} */
  let focusDay = null;

  const renderGrid = () => {
    const first = new Date(viewYear, viewMonth, 1);
    monthLabel.textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const offset = (first.getDay() - FIRST_DAY + 7) % 7;
    const cursor = new Date(viewYear, viewMonth, 1 - offset);
    const today = isoDate(new Date());
    let html = "";
    for (let i = 0; i < 42; i += 1) {
      const iso = isoDate(cursor);
      const outside = cursor.getMonth() !== viewMonth;
      const selected = !outside && pending && iso === isoDate(pending);
      const current = !outside && iso === today;
      const classes =
        `dt-day btn-reset${outside ? " outside" : ""}${selected ? " selected" : ""}${current ? " today" : ""}`;
      const label = cursor.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      const currentAttr = current ? ' aria-current="date"' : "";
      html += `<button type="button" class="${classes}" data-date="${iso}" tabindex="-1" aria-pressed="${selected ? "true" : "false"}" aria-label="${label}"${currentAttr}>${cursor.getDate()}</button>`;
      cursor.setDate(cursor.getDate() + 1);
    }
    grid.innerHTML = html;
    refreshDayTabindex();
  };

  /**
   * Roving tabindex for the day grid: exactly one in-month day is in the tab
   * order so Tab moves past the calendar instead of through 30 day buttons.
   * Arrow keys move both the focus cursor and the tab stop.
   */
  const refreshDayTabindex = () => {
    const activeIso = focusDay ? isoDate(focusDay) : pending ? isoDate(pending) : "";
    let matched = false;
    grid.querySelectorAll(".dt-day").forEach((node) => {
      const cell = /** @type {HTMLElement} */ (node);
      // Adjacent-month days are clickable but stay out of the tab order.
      if (cell.classList.contains("outside")) {
        cell.tabIndex = -1;
        return;
      }
      const isActive = cell.dataset.date === activeIso;
      if (isActive) matched = true;
      cell.tabIndex = isActive ? 0 : -1;
    });
    if (!matched) {
      const firstEnabled = grid.querySelector(".dt-day:not(.outside)");
      if (firstEnabled instanceof HTMLElement) firstEnabled.tabIndex = 0;
    }
  };

  /**
   * Write the value store and notify listeners (the input listeners refresh the
   * labels). @param {string} value
   */
  const write = (value) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close(false);
    trigger.focus();
  };

  /** Commit a clicked/keyboard day, keeping the stored time (00:00 when unset). @param {string} iso */
  const commitDay = (iso) => {
    const current = parseValue(input.value);
    const [year, month, day] = iso.split("-").map(Number);
    write(
      toInputValue({
        year,
        month: month - 1,
        day,
        hour: current ? current.hour : 0,
        minute: current ? current.minute : 0,
      })
    );
  };

  /**
   * Commit the typed time, keeping the stored date (today when unset). Invalid
   * text snaps back to the last committed time instead of clearing the store.
   */
  const commitTimeText = () => {
    const text = timeInput.value.trim();
    if (text === "") {
      timeInput.value = formatTimeDisplay(input.value);
      return;
    }
    const parsed = parseTimeText(text);
    if (!parsed) {
      timeInput.value = formatTimeDisplay(input.value);
      return;
    }
    const current = parseValue(input.value) || fromDate(new Date());
    input.value = toInputValue({ ...current, hour: parsed.hour, minute: parsed.minute });
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    timeInput.value = formatTimeDisplay(input.value);
  };

  /** @param {DtParts|null} parts */
  const applyPending = (parts) => {
    pending = parts;
    const base = parts || fromDate(new Date());
    viewYear = base.year;
    viewMonth = base.month;
    focusDay = new Date(base.year, base.month, base.day);
    renderGrid();
  };

  const openCalendar = () => {
    applyPending(parseValue(input.value));
    popover.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
    const selected = grid.querySelector(".dt-day.selected");
    if (selected instanceof HTMLElement) selected.focus();
    openPopover({
      root: field,
      anchor: trigger,
      onCancel: () => close(true),
      onOutsideClick: () => close(false),
    });
  };

  /** @param {boolean} focusTrigger */
  const close = (focusTrigger) => {
    popover.classList.add("hidden");
    trigger.setAttribute("aria-expanded", "false");
    closePopover(field);
    if (focusTrigger) trigger.focus();
  };

  /**
   * Keep the keyboard cursor inside the visible month after navigation so
   * arrow keys continue from the same day instead of jumping back.
   */
  const syncFocusDayToView = () => {
    if (!focusDay) return;
    const day = Math.min(focusDay.getDate(), new Date(viewYear, viewMonth + 1, 0).getDate());
    focusDay = new Date(viewYear, viewMonth, day);
  };

  /** @param {number} delta */
  const shiftMonth = (delta) => {
    viewMonth += delta;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    } else if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    syncFocusDayToView();
    renderGrid();
  };

  /** @param {number} delta */
  const shiftYear = (delta) => {
    viewYear += delta;
    syncFocusDayToView();
    renderGrid();
  };

  /** @param {Date} date */
  const focusCell = (date) => {
    const cell = grid.querySelector(`[data-date="${isoDate(date)}"]`);
    if (cell instanceof HTMLElement) {
      refreshDayTabindex();
      cell.tabIndex = 0;
      cell.focus();
    }
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    popover.classList.contains("hidden") ? openCalendar() : close(false);
  });
  trigger.addEventListener("keydown", (e) => {
    // Keyboard parity with a native picker: ArrowDown/ArrowUp opens the
    // calendar (Enter/Space already activate the trigger button).
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && popover.classList.contains("hidden")) {
      e.preventDefault();
      openCalendar();
    }
  });
  // Tabbing out of the field closes the calendar without committing. Checked
  // on a timeout because the browser moves focus only after keydown returns.
  field.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    setTimeout(() => {
      if (!field.contains(document.activeElement)) close(false);
    }, 0);
  });
  popover.addEventListener("click", (e) => {
    const target =
      e.target instanceof Element ? /** @type {HTMLButtonElement} */ (e.target.closest("button")) : null;
    if (!target) return;
    if (target === prev) shiftMonth(-1);
    else if (target === next) shiftMonth(1);
    else if (target === prevYear) shiftYear(-1);
    else if (target === nextYear) shiftYear(1);
    else if (target.dataset.date) commitDay(target.dataset.date);
  });
  popover.addEventListener("keydown", (e) => {
    if (popover.classList.contains("hidden") || !focusDay) return;
    const onGrid = e.target instanceof Element && e.target.closest(".dt-grid") !== null;
    if (!onGrid) return;
    const delta = KEY_DELTAS[e.key] || 0;
    if (delta === 0 && e.key !== "Enter") return;
    e.preventDefault();
    if (delta !== 0) {
      focusDay.setDate(focusDay.getDate() + delta);
      if (focusDay.getFullYear() !== viewYear || focusDay.getMonth() !== viewMonth) {
        viewYear = focusDay.getFullYear();
        viewMonth = focusDay.getMonth();
        renderGrid();
      }
      focusCell(focusDay);
    } else {
      commitDay(isoDate(focusDay));
    }
  });
  timeInput.addEventListener("change", commitTimeText);
  timeInput.addEventListener("blur", commitTimeText);
  timeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTimeText();
    }
  });
  input.addEventListener("input", () => syncDateTimeField(input));
  input.addEventListener("change", () => syncDateTimeField(input));
}

/** @param {Element} trigger @param {string} text @param {string} placeholder */
function setTriggerLabel(trigger, text, placeholder) {
  const label = trigger.querySelector(".dt-trigger-label");
  if (!label) return;
  label.textContent = text;
  label.classList.toggle("is-placeholder", text === placeholder);
}

/**
 * Re-read the stored value and refresh the date label and time text; mirror
 * the input's `aria-invalid`/`aria-describedby` onto both fields. Call after
 * programmatic value changes that do not fire events (e.g. state hydration).
 * @param {HTMLInputElement|null|undefined} input
 * @returns {void}
 */
export function syncDateTimeField(input) {
  if (!input) return;
  const field = input.closest("[data-datetime-field]");
  if (!field) return;
  const dateTrigger = field.querySelector(".dt-trigger-date");
  const timeInput = /** @type {HTMLInputElement|null} */ (field.querySelector(".dt-time-input"));
  if (!dateTrigger || !timeInput) return;
  setTriggerLabel(dateTrigger, formatDateDisplay(input.value), DATE_PLACEHOLDER);
  // Don't clobber what the user is currently typing.
  if (document.activeElement !== timeInput) {
    timeInput.value = formatTimeDisplay(input.value);
  }
  [dateTrigger, timeInput].forEach((node) => {
    ["aria-invalid", "aria-describedby"].forEach((attr) => {
      const value = input.getAttribute(attr);
      if (value === null) node.removeAttribute(attr);
      else node.setAttribute(attr, value);
    });
  });
}

/**
 * Initialize every `[data-datetime-field]` field under `root`.
 * Idempotent: fields already initialized are skipped.
 * @param {Document|Element} [root]
 * @returns {void}
 */
export function initDateTimePickers(root = document) {
  root.querySelectorAll("[data-datetime-field]").forEach((node) => {
    const field = /** @type {HTMLElement} */ (node);
    if (field.dataset.dtInit === "true") return;
    const input = field.querySelector("input");
    if (!(input instanceof HTMLInputElement)) return;
    buildField(field, input);
    // Marked only after a successful build so a throwing init can be retried.
    field.dataset.dtInit = "true";
    syncDateTimeField(input);
  });
}
