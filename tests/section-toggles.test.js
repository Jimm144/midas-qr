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
      <div id="section-shapes" class="section-body is-collapsed"></div>
      <button class="btn-toggle-section" data-target="section-logo" aria-expanded="false" aria-label="Logo">
        <span>Logo</span><span class="toggle-icon" aria-hidden="true">[+]</span>
      </button>
      <div id="section-logo" class="section-body is-collapsed"></div>
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
    expect(panel("section-shapes").classList.contains("is-collapsed")).toBe(false);
    // The header's join is held from the first frame of the open, and the
    // transition-disabling class is released again so later toggles still morph.
    expect(btn.classList.contains("is-animating")).toBe(true);
    expect(btn.classList.contains("no-join-transition")).toBe(false);
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
    const shapesPanel = document.getElementById("section-shapes");
    const shapesBefore = shapesPanel.classList.contains("is-collapsed");

    document.getElementById("no-target").click();

    // Nothing observable changed: the panel state and the announcement are
    // untouched, which a "does not throw" assertion could never catch.
    expect(shapesPanel.classList.contains("is-collapsed")).toBe(shapesBefore);
    expect(button("section-shapes").getAttribute("aria-expanded")).toBe("false");
    expect(announcements()).toBe("");
  });

  it("clips while moving and settles to auto height", async () => {
    vi.useFakeTimers();
    try {
      const panelEl = panel("section-shapes");
      button("section-shapes").click();

      // Visible at once (a display change cannot transition) and clipped only
      // while the height is driven inline.
      expect(panelEl.classList.contains("is-collapsed")).toBe(false);
      expect(panelEl.classList.contains("is-animating")).toBe(true);

      await vi.advanceTimersByTimeAsync(400);

      expect(panelEl.classList.contains("is-animating")).toBe(false);
      expect(panelEl.style.height).toBe("");
      expect(panelEl.classList.contains("is-collapsed")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("parks a closing panel back in the collapsed state after the motion", async () => {
    vi.useFakeTimers();
    try {
      const panelEl = panel("section-shapes");
      button("section-shapes").click();
      await vi.advanceTimersByTimeAsync(400);

      button("section-shapes").click();
      // The close starts by collapsing the track (is-collapsed) while the panel
      // is still in the flow, so the motion can run; it is never display:none.
      expect(panelEl.classList.contains("is-collapsed")).toBe(true);
      expect(panelEl.classList.contains("is-animating")).toBe(true);
      expect(panelEl.classList.contains("hidden")).toBe(false);

      await vi.advanceTimersByTimeAsync(400);

      expect(panelEl.classList.contains("is-collapsed")).toBe(true);
      expect(panelEl.classList.contains("is-animating")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses to a zero track and stays there, without a display flip", async () => {
    vi.useFakeTimers();
    try {
      const panelEl = panel("section-shapes");
      button("section-shapes").click();
      await vi.advanceTimersByTimeAsync(400);

      button("section-shapes").click();
      // The panel animates on its track and keeps its place in the flow; the
      // settled collapsed state is the same 0fr box (see the stylesheet's
      // visibility rule), so nothing changes in one frame at the end.
      expect(panelEl.classList.contains("is-collapsed")).toBe(true);
      expect(panelEl.classList.contains("is-animating")).toBe(true);
      expect(panelEl.classList.contains("hidden")).toBe(false);

      await vi.advanceTimersByTimeAsync(400);

      expect(panelEl.classList.contains("is-animating")).toBe(false);
      expect(panelEl.classList.contains("is-collapsed")).toBe(true);
      expect(panelEl.classList.contains("hidden")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the header's join for the whole motion", async () => {
    vi.useFakeTimers();
    try {
      const btn = button("section-shapes");
      btn.click();
      await vi.advanceTimersByTimeAsync(400);

      btn.click();
      // aria-expanded flips instantly, so the header's flat bottom has to be
      // held by .is-animating until the panel has actually gone — otherwise it
      // re-rounds over a still-open panel for the whole animation.
      expect(btn.getAttribute("aria-expanded")).toBe("false");
      expect(btn.classList.contains("is-animating")).toBe(true);
      expect(btn.querySelector(".toggle-icon").textContent).toBe("[+]");
      expect(panel("section-shapes").classList.contains("is-collapsed")).toBe(true);

      await vi.advanceTimersByTimeAsync(400);

      expect(panel("section-shapes").classList.contains("is-collapsed")).toBe(true);
      // Released at the end, where the corner transition can morph it back.
      expect(btn.classList.contains("is-animating")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("supersedes an in-flight motion when clicked again quickly", async () => {
    vi.useFakeTimers();
    try {
      const panelEl = panel("section-shapes");
      button("section-shapes").click();
      await vi.advanceTimersByTimeAsync(50);
      button("section-shapes").click();

      await vi.advanceTimersByTimeAsync(400);

      // The interrupted open must not leave the panel visible or clipped.
      expect(panelEl.classList.contains("is-collapsed")).toBe(true);
      expect(panelEl.classList.contains("is-animating")).toBe(false);
      expect(panelEl.style.height).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});
