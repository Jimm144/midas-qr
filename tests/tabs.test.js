import { describe, it, expect, vi } from "vitest";
import { loadVendoredScript } from "../src/js/lib-loader.js";

vi.mock("../src/js/scanner/scanner.js", () => ({
  startWebcamScan: vi.fn(),
  stopWebcamScan: vi.fn(),
  clearScannerOutput: vi.fn(),
  initScanner: vi.fn(),
}));

describe("loadVendoredScript", () => {
  it("resolves true immediately when the global is already defined", async () => {
    globalThis.__libLoaderTestGlobal = {};
    await expect(
      loadVendoredScript("src/lib/nonexistent-loader-test.min.js", "__libLoaderTestGlobal")
    ).resolves.toBe(true);
    expect(document.head.querySelector('script[src="src/lib/nonexistent-loader-test.min.js"]')).toBeNull();
    delete globalThis.__libLoaderTestGlobal;
  });

  it("resolves false when the injected script fails to load", async () => {
    const pending = loadVendoredScript("src/lib/nonexistent-loader-test.min.js", "__libLoaderMissingGlobal");
    const script = document.head.querySelector('script[src="src/lib/nonexistent-loader-test.min.js"]');
    expect(script).toBeTruthy();
    script.dispatchEvent(new Event("error"));
    await expect(pending).resolves.toBe(false);
    script.remove();
  });
});

async function setupTablist({ keepHash = false } = {}) {
  vi.resetModules();
  document.body.innerHTML = `
    <div id="announcements" role="status" aria-live="polite"></div>
    <div class="tab-rail" role="tablist">
      <button id="tab-btn-generator" class="tab-btn is-active" role="tab" aria-selected="true" aria-controls="panel-generator"></button>
      <button id="tab-btn-scanner" role="tab" aria-selected="false" aria-controls="panel-scanner"></button>
      <button id="tab-btn-history" role="tab" aria-selected="false" aria-controls="panel-history"></button>
    </div>
    <section id="panel-generator" role="tabpanel" aria-labelledby="tab-btn-generator"></section>
    <section id="panel-scanner" role="tabpanel" aria-labelledby="tab-btn-scanner" class="hidden"></section>
    <section id="panel-history" role="tabpanel" aria-labelledby="tab-btn-history" class="hidden"></section>
  `;
  globalThis.jsQR = {};
  // A share payload lives in the hash, so callers testing that path opt out.
  if (!keepHash) window.history.replaceState(null, "", window.location.pathname);
  const { DOM } = await import("../src/js/ui/dom.js");
  DOM.tabBtnGenerator = document.getElementById("tab-btn-generator");
  DOM.tabBtnScanner = document.getElementById("tab-btn-scanner");
  DOM.tabBtnHistory = document.getElementById("tab-btn-history");
  DOM.panelGenerator = document.getElementById("panel-generator");
  DOM.panelScanner = document.getElementById("panel-scanner");
  DOM.panelHistory = document.getElementById("panel-history");
  const { state } = await import("../src/js/state");
  state.activeTab = "generator";
  const tabs = await import("../src/js/ui/tabs.js");
  tabs.initTabs();
  return { state, tabs };
}

function pressKey(el, key) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("tablist keyboard navigation", () => {
  it("ArrowRight focuses and activates the next tab", async () => {
    const { state } = await setupTablist();
    const generator = document.getElementById("tab-btn-generator");
    generator.focus();
    pressKey(generator, "ArrowRight");

    expect(document.activeElement).toBe(document.getElementById("tab-btn-scanner"));
    expect(state.activeTab).toBe("scanner");
    expect(document.getElementById("tab-btn-scanner").getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("tab-btn-generator").getAttribute("aria-selected")).toBe("false");
    expect(document.getElementById("panel-scanner").classList.contains("hidden")).toBe(false);
  });

  it("ArrowLeft from the first tab wraps focus to the last tab", async () => {
    const { state } = await setupTablist();
    const generator = document.getElementById("tab-btn-generator");
    generator.focus();
    pressKey(generator, "ArrowLeft");

    expect(document.activeElement).toBe(document.getElementById("tab-btn-history"));
    expect(state.activeTab).toBe("history");
    expect(document.getElementById("tab-btn-history").getAttribute("aria-selected")).toBe("true");
  });

  it("Home and End jump to the first and last tab", async () => {
    const { state } = await setupTablist();
    const generator = document.getElementById("tab-btn-generator");
    generator.focus();
    pressKey(generator, "End");
    expect(document.activeElement).toBe(document.getElementById("tab-btn-history"));

    pressKey(document.getElementById("tab-btn-history"), "Home");
    expect(document.activeElement).toBe(document.getElementById("tab-btn-generator"));
    expect(state.activeTab).toBe("generator");
    expect(document.getElementById("tab-btn-generator").getAttribute("tabindex")).toBe("0");
  });

  it("clicking a tab keeps roving tabindex and aria-selected in sync", async () => {
    await setupTablist();
    document.getElementById("tab-btn-scanner").click();

    expect(document.getElementById("tab-btn-generator").getAttribute("tabindex")).toBe("-1");
    expect(document.getElementById("tab-btn-scanner").getAttribute("tabindex")).toBe("0");
    expect(document.getElementById("tab-btn-history").getAttribute("tabindex")).toBe("-1");
    expect(document.getElementById("tab-btn-scanner").getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("tab-btn-generator").getAttribute("aria-selected")).toBe("false");
    expect(document.getElementById("tab-btn-history").getAttribute("aria-selected")).toBe("false");
  });

  it("switchTab tolerates missing button/panel references", async () => {
    const { tabs } = await setupTablist();
    const { DOM } = await import("../src/js/ui/dom.js");
    delete DOM.tabBtnHistory;
    delete DOM.panelHistory;
    expect(() => tabs.switchTab("history")).not.toThrow();
  });

  it("initTabs is idempotent across repeated calls", async () => {
    const { state, tabs } = await setupTablist();
    const scanner = document.getElementById("tab-btn-scanner");
    tabs.initTabs();
    scanner.click();
    expect(state.activeTab).toBe("scanner");
    // A stacked duplicate click listener would still be idempotent here, but
    // the guard is observable through repeated init not adding key handlers.
    scanner.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(state.activeTab).toBe("history");
  });

  it("ignores unknown tab names without blanking the UI", async () => {
    const { state, tabs } = await setupTablist();
    expect(() => tabs.switchTab("nope")).not.toThrow();
    expect(state.activeTab).toBe("generator");
    expect(document.getElementById("panel-generator").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("tab-btn-generator").getAttribute("aria-selected")).toBe("true");
  });

  it("preserves extra classes on tab buttons across switches", async () => {
    await setupTablist();
    const scanner = document.getElementById("tab-btn-scanner");
    scanner.classList.add("custom-hook");
    scanner.click();
    expect(scanner.classList.contains("tab-btn")).toBe(true);
    expect(scanner.classList.contains("is-active")).toBe(true);
    expect(scanner.classList.contains("custom-hook")).toBe(true);
    document.getElementById("tab-btn-history").click();
    expect(scanner.classList.contains("is-active")).toBe(false);
    expect(scanner.classList.contains("custom-hook")).toBe(true);
  });
});

describe("tab rail sliding pill", () => {
  /** jsdom has no layout, so hand the measurement the geometry it needs. */
  function stubGeometry(el, { width, left }) {
    Object.defineProperty(el, "offsetWidth", { value: width, configurable: true });
    Object.defineProperty(el, "offsetLeft", { value: left, configurable: true });
  }

  it("creates one hidden pill and slides it to the selected tab", async () => {
    await setupTablist();
    const rail = document.querySelector(".tab-rail");
    const indicator = rail.querySelector(":scope > .tab-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator.getAttribute("aria-hidden")).toBe("true");
    // One pill for the whole rail, not one per button.
    expect(rail.querySelectorAll(".tab-indicator")).toHaveLength(1);

    stubGeometry(rail, { width: 0, left: 0 });
    Object.defineProperty(rail, "clientLeft", { value: 1, configurable: true });
    stubGeometry(document.getElementById("tab-btn-scanner"), { width: 120, left: 250 });

    document.getElementById("tab-btn-scanner").click();

    expect(indicator.style.width).toBe("120px");
    // offsetLeft is border-box relative; the pill sits at the padding box.
    expect(indicator.style.transform).toBe("translateX(249px)");
  });

  it("only enables the transition after a placement with real geometry", async () => {
    await setupTablist();
    const rail = document.querySelector(".tab-rail");
    const indicator = rail.querySelector(":scope > .tab-indicator");
    // jsdom has no layout, so nothing has been placed yet — and the class that
    // switches the transition on must be held back, or the pill animates in from
    // the corner (on load, or when a hidden panel is first shown).
    expect(rail.classList.contains("is-indicator-ready")).toBe(false);

    stubGeometry(document.getElementById("tab-btn-generator"), { width: 200, left: 0 });
    window.dispatchEvent(new Event("resize"));

    expect(rail.classList.contains("is-indicator-ready")).toBe(true);
    expect(indicator.style.width).toBe("200px");
    expect(indicator.style.transform).toBe("translateX(0px)");
  });
});

describe("share links keep their payload in the hash", () => {
  it("does not rewrite a payload hash to a tab name on init", async () => {
    window.history.replaceState(null, "", "#w=400&data=shared");
    await setupTablist({ keepHash: true });
    // initTabs' else-branch used to replaceState("#generator"), which made a
    // shared link un-re-shareable and unbookmarkable the moment it opened.
    expect(window.location.hash).toBe("#w=400&data=shared");
  });

  it("does not overwrite a payload hash when the user switches tabs", async () => {
    window.history.replaceState(null, "", "#w=400&data=shared");
    const { tabs } = await setupTablist({ keepHash: true });
    tabs.switchTab("history");
    expect(window.location.hash).toBe("#w=400&data=shared");
  });

  it("still writes a tab hash when there is no payload", async () => {
    // The default harness clears the hash, which is the no-payload case.
    const { tabs } = await setupTablist();
    expect(window.location.hash).toBe("#generator");
    tabs.switchTab("scanner");
    expect(window.location.hash).toBe("#scanner");
  });
});
