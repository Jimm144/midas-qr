import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/js/generator/generator.js", () => ({
  generateQR: vi.fn(),
  syncConfigToUI: vi.fn(),
}));

async function setup() {
  vi.resetModules();
  document.body.innerHTML = "";
  const { DOM } = await import("../src/js/ui/dom.js");
  const { state } = await import("../src/js/state");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  const group = document.createElement("div");
  group.id = "bg-color-picker-group";
  const picker = document.createElement("button");
  picker.type = "button";
  const hex = document.createElement("input");
  hex.type = "text";
  group.append(picker, hex);
  document.body.append(checkbox, group);
  DOM.qrBgTransparent = checkbox;
  DOM.bgColorPickerGroup = group;
  state.generator.bgTransparent = false;

  const { initColorControls } = await import("../src/js/generator/controls.js");
  initColorControls();
  return { checkbox, group, picker, hex, state };
}

describe("background transparency disables the background color controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables the picker and hex field when the background becomes transparent", async () => {
    const { checkbox, group, picker, hex, state } = await setup();
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(state.generator.bgTransparent).toBe(true);
    expect(hex.disabled).toBe(true);
    expect(picker.disabled).toBe(true);
    expect(hex.getAttribute("aria-disabled")).toBe("true");
    expect(picker.getAttribute("aria-disabled")).toBe("true");
    expect(group.classList.contains("opacity-50")).toBe(true);
    expect(group.classList.contains("pointer-events-none")).toBe(true);
  });

  it("re-enables the controls when the background is restored", async () => {
    const { checkbox, group, picker, hex, state } = await setup();
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(state.generator.bgTransparent).toBe(false);
    expect(hex.disabled).toBe(false);
    expect(picker.disabled).toBe(false);
    expect(hex.hasAttribute("aria-disabled")).toBe(false);
    expect(picker.hasAttribute("aria-disabled")).toBe(false);
    expect(group.classList.contains("opacity-50")).toBe(false);
  });
});
