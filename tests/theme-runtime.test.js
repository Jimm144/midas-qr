import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/js/generator/generator.js", () => ({ generateQR: vi.fn() }));

async function setup() {
  vi.resetModules();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
  localStorage.clear();
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

  const { DOM } = await import("../src/js/ui/dom.js");
  const themeSelect = document.createElement("select");
  themeSelect.id = "theme-select";
  themeSelect.innerHTML = `<option value="neutral">Neutral</option><option value="gothic">Gothic</option><option value="matcha">Matcha</option><option value="y2k">Y2K</option>`;
  const modeSelect = document.createElement("select");
  modeSelect.id = "mode-select";
  modeSelect.innerHTML = `<option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option>`;
  const btn = document.createElement("button");
  btn.id = "btn-theme-toggle";
  document.body.append(themeSelect, modeSelect, btn);
  DOM.themeSelect = themeSelect;
  DOM.modeSelect = modeSelect;
  DOM.btnThemeToggle = btn;

  const runtime = await import("../src/js/theme-runtime.js");
  return { runtime, themeSelect, modeSelect, btn };
}

describe("theme runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies the active theme tokens and color scheme", async () => {
    const { runtime, themeSelect, modeSelect } = await setup();
    themeSelect.value = "matcha";
    modeSelect.value = "light";
    runtime.applyTheme();

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--bg")).toBe("#F0F0E0");
    expect(style.getPropertyValue("--accent")).toBe("#3E481D");
    expect(style.getPropertyValue("--font-family-body")).toContain("DM Sans");
    expect(style.colorScheme).toBe("light");
    expect(localStorage.getItem("qr-bg")).toBe("#F0F0E0");
  });

  it("keeps Y2K's square pill radius", async () => {
    const { runtime, themeSelect } = await setup();
    themeSelect.value = "y2k";
    runtime.applyTheme();
    expect(document.documentElement.style.getPropertyValue("--radius-pill")).toBe("0px");
  });

  it("forces dark mode in Gothic and disables the mode toggle", async () => {
    const { runtime, themeSelect, modeSelect, btn } = await setup();
    localStorage.setItem("qr-mode", "light");
    themeSelect.value = "gothic";
    runtime.applyTheme();

    expect(modeSelect.value).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(modeSelect.querySelector('option[value="light"]').disabled).toBe(true);
    expect(localStorage.getItem("qr-mode")).toBe("dark");
  });

  it("restores the pre-Gothic mode and re-enables the toggle when leaving Gothic", async () => {
    const { runtime, themeSelect, modeSelect, btn } = await setup();
    localStorage.setItem("qr-mode", "light");
    themeSelect.value = "gothic";
    runtime.applyTheme();
    expect(btn.disabled).toBe(true);

    themeSelect.value = "neutral";
    runtime.applyTheme();

    expect(modeSelect.value).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(btn.disabled).toBe(false);
    expect(btn.hasAttribute("aria-disabled")).toBe(false);
    expect(modeSelect.querySelector('option[value="light"]').disabled).toBe(false);
    expect(localStorage.getItem("qr-mode")).toBe("light");
  });

  it("follows the system preference when mode is auto", async () => {
    const { runtime, themeSelect, modeSelect } = await setup();
    window.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    themeSelect.value = "neutral";
    modeSelect.value = "auto";
    runtime.applyTheme();
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("maps legacy saved theme keys onto current families", async () => {
    const { runtime, themeSelect, modeSelect } = await setup();
    localStorage.setItem("qr-theme", "matrix");
    localStorage.setItem("qr-mode", "light");
    runtime.restoreSavedThemeMode();
    expect(themeSelect.value).toBe("matcha");
    expect(modeSelect.value).toBe("light");
  });
});
