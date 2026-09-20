import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDateTimePickers, syncDateTimeField } from "../src/js/ui/datetime-picker.js";

function buildField() {
  const field = document.createElement("div");
  field.setAttribute("data-datetime-field", "");
  field.innerHTML = `<label for="dt-test-input">Start</label><input id="dt-test-input" aria-label="Start date" />`;
  document.body.appendChild(field);
  return field;
}

function dateFor(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  const date = new Date(+match[1], +match[2] - 1, +match[3]);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function timeFor(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  const date = new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

describe("datetime-picker", () => {
  /** @type {HTMLElement} */
  let field;
  /** @type {HTMLInputElement} */
  let input;

  const trigger = () => field.querySelector(".dt-trigger-date");
  const timeInput = () => field.querySelector(".dt-time-input");
  const popover = () => field.querySelector(".dt-calendar-popover");
  const dayCell = (iso) => field.querySelector(`.dt-day[data-date="${iso}"]`);

  beforeEach(() => {
    field = buildField();
    input = field.querySelector("input");
    initDateTimePickers(document);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("builds a date trigger and a typed time field, hides the input and is idempotent", () => {
    expect(trigger().textContent).toBe("Select a date");
    expect(trigger().querySelector(".dt-trigger-label").classList.contains("is-placeholder")).toBe(true);
    expect(timeInput().getAttribute("placeholder")).toBe("e.g., 2:30 PM");
    expect(timeInput().value).toBe("");
    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(input.classList.contains("hidden")).toBe(true);
    expect(popover().classList.contains("hidden")).toBe(true);
    expect(popover().getAttribute("role")).toBe("dialog");
    initDateTimePickers(document);
    expect(field.querySelectorAll(".dt-trigger")).toHaveLength(1);
    expect(field.querySelectorAll(".dt-time-input")).toHaveLength(1);
  });

  it("opens a footer-less calendar with a stable 6x7 grid and no selection when empty", () => {
    trigger().click();
    expect(popover().classList.contains("hidden")).toBe(false);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(popover().querySelector(".dt-footer")).toBeNull();
    const now = new Date();
    expect(field.querySelector(".dt-month").textContent).toBe(
      now.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    );
    const cells = field.querySelectorAll(".dt-grid .dt-day");
    expect(cells).toHaveLength(42);
    expect(Array.from(cells).every((cell) => cell.tagName === "BUTTON")).toBe(true);
    expect(popover().querySelector(".dt-day.selected")).toBeNull();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
    expect(dayCell(todayIso).getAttribute("aria-current")).toBe("date");
  });

  it("shows adjacent-month days grayed and clickable, out of the tab order", () => {
    trigger().click();
    const outside = Array.from(field.querySelectorAll(".dt-grid .dt-day.outside"));
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.every((cell) => cell.getAttribute("aria-label"))).toBe(true);
    expect(outside.every((cell) => cell.tabIndex === -1)).toBe(true);
    // Exactly one in-month day holds the roving tab stop.
    expect(field.querySelectorAll('.dt-day:not(.outside)[tabindex="0"]')).toHaveLength(1);
    const first = /** @type {HTMLElement} */ (outside[0]);
    expect(first.getAttribute("aria-hidden")).toBeNull();
  });

  it("opens on the stored month and marks the stored day", () => {
    input.value = "2026-09-17T14:30";
    syncDateTimeField(input);
    trigger().click();
    expect(field.querySelector(".dt-month").textContent).toBe(
      new Date(2026, 8, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    );
    expect(dayCell("2026-09-17").classList.contains("selected")).toBe(true);
    expect(dayCell("2026-09-17").getAttribute("aria-pressed")).toBe("true");
    expect(timeInput().value).toBe(timeFor("2026-09-17T14:30"));
  });

  it("commits a clicked day with the stored time and closes", () => {
    input.value = "2026-09-17T14:30";
    syncDateTimeField(input);
    const onInput = vi.fn();
    const onChange = vi.fn();
    input.addEventListener("input", onInput);
    input.addEventListener("change", onChange);
    trigger().click();
    dayCell("2026-09-05").click();
    expect(input.value).toBe("2026-09-05T14:30");
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(popover().classList.contains("hidden")).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().textContent).toBe(dateFor("2026-09-05T14:30"));
    expect(timeInput().value).toBe(timeFor("2026-09-05T14:30"));
    expect(document.activeElement).toBe(trigger());
  });

  it("commits a clicked adjacent-month day", () => {
    trigger().click();
    const outside = /** @type {HTMLElement} */ (field.querySelector(".dt-grid .dt-day.outside"));
    const iso = outside.dataset.date;
    outside.click();
    expect(input.value.startsWith(`${iso}T`)).toBe(true);
    expect(popover().classList.contains("hidden")).toBe(true);
    expect(trigger().textContent).toBe(dateFor(input.value));
  });

  it("defaults the time to 00:00 when only a date is picked", () => {
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
    trigger().click();
    dayCell(todayIso).click();
    expect(input.value).toBe(`${todayIso}T00:00`);
    expect(timeInput().value).toBe(timeFor(input.value));
  });

  it("does not commit on outside clicks or Escape", () => {
    input.value = "2026-09-17T14:30";
    trigger().click();
    field.querySelector(".dt-next").click();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(popover().classList.contains("hidden")).toBe(true);
    expect(input.value).toBe("2026-09-17T14:30");

    trigger().click();
    popover().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover().classList.contains("hidden")).toBe(true);
    expect(input.value).toBe("2026-09-17T14:30");
    expect(document.activeElement).toBe(trigger());
  });

  it("arrow keys move the focused day and Enter commits it", () => {
    input.value = "2026-09-17T14:30";
    trigger().click();
    expect(document.activeElement).toBe(dayCell("2026-09-17"));
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(dayCell("2026-09-18"));
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(input.value).toBe("2026-09-18T14:30");
    expect(popover().classList.contains("hidden")).toBe(true);
  });

  it("year and month buttons shift the view", () => {
    input.value = "2026-09-17T14:30";
    syncDateTimeField(input);
    trigger().click();
    expect(field.querySelector(".dt-next-year").getAttribute("aria-label")).toBe("Next year");
    expect(field.querySelector(".dt-prev-year").getAttribute("aria-label")).toBe("Previous year");
    field.querySelector(".dt-next-year").click();
    expect(field.querySelector(".dt-month").textContent).toBe(
      new Date(2027, 8, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    );
    field.querySelector(".dt-prev-year").click();
    expect(dayCell("2026-09-17").classList.contains("selected")).toBe(true);
    field.querySelector(".dt-next").click();
    expect(field.querySelector(".dt-month").textContent).toBe(
      new Date(2026, 9, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    );
    field.querySelector(".dt-prev").click();
    expect(dayCell("2026-09-17").classList.contains("selected")).toBe(true);
  });

  it("arrow keys continue from the same day after month navigation", () => {
    input.value = "2026-09-17T14:30";
    trigger().click();
    field.querySelector(".dt-next").click();
    const grid = field.querySelector(".dt-grid");
    grid.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(field.querySelector(".dt-month").textContent).toBe(
      new Date(2026, 9, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    );
    expect(document.activeElement).toBe(dayCell("2026-10-18"));
  });

  it("closes when Tab moves focus out of the field", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    input.value = "2026-09-17T14:30";
    trigger().click();
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    outside.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(popover().classList.contains("hidden")).toBe(true);
    expect(input.value).toBe("2026-09-17T14:30");
  });

  it("only swallows Escape while the calendar is open", () => {
    const onDocumentEscape = vi.fn();
    document.addEventListener("keydown", onDocumentEscape);

    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onDocumentEscape).toHaveBeenCalledTimes(1);

    trigger().click();
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onDocumentEscape).toHaveBeenCalledTimes(1);
    expect(popover().classList.contains("hidden")).toBe(true);

    document.removeEventListener("keydown", onDocumentEscape);
  });

  it("syncDateTimeField and input events refresh the date label and time text", () => {
    expect(trigger().textContent).toBe("Select a date");
    expect(timeInput().value).toBe("");
    input.value = "2026-12-01T08:05";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(trigger().textContent).toBe(dateFor("2026-12-01T08:05"));
    expect(timeInput().value).toBe(timeFor("2026-12-01T08:05"));
    input.value = "2027-01-02T23:59";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(trigger().textContent).toBe(dateFor("2027-01-02T23:59"));
    expect(timeInput().value).toBe(timeFor("2027-01-02T23:59"));
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", "hint-1");
    syncDateTimeField(input);
    expect(trigger().getAttribute("aria-invalid")).toBe("true");
    expect(trigger().getAttribute("aria-describedby")).toBe("hint-1");
    expect(timeInput().getAttribute("aria-invalid")).toBe("true");
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    syncDateTimeField(input);
    expect(trigger().hasAttribute("aria-invalid")).toBe(false);
    expect(timeInput().hasAttribute("aria-describedby")).toBe(false);
    input.value = "";
    syncDateTimeField(input);
    expect(trigger().textContent).toBe("Select a date");
    expect(timeInput().value).toBe("");
  });
});

describe("datetime-picker typed time", () => {
  /** @type {HTMLElement} */
  let field;
  /** @type {HTMLInputElement} */
  let input;

  const timeInput = () => field.querySelector(".dt-time-input");

  beforeEach(() => {
    field = buildField();
    input = field.querySelector("input");
    initDateTimePickers(document);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("parses 12-hour text with a meridiem", () => {
    input.value = "2026-09-17T14:30";
    syncDateTimeField(input);
    timeInput().value = "2:30 PM";
    timeInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("2026-09-17T14:30");
    timeInput().value = "7:05pm";
    timeInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("2026-09-17T19:05");
    timeInput().value = "12:15 AM";
    timeInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("2026-09-17T00:15");
    timeInput().value = "12:15 PM";
    timeInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("2026-09-17T12:15");
  });

  it("parses 24-hour text and bare hours", () => {
    input.value = "2026-09-17T14:30";
    syncDateTimeField(input);
    timeInput().value = "9:05";
    timeInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("2026-09-17T09:05");
    timeInput().value = "9am";
    timeInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("2026-09-17T09:00");
    timeInput().value = "21";
    timeInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("2026-09-17T21:00");
  });

  it("defaults the date to today when only a time is typed", () => {
    timeInput().value = "8:15 AM";
    timeInput().dispatchEvent(new Event("change", { bubbles: true }));
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
    expect(input.value).toBe(`${today}T08:15`);
  });

  it("snaps invalid or empty text back to the stored time", () => {
    input.value = "2026-09-17T14:30";
    syncDateTimeField(input);
    timeInput().value = "not a time";
    timeInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("2026-09-17T14:30");
    expect(timeInput().value).toBe(timeFor("2026-09-17T14:30"));
    timeInput().value = "25:00";
    timeInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("2026-09-17T14:30");
    timeInput().value = "";
    timeInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("2026-09-17T14:30");
    expect(timeInput().value).toBe(timeFor("2026-09-17T14:30"));
  });

  it("dispatches input and change when the text parses", () => {
    input.value = "2026-09-17T14:30";
    syncDateTimeField(input);
    const onInput = vi.fn();
    const onChange = vi.fn();
    input.addEventListener("input", onInput);
    input.addEventListener("change", onChange);
    timeInput().value = "6:45 PM";
    timeInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("2026-09-17T18:45");
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
