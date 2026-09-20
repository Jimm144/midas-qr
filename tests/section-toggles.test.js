import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initSectionToggles } from "../src/js/ui/shell.js";
import { _resetAnnounceState } from "../src/js/ui/announce.js";

describe("collapsible section toggles", () => {
  beforeEach(() => {
    _resetAnnounceState();
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      cb();
      return 1;
    });
    document.body.innerHTML = `
      <div id="announcements" role="status" aria-live="polite"></div>
      <button class="btn-toggle-section" data-target="section-shapes" aria-expanded="false" aria-label="Shapes section, currently collapsed">
        <span>Shapes</span><span class="toggle-icon" aria-hidden="true">[+]</span>
      </button>
      <div id="section-shapes" class="section-body hidden"></div>
      <button class="btn-toggle-section" data-target="section-logo" aria-expanded="false" aria-label="Logo">
        <span>Logo</span><span class="toggle-icon" aria-hidden="true">[+]</span>
      </button>
      <div id="section-logo" class="section-body hidden"></div>
      <button class="btn-toggle-section" id="no-target"><span>Broken</span></button>`;
    initSectionToggles();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  const button = (target) => document.querySelector(`.btn-toggle-section[data-target="${target}"]`);
  const panel = (id) => document.getElementById(id);
  const announcements = () => document.getElementById("announcements").textContent;

  it("wires aria-controls and expands the panel with truthful state", () => {
    const btn = button("section-shapes");
    expect(btn.getAttribute("aria-controls")).toBe("section-shapes");

    btn.click();
    expect(panel("section-shapes").classList.contains("hidden")).toBe(false);
    expect(panel("section-shapes").classList.contains("flex")).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.querySelector(".toggle-icon").textContent).toBe("[-]");
    expect(btn.getAttribute("aria-label")).toBe("Shapes section, currently expanded");
  });

  it("announces clean section names without the stale state suffix", () => {
    // Regression: the label captured at init included ", currently collapsed",
    // producing "Shapes section, currently collapsed section opened".
    button("section-shapes").click();
    expect(announcements()).toBe("Shapes section opened");
    expect(announcements()).not.toContain("currently");

    button("section-shapes").click();
    expect(announcements()).toBe("Shapes section closed");
    expect(button("section-shapes").getAttribute("aria-label")).toBe(
      "Shapes section, currently collapsed"
    );
  });

  it("adds the state suffix to labels that start without one", () => {
    button("section-logo").click();
    expect(button("section-logo").getAttribute("aria-label")).toBe("Logo, currently expanded");
    expect(announcements()).toBe("Logo section opened");
  });

  it("ignores toggles without a target or panel", () => {
    expect(() => document.getElementById("no-target").click()).not.toThrow();
  });
});
