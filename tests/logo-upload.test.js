import { describe, it, expect, vi } from "vitest";

vi.mock("../src/js/generator/generator.js", () => ({
  generateQR: vi.fn(),
  syncConfigToUI: vi.fn(),
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
});
