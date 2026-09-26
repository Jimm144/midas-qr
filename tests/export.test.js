import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { applySurroundShape, applyCornerStyles, applyGlobalDotGradient } from "./helpers/svg-doc.js";
import { optimizeSvgRects } from "../src/js/generator/mask.js";
import { applyBackgroundImage } from "./helpers/svg-doc.js";
import { renderSvg } from "../src/js/generator/svg-pipeline.js";
import { buildQrStylingOptions } from "../src/js/generator/qr-instance.js";
import { ensureQrcodeLoaded, generateUnicodeQR } from "../src/js/generator/encoder.js";
import { setRenderInfo, getRenderInfo } from "../src/js/generator/render-info.js";
import { getCombinedSvgString } from "../src/js/generator/frame.js";
import { exportRenderedBlob, sanitizeFilename, updateExportFilenamePlaceholder } from "../src/js/generator/export.js";
import { DOM } from "../src/js/ui/dom.js";
import { state } from "../src/js/state";

afterEach(() => {
  delete globalThis.qrcode;
});

describe("applySurroundShape", () => {
  const svg =
    '<svg><rect width="100" height="100" fill="#ffffff"/><g><rect x="10" y="10" width="10" height="10" fill="#000000"/></g></svg>';

  it("returns the input unchanged when the mask is off", () => {
    state.generator.maskType = "none";
    expect(applySurroundShape(svg, 0, 100, 100, 21, null)).toBe(svg);
  });

  it("renders a circle mask without nested clipPath and ensures viewBox", () => {
        state.generator.maskType = "circle";
        const result = applySurroundShape(svg, 4, 100, 100, 21, null);
        expect(result).toContain('class="qr-mask-bg"');
    expect(result).toContain('viewBox="0 0 100 100"');
    expect(result).not.toContain("qr-mask-clip");
    expect(result).toContain('fill="#000000"');
  });

  it("renders a triangle mask with downward shift and no nested clipPath", () => {
        state.generator.maskType = "triangle";
        state.generator.shapeBody = "dots";
        const result = applySurroundShape(svg, 4, 300, 300, 25, null);
        expect(result).toContain('class="qr-mask-bg"');
    expect(result).not.toContain("qr-mask-clip");
    expect(result).toContain("translate(0,");
    // The decorative surround is intentionally empty; the group must still exist.
  });

  it("renders a heart mask with upward adjustment and no nested clipPath", () => {
    state.generator.maskType = "heart";
    const result = applySurroundShape(svg, 4, 100, 100, 21, null);
    expect(result).toContain("<path");
    expect(result).not.toContain("qr-mask-clip");
  });
});

describe("generateUnicodeQR", () => {
  it("returns null when the qrcode library is absent", () => {
    delete globalThis.qrcode;
    expect(generateUnicodeQR("hello", "M")).toBeNull();
  });

  it("renders block art from a stubbed module matrix", () => {
    const size = 21;
    const mat = Array.from({ length: size }, () => Array(size).fill(true));
    globalThis.qrcode = () => ({
      addData() {},
      make() {},
      getModuleCount: () => size,
      isDark: (r, c) => mat[r][c],
    });
    const out = generateUnicodeQR("hello", "M");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("█");
  });

  it("returns null when the stubbed encoder throws", () => {
    globalThis.qrcode = () => {
      throw new Error("boom");
    };
    expect(generateUnicodeQR("hello", "M")).toBeNull();
  });
});

describe("ensureQrcodeLoaded", () => {
  it("resolves true without network when the qrcode global is already present", async () => {
    globalThis.qrcode = () => ({});
    await expect(ensureQrcodeLoaded()).resolves.toBe(true);
    expect(document.head.querySelector('script[src="src/lib/qrcode.min.js"]')).toBeNull();
  });
});

describe("applyCornerStyles", () => {
  // Mirrors the vendored library: a plain rect painted with an even-odd ring
  // clip path.
  const cornerSvg = (x = 1, y = 1, w = 63, h = 63) =>
    '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<clipPath id="clip-path-corners-square-color-0-0-0">' +
    `<path clip-rule="evenodd" d="M ${x} ${y}h ${w}v ${h}h ${-w}z"/>` +
    "</clipPath></defs>" +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" clip-path="url('#clip-path-corners-square-color-0-0-0')" fill="#000000"/>` +
    "</svg>";

  it("rebuilds the corner ring with arcs for an extended outer style", () => {
    state.generator.shapeOuter = "rounded";
    state.generator.shapeInner = "square";
    const svg = cornerSvg();
    const out = applyCornerStyles(svg);
    expect(out).not.toBe(svg);
    expect(out).toContain("a 13.5 13.5"); // 1.5 * (63/7) outer radius
    expect(out).not.toContain("h 63v 63"); // the sharp ring is gone
  });

  it("leaves square outer corners untouched", () => {
    state.generator.shapeOuter = "square";
    state.generator.shapeInner = "square";
    const svg = cornerSvg();
    expect(applyCornerStyles(svg)).toBe(svg);
  });

  it("ignores corner rects whose clip path cannot be resolved", () => {
    state.generator.shapeOuter = "rounded";
    state.generator.shapeInner = "square";
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="63" height="63" clip-path="url(#missing)"/></svg>';
    expect(applyCornerStyles(svg)).toBe(svg);
  });

  it("restyles inner corner clip rects for the rounded inner style", () => {
    state.generator.shapeOuter = "square";
    state.generator.shapeInner = "rounded";
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
      '<clipPath id="clip-path-corners-dot-color-0-0-0"><rect x="25" y="25" width="30" height="30" transform="rotate(0,40,40)"/></clipPath>' +
      "</defs></svg>";
    const out = applyCornerStyles(svg);
    expect(out).toContain('rx="6"');
    expect(out).toContain('transform="rotate(0,40,40)"');
  });

  it("builds a leaf path for classy inner corners", () => {
    state.generator.shapeOuter = "square";
    state.generator.shapeInner = "classy";
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
      '<clipPath id="clip-path-corners-dot-color-0-0-0"><rect x="25" y="25" width="30" height="30"/></clipPath>' +
      "</defs></svg>";
    const out = applyCornerStyles(svg);
    expect(out).toContain("<path");
    expect(out).toContain("A 15 15");
    expect(out).not.toContain("<rect");
  });
});

describe("applyGlobalDotGradient", () => {
  const libraryLikeSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" fill="#030521"/>' +
    '<rect x="0" y="0" width="100" height="100" clip-path="url(&apos;#clip-path-dot-color-0&apos;)" fill="#FFFFFF"/>' +
    '<rect x="10" y="10" width="20" height="20" clip-path="url(&apos;#clip-path-corners-square-color-1-0&apos;)" fill="#FFFFFF"/>' +
    '<rect x="20" y="20" width="10" height="10" clip-path="url(&apos;#clip-path-corners-dot-color-1-0&apos;)" fill="#FFFFFF"/>' +
    '<rect x="0" y="0" width="100" height="100" clip-path="url(&apos;#clip-path-background-color-0&apos;)" fill="#030521"/>' +
    "</svg>";
  it("paints each group from its own gradient, leaving the others solid", () => {
    state.generator.dotsColor = "#FFFFFF";
    state.generator.dotsGradient = { type: "linear", rotation: 45, color2: "#00C2FF" };
    const out = applyGlobalDotGradient(libraryLikeSvg, 100, 100);
    expect(out).toContain('id="qr-global-grad"');
    expect(out).toContain('stop-color="#FFFFFF"');
    expect(out).toContain('stop-color="#00C2FF"');
    // Only the dots follow the dots gradient: the corners keep their own
    // colours so the corner colour controls always have an effect.
    const repainted = (out.match(/fill="url\(#qr-global-grad\)"/g) || []).length;
    expect(repainted).toBe(1);
    expect(out).toMatch(/clip-path="url\('#clip-path-corners-square-color-1-0'\)"[^>]*fill="#FFFFFF"/);
    expect(out).toMatch(/clip-path="url\('#clip-path-corners-dot-color-1-0'\)"[^>]*fill="#FFFFFF"/);
    // the background rect keeps its own solid fill
    expect(out).toContain('clip-path="url(\'#clip-path-background-color-0\')" fill="#030521"');
  });

  it("uses a corner's own gradient only for that corner", () => {
    state.generator.dotsGradient = null;
    state.generator.cornersDotGradient = { type: "radial", rotation: 0, color2: "#123456" };
    state.generator.cornersDotColor = "#00FF00";
    const out = applyGlobalDotGradient(libraryLikeSvg, 100, 100);
    expect(out).toContain('id="qr-corners-dot-grad"');
    expect(out).toContain('stop-color="#00FF00"');
    expect(out).toContain('stop-color="#123456"');
    expect(out).toMatch(/clip-path="url\('#clip-path-corners-dot-color-1-0'\)"[^>]*fill="url\(#qr-corners-dot-grad\)"/);
    // the dots rect is untouched (still its own solid fill)
    expect(out).toMatch(/clip-path="url\('#clip-path-dot-color-0'\)"[^>]*fill="#FFFFFF"/);
    state.generator.cornersDotGradient = null;
  });

  it("no-ops without a gradient and never round-trips a parser error", () => {
    state.generator.dotsGradient = null;
    expect(applyGlobalDotGradient(libraryLikeSvg, 100, 100)).toBe(libraryLikeSvg);
    state.generator.dotsGradient = { type: "linear", rotation: 45, color2: "#000000" };
    const broken = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="1"/></svg>';
    expect(applyGlobalDotGradient(broken, 100, 100)).toBe(broken);
    state.generator.dotsGradient = null;
  });
});

describe("render info store", () => {
  it("starts empty and round-trips snapshots", () => {
    setRenderInfo(null);
    expect(getRenderInfo()).toBeNull();
    const info = { svg: "<svg></svg>", w: 308, h: 308, moduleCount: 25, userMarginPx: 4 };
    setRenderInfo(info);
    expect(getRenderInfo()).toBe(info);
    setRenderInfo(null);
  });
});

describe("exportRenderedBlob", () => {
  it("returns null when nothing has been rendered yet", async () => {
    setRenderInfo(null);
    await expect(exportRenderedBlob("png")).resolves.toBeNull();
  });

  it("prefers an explicit render over the published one when provided", async () => {
    const stale =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
      '<image class="qr-logo-image" href="data:image/png;base64,AAAA"/></svg>';
    const fresh = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect/></svg>';
    setRenderInfo({ svg: stale, w: 100, h: 100, moduleCount: 21, userMarginPx: 4 });
    const blob = await exportRenderedBlob("svg", { svg: fresh, w: 100, h: 100 });
    expect(await blob.text()).toBe(fresh);
    setRenderInfo(null);
  });

  it("exports the exact rendered SVG including the mask layer", async () => {
    const decorated =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<circle cx="50" cy="50" r="48" fill="#fff"/>' +
      '<rect x="10" y="10" width="80" height="20" fill="#000"/></svg>';
    setRenderInfo({ svg: decorated, w: 100, h: 100, moduleCount: 21, userMarginPx: 4 });
    state.generator.frameStyle = "none";
    state.generator.frameText = "";
    const blob = await exportRenderedBlob("svg");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain("svg");
    expect(await blob.text()).toBe(decorated);
    setRenderInfo(null);
  });

  it("exports the rendered (already frame-combined) SVG as-is", async () => {
    // At render time generator.js builds the full framed SVG via
    // getCombinedSvgString, so the svg branch passes it through unchanged
    // instead of rebuilding from requested dimensions (which mis-sized masks).
    const combined =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 28" width="514.2857142857142" height="600">' +
      "<g></g></svg>";
    setRenderInfo({ svg: combined, w: 300, h: 300, moduleCount: 21, userMarginPx: 4 });
    state.generator.frameStyle = "scan";
    state.generator.frameText = "hi";
    const blob = await exportRenderedBlob("svg");
    expect(await blob.text()).toBe(combined);
    state.generator.frameStyle = "none";
    setRenderInfo(null);
  });
});

describe("combined post-processing (one parse for every pass)", () => {
  const BG_IMAGE = "data:image/png;base64,AAAA";

  const libraryLike = () =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
    "<defs>" +
    '<clipPath id="clip-path-dot-color-0">' +
    '<rect x="10" y="10" width="10" height="10" transform="rotate(0,15,15)"/>' +
    '<rect x="20" y="10" width="10" height="10" transform="rotate(0,25,15)"/>' +
    "</clipPath>" +
    '<clipPath id="clip-path-corners-square-color-0-0-0">' +
    '<path clip-rule="evenodd" d="M 6 6h 28v 28h -28z"/>' +
    "</clipPath>" +
    '<clipPath id="clip-path-corners-dot-color-0-0-0">' +
    '<rect x="14" y="14" width="12" height="12" transform="rotate(0,20,20)"/>' +
    "</clipPath>" +
    "</defs>" +
    '<rect x="0" y="0" width="100" height="100" fill="#000000"/>' +
    "<g>" +
    '<rect x="0" y="0" width="100" height="100" clip-path="url(#clip-path-dot-color-0)" fill="#ffffff"/>' +
    '<rect x="6" y="6" width="28" height="28" clip-path="url(#clip-path-corners-square-color-0-0-0)" fill="#ffffff"/>' +
    '<rect x="14" y="14" width="12" height="12" clip-path="url(#clip-path-corners-dot-color-0-0-0)" fill="#ffffff"/>' +
    "</g></svg>";

  const initial = { ...state.generator };
  afterEach(() => {
    Object.assign(state.generator, initial);
  });

  it("matches the sequential passes for mask + corners + gradient + background", async () => {
    state.generator.maskType = "circle";
    state.generator.maskCustom = "";
    state.generator.shapeBody = "square";
    state.generator.shapeOuter = "rounded";
    state.generator.shapeInner = "classy";
    state.generator.dotsColor = "#ffffff";
    state.generator.cornersSquareColor = "#ffffff";
    state.generator.cornersDotColor = "#ffffff";
    state.generator.bgColor = "#000000";
    state.generator.dotsGradient = { type: "linear", rotation: 45, color2: "#00C2FF" };
    state.generator.cornersSquareGradient = null;
    state.generator.cornersDotGradient = null;
    state.generator.bgImageDataUrl = BG_IMAGE;

    // Both paths start from the same (already merged) markup so the only
    // variable is the number of parse/serialize round-trips.
    const source = optimizeSvgRects(libraryLike());
    const sequential = applyBackgroundImage(
      applyGlobalDotGradient(applyCornerStyles(applySurroundShape(source, 4, 100, 100, 21, null)), 100, 100),
      100,
      100
    );
    const combined = (
      await renderSvg({ svgText: source, layout: { userMarginPx: 4, w: 100, h: 100 }, moduleCount: 21, qrMatrix: null })
    ).svg;
    expect(combined).toBe(sequential);
  });

  it("returns the plain merged SVG without a DOM round-trip", async () => {
    state.generator.maskType = "none";
    state.generator.shapeOuter = "square";
    state.generator.shapeInner = "square";
    state.generator.dotsGradient = null;
    state.generator.cornersSquareGradient = null;
    state.generator.cornersDotGradient = null;
    state.generator.bgImageDataUrl = null;
    const source = libraryLike();
    const out = (
      await renderSvg({ svgText: source, layout: { userMarginPx: 0, w: 100, h: 100 }, moduleCount: 21, qrMatrix: null })
    ).svg;
    expect(out).toBe(optimizeSvgRects(source));
  });
});

describe("real library render through the combined pipeline", () => {
  let Ctor = null;
  const initial = { ...state.generator };

  beforeAll(() => {
    const src = fs.readFileSync(path.resolve("src/lib/qr-code-styling.min.js"), "utf8");
    new Function(src)();
    Ctor = globalThis.QRCodeStyling;
  });

  afterEach(() => {
    Object.assign(state.generator, initial);
  });

  for (const body of ["square", "rounded", "classy", "dots"]) {
    it(`merges the ${body} module clip without breaking the mask or clip references`, async () => {
      state.generator.maskType = "circle";
      state.generator.shapeBody = body;
      state.generator.shapeOuter = "square";
      state.generator.shapeInner = "square";
      state.generator.dotsGradient = null;
      state.generator.bgImageDataUrl = null;
      const qr = new Ctor(buildQrStylingOptions(300, 300, { data: "https://example.com/pipeline-probe" }));
      const raw = await (await qr.getRawData("svg")).text();

      const optimized = optimizeSvgRects(raw);
      expect(optimized.length).toBeLessThanOrEqual(raw.length);
      if (body === "square" || body === "rounded") {
        expect(optimized.length).toBeLessThan(raw.length);
      }

      const out = (
        await renderSvg({
          svgText: optimized,
          layout: { userMarginPx: 4, w: 300, h: 300 },
          moduleCount: 21,
          qrMatrix: null,
        })
      ).svg;
      const doc = new DOMParser().parseFromString(out, "image/svg+xml");
      expect(doc.querySelector("parsererror")).toBeNull();
      // Mask silhouette and surround layer are present.
      expect(doc.querySelector(".qr-mask-bg")).not.toBeNull();
      // The merge never keeps more dot-clip rects than the library emitted.
      const dotClip = doc.querySelector('clipPath[id^="clip-path-dot-color"]');
      const rawDotClip = raw.match(/<clipPath\b[^>]*id="clip-path-dot-color[^"]*"[^>]*>([\s\S]*?)<\/clipPath>/);
      expect(dotClip.querySelectorAll("rect").length).toBeLessThanOrEqual(
        (rawDotClip[1].match(/<rect/g) || []).length
      );
      // Every painted rect still points at a clipPath that exists.
      for (const rect of doc.querySelectorAll("rect[clip-path]")) {
        const id = ((rect.getAttribute("clip-path") || "").match(/#([^)'"]+)/) || [])[1];
        expect(doc.getElementById(id), `clip ${id}`).not.toBeNull();
      }
    });
  }
});

describe("suggested file name", () => {
  const original = { ...state.generator };

  afterEach(() => {
    Object.assign(state.generator, original);
  });

  function placeholderFor(dataString) {
    state.generator.dataString = dataString;
    DOM.exportFilename = document.createElement("input");
    updateExportFilenamePlaceholder();
    const value = DOM.exportFilename.placeholder;
    delete DOM.exportFilename;
    return value;
  }

  it("names a URL after its host instead of a timestamp", () => {
    // It used to be `qr-url-2026-09-26-1505`: meaningless, and it changed every
    // minute so the placeholder kept shifting under the user.
    expect(placeholderFor("https://www.example.com/docs/page")).toBe("example.com");
    expect(placeholderFor("https://example.com")).not.toMatch(/^qr-/);
  });

  it("names Wi-Fi, contact and other payloads after what identifies them", () => {
    expect(placeholderFor("WIFI:S:Home network;T:WPA;P:secret;;")).toBe("Home network");
    expect(placeholderFor("BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nEND:VCARD")).toBe(
      "Ada Lovelace"
    );
    expect(placeholderFor("mailto:ada@example.com?subject=Hi")).toBe("ada@example.com");
    expect(placeholderFor("tel:+15551234567")).toBe("+15551234567");
  });

  it("falls back to a clipped payload, then to a neutral name", () => {
    expect(placeholderFor("hello there, this is a fairly long text payload")).toBe(
      "hello there, this is a fairly lo"
    );
    expect(placeholderFor("")).toBe("qr-code");
  });
});

describe("sanitizeFilename", () => {
  it("strips path separators, control characters and reserved characters", () => {
    expect(sanitizeFilename("../evil/na:me?x")).toBe("evil-na-me-x");
    expect(sanitizeFilename("bad\u0000name\u001f")).toBe("badname");
    expect(sanitizeFilename("a*b|c<d>e\"f")).toBe("a-b-c-d-e-f");
  });

  it("drops leading/trailing dots and spaces (hidden or invalid names)", () => {
    expect(sanitizeFilename("  report... ")).toBe("report");
    expect(sanitizeFilename("...hidden")).toBe("hidden");
  });

  it("dodges Windows reserved device names", () => {
    expect(sanitizeFilename("CON")).toBe("CON-qr");
    expect(sanitizeFilename("lpt1")).toBe("lpt1-qr");
    expect(sanitizeFilename("console")).toBe("console");
  });

  it("caps the length and falls back when nothing survives", () => {
    const long = sanitizeFilename("x".repeat(500));
    expect(long.length).toBe(100);
    expect(sanitizeFilename("")).toBe("qr-code");
    expect(sanitizeFilename("...", "fallback")).toBe("fallback");
    expect(sanitizeFilename(null, "fallback")).toBe("fallback");
  });
});

describe("exportRenderedBlob raster output", () => {
  const initial = { ...state.generator };
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalImage = globalThis.Image;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let createElementSpy = null;

  function installCanvasMock({ context = true } = {}) {
    const canvases = [];
    const originalCreate = document.createElement.bind(document);
    createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      if (tag !== "canvas") return originalCreate(tag);
      const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => (context ? ctx : null),
        toBlob: (cb, type) => cb(new Blob(["encoded"], { type })),
      };
      canvases.push({ canvas, ctx });
      return canvas;
    });
    return canvases;
  }

  function stubImage({ intrinsic = true, fail = false } = {}) {
    globalThis.Image = class {
      constructor() {
        this.naturalWidth = intrinsic ? 64 : 0;
        this.naturalHeight = intrinsic ? 64 : 0;
      }
      set src(value) {
        this._src = value;
        queueMicrotask(() => {
          if (fail) this.onerror && this.onerror();
          else this.onload && this.onload();
        });
      }
    };
  }

  function stubBitmap(bitmap) {
    globalThis.createImageBitmap = vi.fn(async () => bitmap);
  }

  afterEach(() => {
    Object.assign(state.generator, initial);
    if (createElementSpy) {
      createElementSpy.mockRestore();
      createElementSpy = null;
    }
    if (originalCreateImageBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originalCreateImageBitmap;
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("sizes the canvas from the rendered SVG, not from stale state", async () => {
    const canvases = installCanvasMock();
    stubImage();
    setRenderInfo({ svg: '<svg width="123" height="45"></svg>', w: 300, h: 300, moduleCount: 21, userMarginPx: 4 });
    const blob = await exportRenderedBlob("png");
    expect(blob).toBeInstanceOf(Blob);
    expect(canvases[0].canvas.width).toBe(123);
    expect(canvases[0].canvas.height).toBe(45);
    setRenderInfo(null);
  });

  it("falls back to the frame math for an SVG without width/height", async () => {
    const canvases = installCanvasMock();
    stubImage();
    state.generator.frameStyle = "scan";
    state.generator.frameText = "hello";
    state.generator.bgTransparent = false;
    setRenderInfo({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 27.5"><g/></svg>',
      w: 300,
      h: 300,
      moduleCount: 21,
      userMarginPx: 4,
    });
    await exportRenderedBlob("png");
    // 300 * (24 / 16) = 450 wide; 450 * (27.5 / 24) = 515.625 -> 516 tall.
    expect(canvases[0].canvas.width).toBe(450);
    expect(canvases[0].canvas.height).toBe(516);
    setRenderInfo(null);
  });

  it("keeps transparency for PNG and fills the canvas for opaque output", async () => {
    const transparent = installCanvasMock();
    stubImage();
    state.generator.bgTransparent = true;
    state.generator.bgColor = "#123456";
    state.generator.frameStyle = "none";
    setRenderInfo({ svg: '<svg width="100" height="100"></svg>', w: 100, h: 100, moduleCount: 21, userMarginPx: 4 });
    await exportRenderedBlob("png");
    expect(transparent[0].ctx.fillRect).not.toHaveBeenCalled();

    const opaque = installCanvasMock();
    state.generator.bgTransparent = false;
    await exportRenderedBlob("png");
    expect(opaque[0].ctx.fillStyle).toBe("#123456");
    expect(opaque[0].ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 100);
    setRenderInfo(null);
  });

  it("prefers the background override for the fill decision (history exports)", async () => {
    const canvases = installCanvasMock();
    stubImage();
    state.generator.frameStyle = "none";
    setRenderInfo({ svg: '<svg width="100" height="100"></svg>', w: 100, h: 100, moduleCount: 21, userMarginPx: 4 });

    // Live design is opaque; the saved/overridden design is transparent.
    state.generator.bgTransparent = false;
    state.generator.bgColor = "#ff0000";
    await exportRenderedBlob("png", null, { bgTransparent: true, bgColor: "#00ff00" });
    expect(canvases[0].ctx.fillRect).not.toHaveBeenCalled();

    // Live design is transparent; the saved/overridden design is opaque.
    state.generator.bgTransparent = true;
    state.generator.bgColor = "#00ff00";
    await exportRenderedBlob("png", null, { bgTransparent: false, bgColor: "#abcdef" });
    expect(canvases[1].ctx.fillStyle).toBe("#abcdef");
    expect(canvases[1].ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 100);
    setRenderInfo(null);
  });

  it("always fills JPEG (which has no alpha) even when the preview is transparent", async () => {
    const canvases = installCanvasMock();
    stubImage();
    state.generator.bgTransparent = true;
    state.generator.bgColor = "#abcdef";
    state.generator.frameStyle = "none";
    setRenderInfo({ svg: '<svg width="50" height="50"></svg>', w: 50, h: 50, moduleCount: 21, userMarginPx: 4 });
    await exportRenderedBlob("jpeg");
    expect(canvases[0].ctx.fillStyle).toBe("#abcdef");
    expect(canvases[0].ctx.fillRect).toHaveBeenCalledWith(0, 0, 50, 50);
    setRenderInfo(null);
  });

  it("decodes SVG through Image() first (Chromium rejects SVG in createImageBitmap)", async () => {
    const canvases = installCanvasMock();
    stubImage();
    globalThis.createImageBitmap = vi.fn(() => {
      throw new Error("createImageBitmap must not be used on the happy path");
    });
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    setRenderInfo({ svg: '<svg width="80" height="80"></svg>', w: 80, h: 80, moduleCount: 21, userMarginPx: 4 });
    const blob = await exportRenderedBlob("png");
    expect(blob).toBeInstanceOf(Blob);
    expect(canvases[0].ctx.drawImage).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    setRenderInfo(null);
  });

  it("falls back to createImageBitmap when the image load fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const canvases = installCanvasMock();
    stubImage({ fail: true });
    const close = vi.fn();
    stubBitmap({ width: 10, height: 10, close });
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    setRenderInfo({ svg: '<svg width="80" height="80"></svg>', w: 80, h: 80, moduleCount: 21, userMarginPx: 4 });
    const blob = await exportRenderedBlob("png");
    expect(blob).toBeInstanceOf(Blob);
    expect(globalThis.createImageBitmap).toHaveBeenCalled();
    expect(canvases[0].ctx.drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    warnSpy.mockRestore();
    setRenderInfo(null);
  });

  it("rejects when both decoders fail or the bitmap is empty", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    installCanvasMock();
    stubImage({ fail: true });
    stubBitmap({ width: 0, height: 0, close: vi.fn() });
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    setRenderInfo({ svg: '<svg width="80" height="80"></svg>', w: 80, h: 80, moduleCount: 21, userMarginPx: 4 });
    await expect(exportRenderedBlob("png")).rejects.toThrow(/Export failed/);

    stubImage({ intrinsic: false });
    delete globalThis.createImageBitmap;
    await expect(exportRenderedBlob("png")).rejects.toThrow(/Export failed/);
    warnSpy.mockRestore();
    setRenderInfo(null);
  });

  it("refuses oversized canvases and missing 2D contexts instead of silently failing", async () => {
    installCanvasMock();
    setRenderInfo({ svg: '<svg width="9000" height="9000"></svg>', w: 9000, h: 9000, moduleCount: 21, userMarginPx: 4 });
    await expect(exportRenderedBlob("png")).rejects.toThrow(/exceeds/);

    createElementSpy.mockRestore();
    installCanvasMock({ context: false });
    setRenderInfo({ svg: '<svg width="100" height="100"></svg>', w: 100, h: 100, moduleCount: 21, userMarginPx: 4 });
    await expect(exportRenderedBlob("png")).rejects.toThrow(/Canvas 2D/);
    setRenderInfo(null);
  });

  it("exports TXT as Unicode block art even without a rendered SVG", async () => {
    const size = 21;
    const mat = Array.from({ length: size }, () => Array(size).fill(true));
    globalThis.qrcode = () => ({
      addData() {},
      make() {},
      getModuleCount: () => size,
      isDark: (r, c) => mat[r][c],
    });
    setRenderInfo(null);
    const blob = await exportRenderedBlob("txt");
    expect(blob.type).toContain("text/plain");
    expect(await blob.text()).toContain("█");

    globalThis.qrcode = () => ({
      addData() {},
      make() {
        throw new Error("code length overflow");
      },
      getModuleCount: () => size,
      isDark: () => false,
    });
    await expect(exportRenderedBlob("txt")).resolves.toBeNull();
  });

  it("encodes the TXT data override instead of the live payload", async () => {
    const calls = [];
    const added = [];
    globalThis.qrcode = (...args) => {
      calls.push(args);
      return {
        addData(data) {
          added.push(data);
        },
        make() {},
        getModuleCount: () => 21,
        isDark: () => true,
      };
    };
    state.generator.dataString = "live payload";
    state.generator.ecc = "L";
    const blob = await exportRenderedBlob("txt", null, { dataString: "row value", ecc: "H" });
    expect(blob).toBeInstanceOf(Blob);
    expect(added).toEqual(["row value"]);
    expect(calls[0][1]).toBe("H");
    setRenderInfo(null);
  });

  it("treats unknown format values as PNG instead of fabricating an extension", async () => {
    const canvases = installCanvasMock();
    stubImage();
    state.generator.frameStyle = "none";
    setRenderInfo({ svg: '<svg width="40" height="40"></svg>', w: 40, h: 40, moduleCount: 21, userMarginPx: 4 });
    const blob = await exportRenderedBlob("exe");
    expect(blob.type).toBe("image/png");
    expect(canvases.length).toBe(1);
    setRenderInfo(null);
  });
});

describe("frame font embedding for exports", () => {
  const initial = { ...state.generator };
  const inner = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300"/></svg>';
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    Object.assign(state.generator, initial);
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  });

  it("embeds a hosted frame font as base64 @font-face in the combined SVG", async () => {
    const bytes = fs.readFileSync("src/fonts/figtree-var-latin.woff2");
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }));
    state.generator.frameStyle = "scan";
    state.generator.frameText = "Export";
    state.generator.frameFont = "figtree";

    const svg = await getCombinedSvgString(300, 300, 4, 21, null, inner);
    expect(svg).toContain("@font-face");
    expect(svg).toContain("url(data:font/woff2;base64,");
    const encoded = svg.match(/base64,([A-Za-z0-9+/=]+)\)/)[1];
    expect(Buffer.from(encoded, "base64").equals(bytes)).toBe(true);
  });

  it("falls back to a system stack when the font file cannot be fetched", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    state.generator.frameStyle = "scan";
    state.generator.frameText = "Offline";
    state.generator.frameFont = "montserrat";

    const svg = await getCombinedSvgString(300, 300, 4, 21, null, inner);
    expect(svg).not.toContain("@font-face");
    expect(svg).toContain("<text");
    expect(svg).toContain("Offline");
  });
});
