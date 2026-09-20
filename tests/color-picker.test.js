import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import {
  rgbToHex,
  hexToRgb,
  winHslToRgb,
  rgbToWinHsl,
  hsvToRgb,
  rgbToHsv,
  initColorPicker,
  cpColor,
  cpHsv,
  spectrumIndicatorPos,
  spectrumPickValue,
  spectrumIndicatorRing,
  spectrumKeyDelta,
  updateFromHsl,
  updateColorState,
  updateFromHex,
} from "../src/js/ui/color-picker.js";
import { initCustomSelects, syncCustomSelect, flashButton } from "../src/js/ui/components.js";
import { DOM } from "../src/js/ui/dom.js";
import { state } from "../src/js/state";

describe("rgbToHex", () => {
  it("converts pure red", () => {
    expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
  });
  it("converts pure green", () => {
    expect(rgbToHex(0, 255, 0)).toBe("#00ff00");
  });
  it("converts pure blue", () => {
    expect(rgbToHex(0, 0, 255)).toBe("#0000ff");
  });
  it("converts white", () => {
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
  });
  it("converts black", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
  });
});

describe("hexToRgb", () => {
  it("parses short hex", () => {
    expect(hexToRgb("#f00")).toBeNull();
  });
  it("parses full hex", () => {
    expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
  });
  it("parses hex without hash", () => {
    expect(hexToRgb("00ff00")).toEqual({ r: 0, g: 255, b: 0 });
  });
  it("returns null for invalid hex", () => {
    expect(hexToRgb("not-a-color")).toBeNull();
    expect(hexToRgb("#xyz")).toBeNull();
  });
});

describe("winHslToRgb", () => {
  it("converts Windows HSL red", () => {
    expect(winHslToRgb(0, 240, 120)).toEqual({ r: 255, g: 0, b: 0 });
  });
  it("converts Windows HSL green", () => {
    expect(winHslToRgb(80, 240, 120)).toEqual({ r: 0, g: 255, b: 0 });
  });
  it("converts Windows HSL blue", () => {
    expect(winHslToRgb(160, 240, 120)).toEqual({ r: 0, g: 0, b: 255 });
  });
  it("converts gray when saturation is zero", () => {
    expect(winHslToRgb(0, 0, 120)).toEqual({ r: 128, g: 128, b: 128 });
  });
  it("clamps out-of-range saturation", () => {
    expect(winHslToRgb(0, 999, 120)).toEqual({ r: 255, g: 0, b: 0 });
    expect(winHslToRgb(0, -50, 120)).toEqual({ r: 128, g: 128, b: 128 });
  });
});

describe("rgbToWinHsl", () => {
  it("converts red", () => {
    expect(rgbToWinHsl(255, 0, 0)).toEqual({ h: 0, s: 240, l: 120 });
  });
  it("converts green", () => {
    expect(rgbToWinHsl(0, 255, 0)).toEqual({ h: 80, s: 240, l: 120 });
  });
  it("converts blue", () => {
    expect(rgbToWinHsl(0, 0, 255)).toEqual({ h: 160, s: 240, l: 120 });
  });
  it("converts white", () => {
    expect(rgbToWinHsl(255, 255, 255)).toEqual({ h: 0, s: 0, l: 240 });
  });
  it("converts black", () => {
    expect(rgbToWinHsl(0, 0, 0)).toEqual({ h: 0, s: 0, l: 0 });
  });
  it("round-trips through winHslToRgb", () => {
    const cases = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [128, 64, 200],
      [255, 255, 0],
      [0, 255, 255],
    ];
    cases.forEach(([r, g, b]) => {
      const hsl = rgbToWinHsl(r, g, b);
      const rgb = winHslToRgb(hsl.h, hsl.s, hsl.l);
      expect(rgb.r).toBeCloseTo(r, -1);
      expect(rgb.g).toBeCloseTo(g, -1);
      expect(rgb.b).toBeCloseTo(b, -1);
    });
  });
});

describe("hex input validation", () => {
  let input;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    const popup = document.createElement("div");
    popup.id = "color-picker-popup";
    input = document.createElement("input");
    input.id = "cp-input-hex";
    document.body.append(popup, input);
    initColorPicker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Enter with an invalid hex shows the shake error state and restores the prior color", () => {
    input.value = "zzz";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(input.classList.contains("cp-hex-shake")).toBe(true);
    expect(input.classList.contains("border-red-500")).toBe(true);
    expect(input.value).toBe(cpColor.hex);
  });

  it("clears the shake state after the timeout", () => {
    input.value = "zzz";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    vi.advanceTimersByTime(900);
    expect(input.classList.contains("cp-hex-shake")).toBe(false);
    expect(input.classList.contains("border-red-500")).toBe(false);
  });

  it("blur with an invalid hex shows the shake state and restores the prior color", () => {
    input.value = "not-a-color";
    input.dispatchEvent(new Event("blur"));
    expect(input.classList.contains("cp-hex-shake")).toBe(true);
    expect(input.classList.contains("border-red-500")).toBe(true);
    expect(input.value).toBe(cpColor.hex);
  });

  it("Enter with a valid hex does not show the shake state", () => {
    input.value = "#12abef";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(input.classList.contains("cp-hex-shake")).toBe(false);
    expect(input.classList.contains("border-red-500")).toBe(false);
  });

  it("flags invalid input with aria-invalid and clears it with the shake", () => {
    input.value = "zzz";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    vi.advanceTimersByTime(900);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("does not rewrite the field while a 3-digit shorthand is being typed", () => {
    // Regression: committing at 3 hex digits made typing a 6-digit value
    // expand the shorthand mid-keystroke and corrupt the rest of the input.
    input.value = "#123";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.value).toBe("#123");
    expect(cpColor.hex).not.toBe("#112233");
  });

  it("repairs a 3-digit shorthand on blur into the full uppercase value", () => {
    input.value = "#abc";
    input.dispatchEvent(new Event("blur"));
    expect(input.value).toBe("#AABBCC");
    expect(cpColor.hex).toBe("#AABBCC");
  });

  it("repairs a missing hash on blur", () => {
    input.value = "12abef";
    input.dispatchEvent(new Event("blur"));
    expect(input.value).toBe("#12ABEF");
    expect(cpColor.hex).toBe("#12ABEF");
  });

  it("commits a 3-digit shorthand on Enter before the OK handler runs", () => {
    input.value = "f00";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(cpColor.hex).toBe("#FF0000");
    expect(input.value).toBe("#FF0000");
    expect(input.classList.contains("cp-hex-shake")).toBe(false);
  });
});

describe("color target isolation", () => {
  let originalState;

  beforeEach(() => {
    document.body.innerHTML = "";
    originalState = {
      bg: state.generator.bgColor,
      frame: state.generator.frameColor,
      frameText: state.generator.frameTextColor,
      dots: state.generator.dotsColor,
      frameGradient: state.generator.frameGradient,
    };
    state.generator.bgColor = "#010203";
    state.generator.frameColor = "#040506";
    state.generator.frameTextColor = "#070809";
    state.generator.dotsColor = "#0A0B0C";
    state.generator.frameGradient = null;
    DOM.colorBgText = document.createElement("input");
    DOM.colorFrameText = document.createElement("input");
    DOM.colorFrameTextColor = document.createElement("input");
    DOM.colorDotsText = document.createElement("input");
    DOM.colorFgMediumText = document.createElement("input");
    DOM.qrCanvasContainer = document.createElement("div");
    DOM.qrPreviewContainer = document.createElement("div");
    DOM.emptyStateQr = document.createElement("div");
    DOM.btnDownload = document.createElement("button");
    DOM.btnCopy = document.createElement("button");
    DOM.btnSave = document.createElement("button");
    DOM.btnShareLink = document.createElement("button");
  });

  afterEach(() => {
    state.generator.bgColor = originalState.bg;
    state.generator.frameColor = originalState.frame;
    state.generator.frameTextColor = originalState.frameText;
    state.generator.dotsColor = originalState.dots;
    state.generator.frameGradient = originalState.frameGradient;
  });

  it("updating the frame never touches the body or the frame label", () => {
    updateColorState("frame", "#111111");
    expect(state.generator.frameColor).toBe("#111111");
    expect(state.generator.bgColor).toBe("#010203");
    expect(state.generator.frameTextColor).toBe("#070809");
    expect(state.generator.dotsColor).toBe("#0A0B0C");
    expect(DOM.colorBgText.value).toBe("");
  });

  it("updating the frame label never touches the frame or the body", () => {
    updateColorState("frameText", "#222222");
    expect(state.generator.frameTextColor).toBe("#222222");
    expect(state.generator.frameColor).toBe("#040506");
    expect(state.generator.bgColor).toBe("#010203");
  });

  it("updating the body never touches the frame colors", () => {
    updateColorState("bg", "#333333");
    expect(state.generator.bgColor).toBe("#333333");
    expect(state.generator.frameColor).toBe("#040506");
    expect(state.generator.frameTextColor).toBe("#070809");
  });

  it("ignores non-string hex values instead of throwing", () => {
    expect(() => updateFromHex(null)).not.toThrow();
    expect(() => updateFromHex(12345)).not.toThrow();
    expect(state.generator.bgColor).toBe("#010203");
  });
});

describe("custom select keyboard activation", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="custom-select-wrapper">
        <div class="custom-select-trigger"></div>
        <div class="custom-select-options"><div data-index="0">A</div><div data-index="1">B</div></div>
        <select><option>A</option><option>B</option></select>
      </div>`;
    initCustomSelects();
  });

  const wrapper = () => document.querySelector(".custom-select-wrapper");
  const trigger = () => wrapper().querySelector(".custom-select-trigger");
  const select = () => wrapper().querySelector("select");

  it("opens on ArrowDown and moves the selection", () => {
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(wrapper().classList.contains("open")).toBe(true);
    expect(select().selectedIndex).toBe(1);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("Home and End jump to the first and last option", () => {
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(select().selectedIndex).toBe(1);
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(select().selectedIndex).toBe(0);
  });

  it("is idempotent: repeated init does not double-toggle the dropdown", () => {
    initCustomSelects();
    trigger().click();
    expect(wrapper().classList.contains("open")).toBe(true);
    trigger().click();
    expect(wrapper().classList.contains("open")).toBe(false);
  });
});

describe("hsvToRgb", () => {
  it("converts HSV primaries and grays", () => {
    expect(hsvToRgb(0, 1, 1)).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb(120, 1, 1)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsvToRgb(240, 1, 1)).toEqual({ r: 0, g: 0, b: 255 });
    expect(hsvToRgb(0, 0, 1)).toEqual({ r: 255, g: 255, b: 255 });
    expect(hsvToRgb(0, 1, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("wraps hue and clamps saturation/value", () => {
    expect(hsvToRgb(360, 1, 1)).toEqual(hsvToRgb(0, 1, 1));
    expect(hsvToRgb(-120, 1, 1)).toEqual(hsvToRgb(240, 1, 1));
    expect(hsvToRgb(0, 2, 2)).toEqual(hsvToRgb(0, 1, 1));
    expect(hsvToRgb(0, -1, -1)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("rgbToHsv", () => {
  it("converts primaries, white and black", () => {
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(120, 5);
    expect(rgbToHsv(0, 0, 255).h).toBeCloseTo(240, 5);
    expect(rgbToHsv(255, 255, 255)).toEqual({ h: 0, s: 0, v: 1 });
    expect(rgbToHsv(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 });
  });

  it("round-trips through hsvToRgb", () => {
    const cases = [
      [51, 102, 204],
      [255, 128, 0],
      [12, 200, 130],
      [200, 64, 128],
    ];
    cases.forEach(([r, g, b]) => {
      const hsv = rgbToHsv(r, g, b);
      expect(hsvToRgb(hsv.h, hsv.s, hsv.v)).toEqual({ r, g, b });
    });
  });
});

describe("spectrum indicator helpers", () => {
  it("maps saturation horizontally and brightness vertically", () => {
    expect(spectrumIndicatorPos(0, 1, 240, 240)).toEqual({ x: 0.5, y: 0.5 });
    expect(spectrumIndicatorPos(1, 0, 240, 240)).toEqual({ x: 239.5, y: 239.5 });
    expect(spectrumIndicatorPos(0.5, 0.5, 240, 240)).toEqual({ x: 119.5, y: 119.5 });
  });

  it("scales to non-square canvases", () => {
    expect(spectrumIndicatorPos(1, 1, 200, 100)).toEqual({ x: 199.5, y: 0.5 });
    expect(spectrumIndicatorPos(0, 0, 200, 100)).toEqual({ x: 0.5, y: 99.5 });
  });

  it("inverts the indicator mapping back to a pick position", () => {
    expect(spectrumPickValue(0, 99, 200, 100)).toEqual({ s: 0, v: 0 });
    expect(spectrumPickValue(199, 0, 200, 100)).toEqual({ s: 1, v: 1 });
    expect(spectrumPickValue(99.5, 49.5, 200, 100).s).toBeCloseTo(0.5, 5);
    expect(spectrumPickValue(99.5, 49.5, 200, 100).v).toBeCloseTo(0.5, 5);
  });

  it("picks a contrasting ring color from the backdrop luminance", () => {
    expect(spectrumIndicatorRing(255, 255, 255)).toBe("#000000");
    expect(spectrumIndicatorRing(255, 255, 0)).toBe("#000000");
    expect(spectrumIndicatorRing(0, 0, 0)).toBe("#ffffff");
    expect(spectrumIndicatorRing(0, 0, 255)).toBe("#ffffff");
  });
});

describe("spectrumKeyDelta", () => {
  it("moves saturation with Left/Right and brightness with Up/Down", () => {
    expect(spectrumKeyDelta("ArrowLeft")).toEqual({ h: 0, s: -0.05, v: 0 });
    expect(spectrumKeyDelta("ArrowRight")).toEqual({ h: 0, s: 0.05, v: 0 });
    expect(spectrumKeyDelta("ArrowUp")).toEqual({ h: 0, s: 0, v: 0.05 });
    expect(spectrumKeyDelta("ArrowDown")).toEqual({ h: 0, s: 0, v: -0.05 });
  });

  it("moves hue with Ctrl+Left/Right and coarsens with Shift", () => {
    expect(spectrumKeyDelta("ArrowRight", { ctrlKey: true })).toEqual({ h: 10, s: 0, v: 0 });
    expect(spectrumKeyDelta("ArrowLeft", { ctrlKey: true })).toEqual({ h: -10, s: 0, v: 0 });
    expect(spectrumKeyDelta("ArrowUp", { ctrlKey: true })).toEqual({ h: 0, s: 0, v: 0 });
    expect(spectrumKeyDelta("ArrowRight", { shiftKey: true })).toEqual({ h: 0, s: 0.2, v: 0 });
    expect(spectrumKeyDelta("ArrowDown", { shiftKey: true })).toEqual({ h: 0, s: 0, v: -0.2 });
    expect(spectrumKeyDelta("ArrowRight", { shiftKey: true, ctrlKey: true })).toEqual({ h: 30, s: 0, v: 0 });
    expect(spectrumKeyDelta("Enter")).toEqual({ h: 0, s: 0, v: 0 });
  });
});

describe("spectrum keyboard interaction", () => {
  /** @type {HTMLCanvasElement} */
  let canvas;
  /** @type {HTMLButtonElement} */
  let triggerBtn;

  beforeAll(() => {
    document.body.innerHTML = "";
    const popup = document.createElement("div");
    popup.id = "color-picker-popup";
    canvas = document.createElement("canvas");
    canvas.id = "cp-spectrum";
    popup.appendChild(canvas);
    document.body.appendChild(popup);
    triggerBtn = document.createElement("button");
    triggerBtn.className = "btn-custom-color";
    triggerBtn.dataset.target = "dots";
    document.body.appendChild(triggerBtn);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    initColorPicker();
    // Spectrum listeners (including the canvas keyboard handler) are bound when
    // the picker opens, not at init, so open the picker before pressing keys.
    triggerBtn.click();
  });

  afterAll(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  const press = (key, options = {}) =>
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));

  beforeEach(() => {
    updateFromHsl(10, 100, 120);
  });

  it("steps saturation with Left/Right and keeps the hue", () => {
    const s0 = cpHsv.s;
    press("ArrowRight");
    expect(cpHsv.s).toBeGreaterThan(s0);
    press("ArrowLeft");
    press("ArrowLeft");
    expect(cpHsv.s).toBeLessThan(s0);
    expect(cpHsv.h).toBeCloseTo(15, 0);
  });

  it("steps and clamps brightness with Up/Down", () => {
    const v0 = cpHsv.v;
    press("ArrowUp");
    expect(cpHsv.v).toBeCloseTo(Math.min(1, v0 + 0.05), 2);
    updateFromHsl(10, 240, 120);
    expect(cpHsv.v).toBe(1);
    press("ArrowUp");
    expect(cpHsv.v).toBe(1);
    updateFromHsl(10, 100, 2);
    press("ArrowDown");
    press("ArrowDown");
    expect(cpHsv.v).toBe(0);
  });

  it("moves hue with Ctrl+Left/Right and wraps at 360", () => {
    updateFromHsl(238, 100, 120);
    expect(cpHsv.h).toBeCloseTo(357, 5);
    press("ArrowRight", { ctrlKey: true });
    expect(cpHsv.h).toBeCloseTo(7, 0);
  });
});

describe("gradient control staleness", () => {
  /** @type {HTMLElement} */
  let popup;
  /** @type {HTMLButtonElement} */
  let triggerBtn;
  /** @type {HTMLInputElement} */
  let modeGradient;
  /** @type {HTMLInputElement} */
  let gradColor2;
  /** @type {HTMLInputElement} */
  let hue;
  /** @type {HTMLButtonElement} */
  let stop0;
  /** @type {HTMLButtonElement} */
  let stop1;
  /** @type {Error[]} */
  let uncaughtErrors;

  /** jsdom reports exceptions thrown inside event listeners on window; collect
   * them so click-driven crash paths fail the test. @param {ErrorEvent} e */
  const recordError = (e) => {
    uncaughtErrors.push(e.error instanceof Error ? e.error : new Error(String(e.message)));
  };

  /** Resolve the browser-normalized value of a CSS background so assertions
   * are format-independent. @param {string} hex @returns {string} */
  const cssColor = (hex) => {
    const probe = document.createElement("div");
    probe.style.background = hex;
    return probe.style.background;
  };

  const openGradient = () => {
    modeGradient.click();
  };

  beforeEach(() => {
    uncaughtErrors = [];
    window.addEventListener("error", recordError);
    document.body.innerHTML = "";
    state.generator.dotsColor = "#FFFFFF";
    state.generator.dotsGradient = null;
    state.generator.cornersSquareGradient = null;
    state.generator.cornersDotGradient = null;

    popup = document.createElement("div");
    popup.id = "color-picker-popup";
    popup.innerHTML = `
      <button type="button" id="cp-mode-solid" class="is-active"></button>
      <button type="button" id="cp-mode-gradient"></button>
      <div id="cp-gradient-controls" class="hidden">
        <button type="button" id="cp-stop-0" class="cp-stop is-active"></button>
        <button type="button" id="cp-stop-1" class="cp-stop"></button>
        <input type="text" id="cp-grad-color2">
        <select id="cp-gradient-type">
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
        </select>
        <input type="range" id="cp-gradient-angle">
      </div>
      <div class="cp-hue"><input type="range" id="cp-hue" min="0" max="360" value="0" aria-label="Hue"></div>
      <button type="button" id="btn-close-cp">Close</button>
      <button type="button" id="cp-reset-btn">Reset</button>
      <button type="button" id="cp-ok-btn">OK</button>
      <div id="cp-presets">
        <button type="button" class="cp-preset" data-hex="#00FF00"></button>
      </div>`;
    document.body.appendChild(popup);

    triggerBtn = document.createElement("button");
    triggerBtn.className = "btn-custom-color";
    triggerBtn.dataset.target = "dots";
    document.body.appendChild(triggerBtn);

    DOM.colorDotsText = document.createElement("input");
    DOM.colorBgText = document.createElement("input");
    DOM.colorFgMediumText = document.createElement("input");
    DOM.colorCornersSquareText = document.createElement("input");
    DOM.colorCornersDotText = document.createElement("input");
    DOM.qrCanvasContainer = document.createElement("div");
    DOM.qrPreviewContainer = document.createElement("div");
    DOM.emptyStateQr = document.createElement("div");
    DOM.btnDownload = document.createElement("button");
    DOM.btnCopy = document.createElement("button");
    DOM.btnSave = document.createElement("button");
    DOM.btnShareLink = document.createElement("button");

    modeGradient = popup.querySelector("#cp-mode-gradient");
    gradColor2 = popup.querySelector("#cp-grad-color2");
    hue = popup.querySelector("#cp-hue");
    stop0 = popup.querySelector("#cp-stop-0");
    stop1 = popup.querySelector("#cp-stop-1");
    initColorPicker();
    triggerBtn.click();
  });

  afterEach(() => {
    window.removeEventListener("error", recordError);
  });

  it("refreshes the start chip after a preset click", () => {
    openGradient();
    expect(stop0.style.background).toBe(cssColor("#FFFFFF"));
    popup.querySelector(".cp-preset").click();
    expect(state.generator.dotsColor).toBe("#00FF00");
    expect(stop0.style.background).toBe(cssColor("#00FF00"));
  });

  it("never clobbers the corner colors/gradients when the foreground changes", () => {
    // Regression: in Medium mode the foreground used to propagate into both
    // corners (they were hidden there); now they have their own controls.
    DOM.complexitySelect = document.createElement("select");
    DOM.complexitySelect.innerHTML = '<option value="medium" selected>Medium</option>';
    state.generator.cornersSquareColor = "#112233";
    state.generator.cornersDotColor = "#445566";
    state.generator.cornersSquareGradient = { type: "linear", rotation: 30, color2: "#778899" };
    DOM.colorCornersSquareText.value = "#112233";
    DOM.colorCornersDotText.value = "#445566";

    openGradient();
    popup.querySelector(".cp-preset").click();

    expect(state.generator.dotsColor).toBe("#00FF00");
    expect(state.generator.cornersSquareColor).toBe("#112233");
    expect(state.generator.cornersDotColor).toBe("#445566");
    expect(state.generator.cornersSquareGradient).toEqual({
      type: "linear",
      rotation: 30,
      color2: "#778899",
    });
    expect(DOM.colorCornersSquareText.value).toBe("#112233");
    expect(DOM.colorCornersDotText.value).toBe("#445566");
  });

  it("Reset restores the chips, the end-color field and the gradient state", () => {
    openGradient();
    popup.querySelector(".cp-preset").click();
    gradColor2.value = "#123456";
    gradColor2.dispatchEvent(new Event("change"));
    expect(stop1.style.background).toBe(cssColor("#123456"));

    popup.querySelector("#cp-reset-btn").click();
    expect(state.generator.dotsGradient).toBeNull();
    expect(state.generator.dotsColor).toBe("#FFFFFF");
    expect(stop0.style.background).toBe(cssColor("#FFFFFF"));
    expect(gradColor2.value).toBe("");
    expect(modeGradient.classList.contains("is-active")).toBe(false);
  });

  it("keeps the end chip and field in sync when switching stops and committing", () => {
    openGradient();
    gradColor2.value = "#00AAFF";
    gradColor2.dispatchEvent(new Event("change"));
    stop1.click();
    expect(cpColor.hex).toBe("#00AAFF");
    expect(hue.value).toBe("200");
    expect(cpHsv.h).toBeCloseTo(200, 5);
    expect(stop1.classList.contains("is-active")).toBe(true);
    expect(stop1.getAttribute("aria-pressed")).toBe("true");

    popup.querySelector(".cp-preset").click();
    expect(state.generator.dotsGradient.color2).toBe("#00FF00");
    expect(gradColor2.value).toBe("#00FF00");
    expect(stop1.style.background).toBe(cssColor("#00FF00"));

    stop0.click();
    expect(cpColor.hex).toBe("#FFFFFF");
    expect(stop0.getAttribute("aria-pressed")).toBe("true");
    expect(stop1.getAttribute("aria-pressed")).toBe("false");
  });

  it("reopening reseeds the chips, end-color field and active stop", () => {
    openGradient();
    stop1.click();
    gradColor2.value = "#00AAFF";
    gradColor2.dispatchEvent(new Event("change"));
    triggerBtn.click();
    expect(stop0.style.background).toBe(cssColor("#FFFFFF"));
    expect(stop1.style.background).toBe(cssColor("#00AAFF"));
    expect(gradColor2.value).toBe("#00AAFF");
    expect(stop0.classList.contains("is-active")).toBe(true);
    expect(modeGradient.classList.contains("is-active")).toBe(true);
  });

  it("clears the active gradient stop on close so panel hex edits hit the base color", () => {
    openGradient();
    stop1.click();
    gradColor2.value = "#00AAFF";
    gradColor2.dispatchEvent(new Event("change"));
    const endColor = state.generator.dotsGradient.color2;
    // Outside click closes without cancelling; the stale end stop used to stay
    // active and hijack the next base-color edit.
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(popup.classList.contains("opacity-0")).toBe(true);

    const swatch = document.createElement("div");
    swatch.id = "swatch-bg-dots";
    document.body.appendChild(swatch);

    // The panel hex field routes through updateColorState (controls.js).
    updateColorState("dots", "#123456");

    expect(state.generator.dotsColor).toBe("#123456");
    expect(state.generator.dotsGradient.color2).toBe(endColor);
    expect(DOM.colorDotsText.value).toBe("#123456");
    expect(swatch.style.background).toContain("rgb(18, 52, 86)");
  });

  it("cancel restores the original gradient end color without corrupting it", () => {
    state.generator.dotsGradient = { type: "linear", rotation: 45, color2: "#00AAFF" };
    triggerBtn.click();
    stop1.click();
    gradColor2.value = "#FF00FF";
    gradColor2.dispatchEvent(new Event("change"));
    expect(state.generator.dotsGradient.color2).toBe("#FF00FF");
    popup.querySelector("#btn-close-cp").click();
    expect(state.generator.dotsGradient.color2).toBe("#00AAFF");
    expect(gradColor2.value).toBe("#00AAFF");
    expect(uncaughtErrors).toEqual([]);
  });

  it("tolerates a gradient spec that is missing its end color", () => {
    state.generator.dotsGradient = { type: "linear", rotation: 45 };
    expect(() => triggerBtn.click()).not.toThrow();
    expect(gradColor2.value).toBe("");
    expect(modeGradient.classList.contains("is-active")).toBe(true);
    expect(stop0.style.background).toBe(cssColor("#FFFFFF"));
    expect(stop1.style.background).not.toBe(cssColor("#FFFFFF"));
    expect(() => stop1.click()).not.toThrow();
    expect(stop1.classList.contains("is-active")).toBe(false);
    expect(stop0.classList.contains("is-active")).toBe(true);
    expect(uncaughtErrors).toEqual([]);
  });

  it("flags an invalid end-color hex instead of silently reverting", () => {
    openGradient();
    gradColor2.value = "not-a-color";
    gradColor2.dispatchEvent(new Event("change"));
    expect(gradColor2.getAttribute("aria-invalid")).toBe("true");
    expect(gradColor2.classList.contains("cp-hex-shake")).toBe(true);
    // The field is repaired to the last valid end color.
    expect(gradColor2.value).toBe(state.generator.dotsGradient.color2.toUpperCase());

    gradColor2.value = "#123456";
    gradColor2.dispatchEvent(new Event("input"));
    expect(gradColor2.hasAttribute("aria-invalid")).toBe(false);
    expect(gradColor2.classList.contains("cp-hex-shake")).toBe(false);
    expect(state.generator.dotsGradient.color2).toBe("#123456");
  });
});

describe("picker seeding from the current color", () => {
  /** @type {HTMLDivElement} */
  let popup;
  /** @type {HTMLButtonElement} */
  let triggerBtn;
  /** @type {HTMLCanvasElement} */
  let canvas;
  /** @type {HTMLInputElement} */
  let hue;
  /** @type {HTMLInputElement} */
  let hexInput;

  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  beforeEach(() => {
    document.body.innerHTML = "";
    state.generator.dotsColor = "#3366CC";
    state.generator.dotsGradient = null;
    state.generator.cornersSquareGradient = null;
    state.generator.cornersDotGradient = null;

    popup = document.createElement("div");
    popup.id = "color-picker-popup";
    popup.innerHTML = `
      <canvas id="cp-spectrum"></canvas>
      <div class="cp-hue"><input type="range" id="cp-hue" min="0" max="360" value="0" aria-label="Hue"></div>
      <input type="text" id="cp-input-hex">`;
    document.body.appendChild(popup);

    triggerBtn = document.createElement("button");
    triggerBtn.className = "btn-custom-color";
    triggerBtn.dataset.target = "dots";
    document.body.appendChild(triggerBtn);

    DOM.colorDotsText = document.createElement("input");
    DOM.qrCanvasContainer = document.createElement("div");
    DOM.qrPreviewContainer = document.createElement("div");
    DOM.emptyStateQr = document.createElement("div");
    DOM.btnDownload = document.createElement("button");
    DOM.btnCopy = document.createElement("button");
    DOM.btnSave = document.createElement("button");
    DOM.btnShareLink = document.createElement("button");

    canvas = popup.querySelector("#cp-spectrum");
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
    });
    hue = popup.querySelector("#cp-hue");
    hexInput = popup.querySelector("#cp-input-hex");

    initColorPicker();
  });

  it("seeds hue, saturation, value and the hex field from the target color on open", () => {
    triggerBtn.click();
    expect(hexInput.value).toBe("#3366CC");
    expect(hue.value).toBe("220");
    expect(cpHsv.h).toBeCloseTo(220, 5);
    expect(cpHsv.s).toBeCloseTo(0.75, 2);
    expect(cpHsv.v).toBeCloseTo(0.8, 2);
  });

  it("changes the color on the first field click instead of keeping a default brightness", () => {
    triggerBtn.click();
    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 50, clientY: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup"));
    const expected = hsvToRgb(220, 50 / 99, 1);
    expect(state.generator.dotsColor).toBe(rgbToHex(expected.r, expected.g, expected.b).toUpperCase());
    expect(state.generator.dotsColor).not.toBe("#3366CC");
  });

  it("keeps saturation and value when the hue slider moves", () => {
    triggerBtn.click();
    const s0 = cpHsv.s;
    const v0 = cpHsv.v;
    hue.value = "120";
    hue.dispatchEvent(new Event("input"));
    expect(state.generator.dotsColor).toBe("#33CC33");
    expect(cpHsv.s).toBeCloseTo(s0, 5);
    expect(cpHsv.v).toBeCloseTo(v0, 5);
  });
});

describe("custom select edge cases", () => {
  it("syncCustomSelect tolerates null selects and missing wrapper parts", () => {
    expect(() => syncCustomSelect(null)).not.toThrow();
    expect(() => syncCustomSelect(undefined)).not.toThrow();
    const orphan = document.createElement("select");
    orphan.innerHTML = "<option>A</option>";
    expect(() => syncCustomSelect(orphan)).not.toThrow();
    const wrapper = document.createElement("div");
    wrapper.className = "custom-select-wrapper";
    wrapper.appendChild(orphan);
    expect(() => syncCustomSelect(orphan)).not.toThrow();
    expect(orphan.selectedIndex).toBe(0);
  });

  it("clears a dangling aria-activedescendant and survives missing option elements", () => {
    const wrapper = document.createElement("div");
    wrapper.className = "custom-select-wrapper";
    wrapper.innerHTML = `
      <div class="custom-select-trigger"></div>
      <div class="custom-select-options"><div></div><div></div></div>
      <select><option>A</option><option>B</option></select>`;
    document.body.appendChild(wrapper);
    const select = wrapper.querySelector("select");
    const trigger = wrapper.querySelector(".custom-select-trigger");

    select.selectedIndex = 1;
    syncCustomSelect(select);
    expect(trigger.textContent).toBe("B");
    expect(trigger.getAttribute("aria-activedescendant")).toContain("-option-1");

    select.selectedIndex = -1;
    syncCustomSelect(select);
    expect(trigger.hasAttribute("aria-activedescendant")).toBe(false);
    expect(trigger.textContent).toBe("");

    const sparse = document.createElement("div");
    sparse.className = "custom-select-wrapper";
    sparse.innerHTML = `
      <div class="custom-select-trigger"></div>
      <div class="custom-select-options"></div>
      <select><option>A</option><option>B</option></select>`;
    document.body.appendChild(sparse);
    const sparseSelect = sparse.querySelector("select");
    const sparseTrigger = sparse.querySelector(".custom-select-trigger");
    expect(() => syncCustomSelect(sparseSelect)).not.toThrow();
    expect(sparseTrigger.textContent).toBe("A");
    expect(sparseTrigger.hasAttribute("aria-activedescendant")).toBe(false);
  });
});

describe("flashButton edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores the label and the feedback classes after the timeout", () => {
    const btn = document.createElement("button");
    btn.textContent = "Save";
    document.body.appendChild(btn);
    flashButton(btn, "Copied", 1000, ["bg-white", "text-black"]);
    expect(btn.textContent).toBe("Copied");
    expect(btn.classList.contains("bg-white")).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(btn.textContent).toBe("Save");
    expect(btn.classList.contains("bg-white")).toBe(false);
    expect(btn.classList.contains("text-black")).toBe(false);
  });

  it("restores the pristine label after rapid repeated flashes", () => {
    const btn = document.createElement("button");
    btn.textContent = "Save";
    flashButton(btn, "Copied", 1000);
    vi.advanceTimersByTime(400);
    flashButton(btn, "Downloaded", 1000);
    expect(btn.textContent).toBe("Downloaded");
    vi.advanceTimersByTime(1000);
    expect(btn.textContent).toBe("Save");
    expect(btn.classList.contains("bg-white")).toBe(false);
  });

  it("ignores null buttons and non-array class lists", () => {
    expect(() => flashButton(null, "Copied")).not.toThrow();
    const btn = document.createElement("button");
    btn.textContent = "Go";
    expect(() => flashButton(btn, "Done", 500, null)).not.toThrow();
    expect(btn.textContent).toBe("Done");
    vi.advanceTimersByTime(500);
    expect(btn.textContent).toBe("Go");
  });
});

describe("custom select dismissal and disabled options", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="custom-select-wrapper">
        <div class="custom-select-trigger" tabindex="0"></div>
        <div class="custom-select-options"><div class="custom-select-option" data-index="0">A</div><div class="custom-select-option" data-index="1">B</div></div>
        <select aria-label="Pick"><option>A</option><option disabled>B</option></select>
      </div>`;
    initCustomSelects();
  });

  const wrapper = () => document.querySelector(".custom-select-wrapper");
  const trigger = () => wrapper().querySelector(".custom-select-trigger");
  const select = () => wrapper().querySelector("select");
  const options = () => Array.from(wrapper().querySelectorAll(".custom-select-option"));

  it("closes an open dropdown when focus tabs away", () => {
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(wrapper().classList.contains("open")).toBe(true);
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(wrapper().classList.contains("open")).toBe(false);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("only swallows Escape while the dropdown is open", () => {
    const escapes = [];
    const onDocumentEscape = (e) => {
      if (e.key === "Escape") escapes.push(e);
    };
    document.addEventListener("keydown", onDocumentEscape);

    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(escapes).toHaveLength(1);

    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(wrapper().classList.contains("open")).toBe(true);
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(escapes).toHaveLength(1);
    expect(wrapper().classList.contains("open")).toBe(false);

    document.removeEventListener("keydown", onDocumentEscape);
  });

  it("marks disabled native options with aria-disabled and skips them", () => {
    expect(options()[1].getAttribute("aria-disabled")).toBe("true");
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    // The only enabled option stays selected instead of landing on B.
    expect(select().selectedIndex).toBe(0);
  });
});

describe("spectrum drag listeners are lazy", () => {
  it("binds no window drag listeners at init, only once the picker opens", () => {
    document.body.innerHTML = "";
    const popup = document.createElement("div");
    popup.id = "color-picker-popup";
    const canvas = document.createElement("canvas");
    canvas.id = "cp-spectrum";
    popup.appendChild(canvas);
    document.body.appendChild(popup);
    const trigger = document.createElement("button");
    trigger.className = "btn-custom-color";
    trigger.dataset.target = "dots";
    document.body.appendChild(trigger);

    const dragEvents = ["mousemove", "mouseup", "touchmove", "touchend"];
    const addSpy = vi.spyOn(window, "addEventListener");
    initColorPicker();
    expect(addSpy.mock.calls.filter(([type]) => dragEvents.includes(type))).toHaveLength(0);

    trigger.click();
    const bound = addSpy.mock.calls
      .filter(([type]) => dragEvents.includes(type))
      .map(([type]) => type)
      .sort();
    expect(bound).toEqual(["mousemove", "mouseup", "touchend", "touchmove"]);
    addSpy.mockRestore();
    document.body.innerHTML = "";
  });
});
