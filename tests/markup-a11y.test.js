import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { MAX_FRAME_TEXT_LEN } from "../src/js/constants.js";

// vitest runs with the project root as cwd.
const html = readFileSync(path.join(process.cwd(), "index.html"), "utf8");
const dom = new JSDOM(html);
const doc = dom.window.document;
const all = (selector) => Array.from(doc.querySelectorAll(selector));
const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();

describe("index.html accessibility invariants", () => {
  it("has no duplicate ids", () => {
    const seen = new Map();
    const duplicates = [];
    for (const el of all("[id]")) {
      if (seen.has(el.id)) duplicates.push(el.id);
      seen.set(el.id, el);
    }
    expect(duplicates).toEqual([]);
  });

  it("resolves every aria-controls / labelledby / describedby / activedescendant reference", () => {
    const dangling = [];
    for (const el of all("[aria-controls],[aria-labelledby],[aria-describedby],[aria-activedescendant]")) {
      for (const attr of ["aria-controls", "aria-labelledby", "aria-describedby", "aria-activedescendant"]) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        for (const ref of value.split(/\s+/)) {
          if (!doc.getElementById(ref)) dangling.push(`${attr}="${ref}" on #${el.id || el.tagName}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it("gives every button an accessible name", () => {
    const unnamed = all("button")
      .filter((btn) => !(btn.getAttribute("aria-label") || text(btn) || btn.getAttribute("title")))
      .map((btn) => btn.id || btn.className);
    expect(unnamed).toEqual([]);
  });

  it("labels every input and textarea", () => {
    const unlabeled = all("input, textarea")
      .filter((el) => el.type !== "hidden")
      .filter((el) => {
        const id = el.id;
        return !(
          el.getAttribute("aria-label") ||
          el.getAttribute("aria-labelledby") ||
          (id && doc.querySelector(`label[for="${id}"]`)) ||
          el.closest("label")
        );
      })
      .map((el) => el.id || el.className);
    expect(unlabeled).toEqual([]);
  });

  it("keeps the custom selects' option divs aligned with their native options", () => {
    for (const wrapper of all(".custom-select-wrapper")) {
      const select = wrapper.querySelector("select");
      const options = Array.from(wrapper.querySelectorAll(".custom-select-option"));
      expect(select, `wrapper without select: ${wrapper.outerHTML.slice(0, 80)}`).not.toBeNull();
      expect(options.length, `option count for #${select.id}`).toBe(select.options.length);
      options.forEach((option, index) => {
        expect(option.getAttribute("data-index"), `#${select.id} option ${index}`).toBe(String(index));
        expect(text(option), `#${select.id} option ${index} text`).toBe(select.options[index].text.trim());
      });
      expect(select.getAttribute("aria-label"), `#${select.id} label`).toBeTruthy();
    }
  });

  it("wires the tablist to its panels", () => {
    for (const tab of all('[role="tab"]')) {
      expect(tab.getAttribute("aria-controls"), `#${tab.id}`).toBeTruthy();
      expect(tab.getAttribute("aria-selected"), `#${tab.id}`).toBeTruthy();
    }
    for (const panel of all('[role="tabpanel"]')) {
      expect(panel.getAttribute("aria-labelledby"), `#${panel.id}`).toBeTruthy();
      // The panel or its heading must be programmatically focusable so tab
      // activation can move focus into the shown panel.
      const focusTarget =
        panel.hasAttribute("tabindex") ||
        panel.querySelector("h2[tabindex], [role='heading'][tabindex]") !== null;
      expect(focusTarget, `#${panel.id} focus target`).toBe(true);
    }
  });

  it("exposes the readability badge as a polite live region", () => {
    const badge = doc.getElementById("qr-readability-badge");
    expect(badge).not.toBeNull();
    expect(badge.getAttribute("role")).toBe("status");
    expect(badge.getAttribute("aria-live")).toBe("polite");
    expect(badge.getAttribute("aria-atomic")).toBe("true");
  });

  it("keeps accordion aria-expanded in sync with panel visibility", () => {
    for (const btn of all(".btn-toggle-section[data-target]")) {
      const panel = doc.getElementById(btn.getAttribute("data-target"));
      expect(panel, `missing panel for ${btn.getAttribute("data-target")}`).not.toBeNull();
      const expanded = btn.getAttribute("aria-expanded") === "true";
      expect(expanded, `#${panel.id} hidden=${panel.classList.contains("hidden")}`).toBe(
        !panel.classList.contains("hidden")
      );
      expect(btn.getAttribute("aria-controls")).toBe(panel.id);
    }
  });

  it("opens the hidden logo file input from a real button, not a label", () => {
    // A <label> is not focusable, so the upload was mouse-only.
    expect(doc.querySelector('label[for="logo-file"]')).toBeNull();
    const btn = doc.getElementById("btn-pick-logo");
    expect(btn).not.toBeNull();
    expect(btn.tagName).toBe("BUTTON");
  });

  it("matches the frame-text maxlength to the render clamp", () => {
    expect(doc.getElementById("qr-frame-text").getAttribute("maxlength")).toBe(String(MAX_FRAME_TEXT_LEN));
  });

  it("gives the spectrum canvas keyboard access", () => {
    const spectrum = doc.getElementById("cp-spectrum");
    expect(spectrum.getAttribute("role")).toBe("img");
    expect(spectrum.getAttribute("aria-label")).toBeTruthy();
    expect(spectrum.getAttribute("tabindex")).toBe("0");
  });
});
