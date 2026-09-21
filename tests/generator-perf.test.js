import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../src/js/state";
import { DOM } from "../src/js/ui/dom.js";
import { generateQR, renderOnce } from "../src/js/generator/generator.js";
import { applySurroundShape } from "./helpers/svg-doc.js";
import { innerPaddingForMask, maskVerticalShift, SVG_NS } from "../src/js/generator/mask.js";
import { DEBOUNCE_GENERATE_MS } from "../src/js/constants.js";

const RAW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="308" height="308">' +
  '<rect x="0" y="0" width="308" height="308" fill="#ffffff"/>' +
  '<rect x="4" y="4" width="300" height="300" fill="#000000"/></svg>';

const initial = { ...state.generator };
let stats;

function installLibraryStub() {
  stats = { updates: 0, rawReads: 0 };
  globalThis.qrcode = () => ({
    addData() {},
    make() {},
    getModuleCount: () => 25,
  });
  globalThis.QRCodeStyling = class {
    update() {
      stats.updates++;
    }
    getRawData() {
      stats.rawReads++;
      return Promise.resolve({ text: async () => RAW_SVG });
    }
  };
}

function installDom() {
  DOM.qrCanvasContainer = document.createElement("div");
  DOM.qrPreviewContainer = document.createElement("div");
  DOM.emptyStateQr = document.createElement("div");
  DOM.btnDownload = document.createElement("button");
  DOM.btnCopy = document.createElement("button");
  DOM.btnSave = document.createElement("button");
  DOM.btnShareLink = document.createElement("button");
  DOM.qrLoading = null;
  DOM.marginWarning = null;
  DOM.qrReadabilityBadge = null;
}

function resetGenerator() {
  Object.assign(state.generator, initial);
  state.generator.dataType = "text";
  state.generator.dataString = "hello";
  state.generator.isValid = true;
  state.generator.width = 300;
  state.generator.height = 300;
  state.generator.margin = 4;
  state.generator.bgColor = "#ffffff";
  state.generator.dotsColor = "#000000";
  state.generator.cornersSquareColor = "#000000";
  state.generator.cornersDotColor = "#000000";
  state.generator.bgTransparent = false;
  state.generator.shapeBody = "square";
  state.generator.shapeOuter = "square";
  state.generator.shapeInner = "square";
  state.generator.maskType = "none";
  state.generator.maskCustom = "";
  state.generator.qrRadius = 0;
  state.generator.logoDataUrl = null;
  state.generator.bgImageDataUrl = null;
  state.generator.frameStyle = "none";
  state.generator.frameText = "";
  state.generator.frameColor = "";
  state.generator.frameTextColor = "";
}

/** Flush the async render started by generateQR(). */
const flushRender = () => vi.advanceTimersByTimeAsync(0);

describe("generateQR render economy", () => {
  // getQrCode() builds and draws the library instance once (constructor +
  // explicit update); warm it up so the counters below measure steady-state
  // generateQR work only.
  beforeEach(async () => {
    vi.useFakeTimers();
    installDom();
    installLibraryStub();
    resetGenerator();
    state.generator.dataString = "warmup";
    generateQR(true);
    await flushRender();
    stats.updates = 0;
    stats.rawReads = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.assign(state.generator, initial);
    delete globalThis.qrcode;
    delete globalThis.QRCodeStyling;
  });

  it("coalesces a typing burst into exactly one library render", async () => {
    for (let i = 0; i < 12; i++) {
      state.generator.dataString = `https://example.com/${i}`;
      generateQR();
    }
    expect(stats.updates).toBe(0);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_GENERATE_MS + 10);
    expect(stats.updates).toBe(1);
    expect(stats.rawReads).toBe(1);
  });

  it("an immediate render supersedes a debounced one (no duplicate work)", async () => {
    state.generator.dataString = "https://example.com/immediate";
    generateQR();
    generateQR(true);
    await flushRender();
    expect(stats.updates).toBe(1);
    // The superseded debounce must not fire a second render later.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_GENERATE_MS * 3);
    expect(stats.updates).toBe(1);
    expect(stats.rawReads).toBe(1);
  });

  it("reuses the last SVG when the same config is requested again", async () => {
    state.generator.dataString = "https://example.com/memo";
    generateQR(true);
    await flushRender();
    expect(stats.updates).toBe(1);
    expect(stats.rawReads).toBe(1);

    generateQR(true);
    await flushRender();
    expect(stats.updates).toBe(1);
    expect(stats.rawReads).toBe(1);
    // The preview is still populated without rewriting it.
    expect(DOM.qrCanvasContainer.querySelector("svg")).not.toBeNull();
  });

  it("renders again when a rendered field changes", async () => {
    state.generator.dataString = "https://example.com/change";
    generateQR(true);
    await flushRender();
    state.generator.dotsColor = "#123456";
    generateQR(true);
    await flushRender();
    expect(stats.updates).toBe(2);
  });

  it("drops the logo from the render when the logo is cleared", async () => {
    state.generator.logoDataUrl = "data:image/png;base64,AAAA";
    generateQR(true);
    await flushRender();
    expect(DOM.qrCanvasContainer.innerHTML).toContain("qr-logo-image");

    state.generator.logoDataUrl = null;
    generateQR(true);
    await flushRender();
    expect(DOM.qrCanvasContainer.innerHTML).not.toContain("qr-logo-image");
    // Logo toggles also recreate the library instance, so the update count is
    // not pinned here — only that the render happened and dropped the image.
    expect(stats.updates).toBeGreaterThan(0);
  });

  it("coalesces readability rasterisations for rapid renders", async () => {
    DOM.qrReadabilityBadge = document.createElement("div");
    const originalUrl = globalThis.URL;
    const originalImage = globalThis.Image;
    const createObjectURL = vi.fn(() => "blob:readability");
    globalThis.URL = { createObjectURL, revokeObjectURL: vi.fn() };
    globalThis.Image = class {
      set src(value) {
        this._src = value;
        if (this.onload) this.onload();
      }
      get src() {
        return this._src;
      }
    };
    try {
      for (let i = 0; i < 3; i++) {
        state.generator.dataString = `https://example.com/readability-${i}`;
        generateQR(true);
        await flushRender();
      }
      expect(createObjectURL).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(150);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.URL = originalUrl;
      globalThis.Image = originalImage;
    }
  });

  it("skips the library update and raw read for frame-only edits", async () => {
    state.generator.dataString = "https://example.com/frame-economy";
    state.generator.frameStyle = "label";
    state.generator.frameText = "Frame one";
    state.generator.frameTextEnabled = true;
    state.generator.frameFont = "theme";
    generateQR(true);
    await flushRender();
    expect(stats.updates).toBe(1);
    expect(stats.rawReads).toBe(1);

    const updates = stats.updates;
    const rawReads = stats.rawReads;
    state.generator.frameText = "Frame two";
    generateQR(true);
    await flushRender();
    // The label edit changes the rendered SVG but not the styling options,
    // so the cached raw SVG is reused instead of re-rendering the library.
    expect(stats.updates).toBe(updates);
    expect(stats.rawReads).toBe(rawReads);
    expect(DOM.qrCanvasContainer.innerHTML).toContain("Frame two");
  });
});

describe("renderOnce settles on oversized payloads", () => {
  beforeEach(() => {
    installDom();
    resetGenerator();
    state.generator.dataString = "hello";
    globalThis.qrcode = () => ({
      addData() {},
      make() {
        throw new Error("code length overflow");
      },
      getModuleCount: () => 21,
    });
    globalThis.QRCodeStyling = class {
      update() {}
      getRawData() {
        return Promise.resolve({ text: async () => RAW_SVG });
      }
    };
  });

  afterEach(() => {
    Object.assign(state.generator, initial);
    delete globalThis.qrcode;
    delete globalThis.QRCodeStyling;
  });

  it("rejects the pending render with the friendly message instead of hanging", async () => {
    await expect(
      renderOnce({ dataType: "text", dataString: "x".repeat(5000), isValid: true })
    ).rejects.toThrow(/Data is too large for ECC level/);
    // The unavailable state ran: preview hidden, actions disabled, message shown.
    expect(DOM.emptyStateQr.textContent).toContain("Data is too large for ECC level");
    expect(DOM.btnDownload.disabled).toBe(true);
    expect(DOM.emptyStateQr.classList.contains("hidden")).toBe(false);
  });

  it("keeps settling the queue for renders after an overflow failure", async () => {
    await expect(renderOnce({ dataString: "too big" })).rejects.toThrow(/Data is too large/);
    // A later, renderable config must still run (queue not poisoned by the rejection).
    globalThis.qrcode = () => ({
      addData() {},
      make() {},
      getModuleCount: () => 21,
    });
    await expect(renderOnce({ dataString: "small", isValid: true })).resolves.toMatchObject({
      moduleCount: 21,
    });
  });
});

describe("mask surround probes are shared between neighbouring cells", () => {
  const originalPath2D = globalThis.Path2D;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPath2D === undefined) delete globalThis.Path2D;
    else globalThis.Path2D = originalPath2D;
    Object.assign(state.generator, initial);
  });

  it("calls isPointInPath about once per lattice point, not five times", () => {
    const calls = { n: 0 };
    globalThis.Path2D = class {
      constructor() {}
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      isPointInPath: () => {
        calls.n++;
        return true;
      },
    });

    const moduleCount = 21;
    const width = 150;
    state.generator.width = width;
    state.generator.height = width;
    state.generator.maskType = "star";
    state.generator.shapeBody = "square";
    state.generator.dotsColor = "#ffffff";
    state.generator.bgColor = "#000000";

    const moduleSize = Math.max(1, Math.floor(width / moduleCount));
    const userMarginPx = 4;
    const pad = innerPaddingForMask("star", moduleCount);
    const totalMargin = userMarginPx + pad * moduleSize;
    const canvas = moduleCount * moduleSize + 2 * totalMargin;
    const startX = totalMargin % moduleSize;
    const startY = (totalMargin + maskVerticalShift("star", moduleCount) * moduleSize) % moduleSize;
    const cols = Math.ceil((canvas - startX) / moduleSize);
    const rows = Math.ceil((canvas - startY) / moduleSize);
    const svg =
      `<svg xmlns="${SVG_NS}" width="${canvas}" height="${canvas}">` +
      `<rect x="0" y="0" width="${canvas}" height="${canvas}" fill="#000000"/>` +
      `<g><rect x="0" y="0" width="9" height="9" fill="#ffffff"/></g>` +
      `</svg>`;

    const out = applySurroundShape(svg, userMarginPx, canvas, canvas, moduleCount);

    expect(calls.n).toBeGreaterThan(0);
    // Distinct lattice coordinates are at most (cols+2)x(rows+2); before the
    // probe cache each in-shape cell called isPointInPath five times (~5x).
    expect(calls.n).toBeLessThanOrEqual((cols + 2) * (rows + 2));
    expect(calls.n).toBeLessThan(2 * cols * rows);
    // The surround layer still renders (the cache must not change the result).
    expect(out).toContain("<rect");
    expect(out.length).toBeGreaterThan(svg.length);
  });
});

describe("color picker spectrum repaint coalescing", () => {
  it("paints at most once per frame for a burst of color updates", async () => {
    document.body.innerHTML = '<div id="color-picker-popup"></div>';
    const canvas = document.createElement("canvas");
    canvas.id = "cp-spectrum";
    document.getElementById("color-picker-popup").appendChild(canvas);
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { initColorPicker, updateFromHsl } = await import("../src/js/ui/color-picker.js");
    initColorPicker();
    getContext.mockClear();

    vi.useFakeTimers();
    updateFromHsl(10, 100, 120);
    updateFromHsl(20, 100, 120);
    updateFromHsl(30, 100, 120);
    await vi.advanceTimersByTimeAsync(32);
    vi.useRealTimers();

    expect(getContext).toHaveBeenCalledTimes(1);
    getContext.mockRestore();
    document.body.innerHTML = "";
  });
});

/**
 * Fresh module instances so render-queue and memo state from the earlier tests
 * in this file cannot leak into the sequencing tests below.
 */
async function freshApp() {
  vi.resetModules();
  const dom = await import("../src/js/ui/dom.js");
  const stateMod = await import("../src/js/state");
  const generatorMod = await import("../src/js/generator/generator.js");
  const { DOM } = dom;
  DOM.qrCanvasContainer = document.createElement("div");
  DOM.qrPreviewContainer = document.createElement("div");
  DOM.emptyStateQr = document.createElement("div");
  DOM.btnDownload = document.createElement("button");
  DOM.btnCopy = document.createElement("button");
  DOM.btnSave = document.createElement("button");
  DOM.btnShareLink = document.createElement("button");
  DOM.qrLoading = null;
  DOM.marginWarning = null;
  DOM.qrReadabilityBadge = null;
  const { state } = stateMod;
  state.generator.dataType = "text";
  state.generator.dataString = "live";
  state.generator.isValid = true;
  state.generator.width = 300;
  state.generator.height = 300;
  state.generator.margin = 4;
  state.generator.frameStyle = "none";
  state.generator.maskType = "none";
  state.generator.logoDataUrl = null;
  state.generator.bgImageDataUrl = null;
  return { DOM, state, ...generatorMod };
}

describe("renderOnce keeps concurrent edits", () => {
  /** @type {(svg: string) => void} */
  let resolveRaw;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.qrcode = () => ({ addData() {}, make() {}, getModuleCount: () => 25 });
    globalThis.QRCodeStyling = class {
      update() {}
      getRawData() {
        return new Promise((resolve) => {
          resolveRaw = (svg) => resolve({ text: async () => svg });
        });
      }
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.qrcode;
    delete globalThis.QRCodeStyling;
  });

  it("restores only the keys the one-off render still owns", async () => {
    const app = await freshApp();
    const pending = app.renderOnce({ dataString: "export-snapshot", bgColor: "#000000" });
    await vi.advanceTimersByTimeAsync(50);
    expect(typeof resolveRaw).toBe("function");

    // The user edits a field the export snapshot also set, mid-render.
    app.state.generator.bgColor = "#ff0000";
    resolveRaw(RAW_SVG);
    await pending;

    expect(app.state.generator.bgColor).toBe("#ff0000");
    // Untouched override keys are still restored to the live config.
    expect(app.state.generator.dataString).toBe("live");
  });
});

describe("superseded renders do not publish the SVG memo", () => {
  /** @type {((svg: string) => void)[]} */
  let pendingRaw;
  const svgFor = (label) => RAW_SVG.replace('fill="#000000"', `fill="#000000" data-label="${label}"`);

  beforeEach(() => {
    pendingRaw = [];
    vi.useFakeTimers();
    globalThis.qrcode = () => ({ addData() {}, make() {}, getModuleCount: () => 25 });
    globalThis.QRCodeStyling = class {
      update() {}
      getRawData() {
        return new Promise((resolve) => {
          pendingRaw.push((svg) => resolve({ text: async () => svg }));
        });
      }
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.qrcode;
    delete globalThis.QRCodeStyling;
  });

  it("re-renders instead of reusing a memo whose SVG never reached the preview", async () => {
    const app = await freshApp();
    // A: slow render that will be superseded before it can publish.
    app.state.generator.dataString = "A";
    app.generateQR(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(pendingRaw).toHaveLength(1);

    app.state.generator.dataString = "B";
    app.generateQR(true);
    pendingRaw[0](svgFor("A"));
    await vi.advanceTimersByTimeAsync(50);
    expect(pendingRaw).toHaveLength(2);

    // B publishes: preview shows B.
    pendingRaw[1](svgFor("B"));
    await vi.advanceTimersByTimeAsync(50);
    expect(app.DOM.qrCanvasContainer.innerHTML).toContain('data-label="B"');

    // Back to A: the superseded A memo must not be reused, because its SVG was
    // never written to the preview.
    app.state.generator.dataString = "A";
    app.generateQR(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(pendingRaw).toHaveLength(3);
    pendingRaw[2](svgFor("A"));
    await vi.advanceTimersByTimeAsync(50);
    expect(app.DOM.qrCanvasContainer.innerHTML).toContain('data-label="A"');
  });
});
