import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initSearchableSelects,
  syncSearchableSelect,
  highlightMatches,
} from "../src/js/ui/searchable-select.js";

function buildField() {
  const field = document.createElement("div");
  field.setAttribute("data-searchable-select", "");
  field.innerHTML = `
    <select aria-label="Font family">
      <option value="inter">Inter</option>
      <option value="space grotesk" data-font="'Space Grotesk', sans-serif">Space Grotesk</option>
      <option value="figtree">Figtree</option>
    </select>`;
  document.body.appendChild(field);
  return field;
}

describe("searchable-select", () => {
  /** @type {HTMLElement} */
  let field;
  /** @type {HTMLSelectElement} */
  let select;

  const trigger = () => field.querySelector(".ss-trigger");
  const popover = () => field.querySelector(".ss-popover");
  const search = () => field.querySelector(".ss-search");
  const options = () => Array.from(field.querySelectorAll(".ss-option"));
  const visibleOptions = () => options().filter((el) => !el.classList.contains("hidden"));

  beforeEach(() => {
    field = buildField();
    select = field.querySelector("select");
    initSearchableSelects(document);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("builds trigger, search input and option list from the select", () => {
    expect(trigger().textContent).toBe("Inter");
    expect(trigger().getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(select.classList.contains("hidden")).toBe(true);
    expect(search().type).toBe("search");
    expect(search().placeholder).toBe("Search");
    expect(search().getAttribute("aria-label")).toBe("Font family");
    expect(field.querySelector(".ss-list").getAttribute("role")).toBe("listbox");
    expect(options().map((el) => el.textContent)).toEqual(["Inter", "Space Grotesk", "Figtree"]);
    expect(options().every((el) => el.getAttribute("role") === "option")).toBe(true);
    expect(options()[0].classList.contains("selected")).toBe(true);
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    expect(popover().classList.contains("hidden")).toBe(true);
    expect(options()[1].style.fontFamily).toContain("Space Grotesk");
  });

  it("is idempotent across repeated init calls", () => {
    initSearchableSelects(document);
    expect(field.querySelectorAll(".ss-trigger")).toHaveLength(1);
    expect(options()).toHaveLength(3);
  });

  it("toggles the popover from the trigger and resets the filter on reopen", () => {
    trigger().click();
    expect(popover().classList.contains("hidden")).toBe(false);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    search().value = "fig";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    expect(visibleOptions()).toHaveLength(1);
    trigger().click();
    expect(popover().classList.contains("hidden")).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    trigger().click();
    expect(search().value).toBe("");
    expect(visibleOptions()).toHaveLength(3);
  });

  it("filters case-insensitively and ignores spaces", () => {
    trigger().click();
    search().value = "SPACE gro";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    expect(visibleOptions().map((el) => el.textContent)).toEqual(["Space Grotesk"]);
  });

  it("shows an empty message when nothing matches", () => {
    trigger().click();
    search().value = "zzz";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    expect(visibleOptions()).toHaveLength(0);
    expect(field.querySelector(".ss-empty").classList.contains("hidden")).toBe(false);
    expect(field.querySelector(".ss-empty").textContent).toBe("No matches");
  });

  it("picks an option, updates the select and fires a bubbling change", () => {
    const onChange = vi.fn();
    field.addEventListener("change", onChange);
    trigger().click();
    options()[2].click();
    expect(select.value).toBe("figtree");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(trigger().textContent).toBe("Figtree");
    expect(options()[2].classList.contains("selected")).toBe(true);
    expect(options()[0].classList.contains("selected")).toBe(false);
    expect(popover().classList.contains("hidden")).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it("moves the active highlight with the arrow keys and picks with Enter", () => {
    trigger().click();
    const input = search();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(options()[1].classList.contains("active")).toBe(true);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(select.value).toBe("space grotesk");
    expect(popover().classList.contains("hidden")).toBe(true);
  });

  it("picks the first visible match with Enter when nothing is highlighted", () => {
    trigger().click();
    const input = search();
    input.value = "fig";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(select.value).toBe("figtree");
    expect(trigger().textContent).toBe("Figtree");
    expect(popover().classList.contains("hidden")).toBe(true);
  });

  it("closes on Escape and returns focus to the trigger", () => {
    trigger().click();
    search().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover().classList.contains("hidden")).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
  });

  it("opens and highlights the first option on ArrowDown from the trigger", () => {
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(popover().classList.contains("hidden")).toBe(false);
    expect(options()[0].classList.contains("active")).toBe(true);
    expect(document.activeElement).toBe(search());
  });

  it("jumps to the last option on End from the trigger", () => {
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(options()[2].classList.contains("active")).toBe(true);
    search().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(select.value).toBe("figtree");
    expect(document.activeElement).toBe(trigger());
  });

  it("closes when clicking outside", () => {
    trigger().click();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(popover().classList.contains("hidden")).toBe(true);
  });

  it("syncs the trigger label after a programmatic value change", () => {
    select.value = "figtree";
    syncSearchableSelect(select);
    expect(trigger().textContent).toBe("Figtree");
    expect(options()[2].classList.contains("selected")).toBe(true);
    expect(options()[2].getAttribute("aria-selected")).toBe("true");
    expect(options()[0].classList.contains("selected")).toBe(false);
  });

  it("highlights the matched substring without changing the option label", () => {
    trigger().click();
    search().value = "spacegro";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    expect(visibleOptions()).toHaveLength(1);
    const marked = options()[1].querySelector("mark");
    expect(marked).not.toBeNull();
    expect(marked.textContent).toBe("Space Gro");
    expect(options()[1].textContent).toBe("Space Grotesk");
    expect(options()[0].querySelector("mark")).toBeNull();
  });

  it("marks each contiguous run when the query skips characters", () => {
    trigger().click();
    search().value = "sg";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    const marks = Array.from(options()[1].querySelectorAll("mark")).map((el) => el.textContent);
    expect(marks).toEqual(["S", "G"]);
  });

  it("announces the number of matches in an aria-live status region", () => {
    const status = field.querySelector(".ss-status");
    expect(status).not.toBeNull();
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    trigger().click();
    expect(status.textContent).toBe("");
    search().value = "fig";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    expect(status.textContent).toBe("1 match");
    search().value = "e";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    expect(status.textContent).toBe("3 matches");
    search().value = "zzz";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    expect(status.textContent).toBe("0 matches");
    search().value = "";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    expect(status.textContent).toBe("");
  });

  it("picks an option that is currently highlighted", () => {
    trigger().click();
    search().value = "grotesk";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    options()[1].click();
    expect(select.value).toBe("space grotesk");
    expect(trigger().textContent).toBe("Space Grotesk");
    expect(popover().classList.contains("hidden")).toBe(true);
  });

  it("keeps filtering correctly after a highlight pass", () => {
    trigger().click();
    search().value = "space";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    search().value = "fig";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    expect(visibleOptions().map((el) => el.textContent)).toEqual(["Figtree"]);
  });

  it("clears marks and the status when reopened", () => {
    trigger().click();
    search().value = "fig";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    trigger().click();
    trigger().click();
    expect(field.querySelectorAll(".ss-option mark")).toHaveLength(0);
    expect(field.querySelector(".ss-status").textContent).toBe("");
  });
});

describe("highlightMatches", () => {
  it("marks a contiguous, case-insensitive match", () => {
    expect(highlightMatches("Figtree", "fig")).toBe("<mark>Fig</mark>tree");
    expect(highlightMatches("Figtree", "TREE")).toBe("Fig<mark>tree</mark>");
  });

  it("matches across spaces and marks the original span", () => {
    expect(highlightMatches("Space Grotesk", "spacegro")).toBe("<mark>Space Gro</mark>tesk");
    expect(highlightMatches("Space Grotesk", "sg")).toBe("<mark>S</mark>pace <mark>G</mark>rotesk");
  });

  it("escapes markup and returns plain escaped text for an empty query", () => {
    expect(highlightMatches("A&B <C>", "a&")).toBe("<mark>A&amp;</mark>B &lt;C&gt;");
    expect(highlightMatches('He said "hi"', "")).toBe("He said &quot;hi&quot;");
  });
});

describe("searchable-select combobox semantics", () => {
  /** @type {HTMLElement} */
  let field;

  const trigger = () => field.querySelector(".ss-trigger");
  const search = () => field.querySelector(".ss-search");
  const list = () => field.querySelector(".ss-list");
  const options = () => Array.from(field.querySelectorAll(".ss-option"));

  beforeEach(() => {
    document.body.innerHTML = "";
    field = buildField();
    initSearchableSelects(document);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("exposes the search box as a combobox wired to the listbox", () => {
    expect(search().getAttribute("role")).toBe("combobox");
    expect(search().getAttribute("aria-haspopup")).toBe("listbox");
    expect(search().getAttribute("aria-autocomplete")).toBe("list");
    expect(search().getAttribute("aria-expanded")).toBe("false");
    expect(search().getAttribute("aria-controls")).toBe(list().id);
    expect(trigger().getAttribute("aria-controls")).toBe(list().id);
    expect(list().id).not.toBe("");
  });

  it("gives every option an id and tracks the active option via aria-activedescendant", () => {
    trigger().click();
    expect(search().getAttribute("aria-expanded")).toBe("true");
    expect(options()[1].id).toBe(`${list().id}-option-1`);

    search().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(search().getAttribute("aria-activedescendant")).toBe(options()[0].id);
    search().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(search().getAttribute("aria-activedescendant")).toBe(options()[1].id);

    search().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(search().hasAttribute("aria-activedescendant")).toBe(false);
    expect(search().getAttribute("aria-expanded")).toBe("false");
  });

  it("only swallows Escape while the listbox is open", () => {
    const onDocumentEscape = vi.fn();
    document.addEventListener("keydown", onDocumentEscape);

    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onDocumentEscape).toHaveBeenCalledTimes(1);

    trigger().click();
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onDocumentEscape).toHaveBeenCalledTimes(1);
    expect(field.querySelector(".ss-popover").classList.contains("hidden")).toBe(true);

    document.removeEventListener("keydown", onDocumentEscape);
  });

  it("closes when Tab moves focus out of the field but stays open for focus inside", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    trigger().click();
    search().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    trigger().focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(field.querySelector(".ss-popover").classList.contains("hidden")).toBe(false);

    search().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    outside.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(field.querySelector(".ss-popover").classList.contains("hidden")).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps keyboard focus in the search box when an option is clicked", () => {
    trigger().click();
    const onOption = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    options()[2].dispatchEvent(onOption);
    expect(onOption.defaultPrevented).toBe(true);

    // Clicks inside the search box keep native caret placement.
    const onSearch = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    search().dispatchEvent(onSearch);
    expect(onSearch.defaultPrevented).toBe(false);
  });
});
