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

async function setupTablist() {
  vi.resetModules();
  document.body.innerHTML = `
    <div id="announcements" role="status" aria-live="polite"></div>
    <div class="tab-rail" role="tablist">
      <button id="tab-btn-generator" role="tab" aria-selected="true" aria-controls="panel-generator"></button>
      <button id="tab-btn-scanner" role="tab" aria-selected="false" aria-controls="panel-scanner"></button>
      <button id="tab-btn-history" role="tab" aria-selected="false" aria-controls="panel-history"></button>
    </div>
    <section id="panel-generator" role="tabpanel" aria-labelledby="tab-btn-generator"></section>
    <section id="panel-scanner" role="tabpanel" aria-labelledby="tab-btn-scanner" class="hidden"></section>
    <section id="panel-history" role="tabpanel" aria-labelledby="tab-btn-history" class="hidden"></section>
  `;
  globalThis.jsQR = {};
  window.history.replaceState(null, "", window.location.pathname);
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
