import { describe, it, expect, beforeEach, vi } from "vitest";
import { bootRealDom, indexBodyMarkup } from "./helpers/dom-fixture.js";

describe("initDOM against the real index.html", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
  });

  it("populates every registry ref from the app markup", async () => {
    const DOM = await bootRealDom();
    const entries = Object.entries(DOM);
    expect(entries.length).toBeGreaterThan(100);
    for (const [key, el] of entries) {
      expect(el, `DOM.${key}`).toBeTruthy();
      expect(el.nodeType, `DOM.${key}`).toBe(1);
    }
    expect(Object.isFrozen(DOM)).toBe(true);
  });

  it("reads ids from an injected root, not the document", async () => {
    const root = document.createElement("div");
    root.innerHTML = indexBodyMarkup();
    const { DOM, initDOM } = await import("../src/js/ui/dom.js");
    initDOM(root);
    expect(DOM.themeSelect).toBe(root.querySelector("#theme-select"));
    expect(DOM.errorModal).toBe(root.querySelector("#error-modal"));
  });

  it("lists missing ids in one error instead of one per reload", async () => {
    const { initDOM } = await import("../src/js/ui/dom.js");
    expect(() => initDOM(document)).toThrow(/theme-select/);
  });
});
