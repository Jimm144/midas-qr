import { describe, it, expect, vi } from "vitest";

vi.mock("../src/js/generator/generator.js", () => ({
  generateQR: vi.fn(),
  syncConfigToUI: vi.fn(),
  syncLogoSizeReadout: vi.fn(),
}));

async function setup() {
  vi.resetModules();
  document.body.innerHTML = "";
  const { DOM } = await import("../src/js/ui/dom.js");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "btn-pick-logo";
  btn.textContent = "Upload";
  const file = document.createElement("input");
  file.type = "file";
  file.id = "logo-file";
  const openPicker = vi.fn();
  file.click = openPicker;
  document.body.append(btn, file);
  DOM.btnPickLogo = btn;
  DOM.logoFile = file;

  const { initLogoControls } = await import("../src/js/generator/controls.js");
  initLogoControls();
  return { btn, openPicker };
}

describe("logo upload keyboard access", () => {
  it("opens the hidden file input from a real button in the tab order", async () => {
    const { btn, openPicker } = await setup();
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.tabIndex).toBe(0);
    btn.click();
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it("keeps the dimmed logo options disabled for keyboard users", async () => {
    vi.resetModules();
    document.body.innerHTML = "";
    const { DOM } = await import("../src/js/ui/dom.js");
    const options = document.createElement("div");
    options.id = "logo-options";
    options.className = "opacity-50 pointer-events-none";
    const size = document.createElement("input");
    size.type = "range";
    const margin = document.createElement("input");
    margin.type = "number";
    options.append(size, margin);
    document.body.appendChild(options);
    DOM.logoOptions = options;

    const { initLogoControls } = await import("../src/js/generator/controls.js");
    initLogoControls();
    expect(size.disabled).toBe(true);
    expect(margin.disabled).toBe(true);
    expect(margin.getAttribute("aria-disabled")).toBe("true");

    // syncConfigToUI in generator.js uses the same class toggle.
    options.classList.remove("opacity-50", "pointer-events-none");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(size.disabled).toBe(false);
    expect(margin.disabled).toBe(false);
    expect(margin.hasAttribute("aria-disabled")).toBe(false);
  });

  it("writes the slider ratio into state and refreshes the readout", async () => {
    vi.clearAllMocks();
    vi.resetModules();
    document.body.innerHTML = "";
    const { DOM } = await import("../src/js/ui/dom.js");
    const { state } = await import("../src/js/state");
    const size = document.createElement("input");
    size.type = "range";
    size.value = "0.4";
    DOM.logoSize = size;
    DOM.logoSizeValue = document.createElement("span");
    const { initLogoControls } = await import("../src/js/generator/controls.js");
    const { syncLogoSizeReadout } = await import("../src/js/generator/generator.js");
    initLogoControls();

    size.value = "0.35";
    size.dispatchEvent(new Event("input"));

    expect(state.generator.logoSizeProportion).toBe(0.35);
    // A slider shows no number of its own, so the readout has to be refreshed.
    expect(syncLogoSizeReadout).toHaveBeenCalled();
  });
});

describe("logo URL safety allow-list", () => {
  it("accepts bitmap data URLs and host-bearing http(s) URLs", async () => {
    vi.resetModules();
    const { isSafeLogoDataUrl } = await import("../src/js/generator/controls.js");
    expect(isSafeLogoDataUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isSafeLogoDataUrl("data:image/webp;base64,AAAA")).toBe(true);
    expect(isSafeLogoDataUrl("https://example.com/logo.png")).toBe(true);
    expect(isSafeLogoDataUrl("http://localhost:8080/logo.png")).toBe(true);
  });

  it("rejects non-image data URLs and non-http(s)/hostless values", async () => {
    vi.resetModules();
    const { isSafeLogoDataUrl } = await import("../src/js/generator/controls.js");
    expect(isSafeLogoDataUrl("data:image/svg+xml;base64,AA")).toBe(false);
    expect(isSafeLogoDataUrl("data:text/html;base64,AA")).toBe(false);
    expect(isSafeLogoDataUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLogoDataUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeLogoDataUrl("https://")).toBe(false);
    expect(isSafeLogoDataUrl("example.com/logo.png")).toBe(false);
    expect(isSafeLogoDataUrl("https://exa mple.com/logo.png")).toBe(false);
    expect(isSafeLogoDataUrl(null)).toBe(false);
  });
});
