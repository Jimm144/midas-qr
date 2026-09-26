import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  decodeCanvasSize,
  svgDecodes,
  MAX_DECODE_EDGE,
} from "../src/js/generator/scannability.js";
import { drawSvgBitmap, svgIntrinsicSize } from "../src/js/generator/svg-raster.js";
import { loadVendoredScript } from "../src/js/lib-loader.js";

vi.mock("../src/js/generator/svg-raster.js", () => ({
  drawSvgBitmap: vi.fn(),
  svgIntrinsicSize: vi.fn(() => null),
}));
vi.mock("../src/js/lib-loader.js", () => ({ loadVendoredScript: vi.fn() }));

describe("decodeCanvasSize", () => {
  it("keeps a size at or under the cap", () => {
    expect(decodeCanvasSize(300, 300)).toEqual({ w: 300, h: 300 });
    expect(decodeCanvasSize(MAX_DECODE_EDGE, MAX_DECODE_EDGE)).toEqual({ w: 1024, h: 1024 });
  });

  it("scales the long edge down to the cap, preserving the aspect ratio", () => {
    // A framed render is taller than wide.
    expect(decodeCanvasSize(2000, 3000)).toEqual({ w: 683, h: 1024 });
    expect(decodeCanvasSize(4000, 1000)).toEqual({ w: 1024, h: 256 });
  });

  it("never yields a zero or fractional edge", () => {
    expect(decodeCanvasSize(0, 0)).toEqual({ w: 1, h: 1 });
    expect(decodeCanvasSize("nonsense", null)).toEqual({ w: 1, h: 1 });
    const tall = decodeCanvasSize(1, 5000);
    expect(tall).toEqual({ w: 1, h: 1024 });
  });
});

describe("svgDecodes", () => {
  /** @type {import("vitest").MockInstance} */
  let getContextSpy;

  beforeEach(() => {
    drawSvgBitmap.mockReset();
    svgIntrinsicSize.mockReset();
    svgIntrinsicSize.mockReturnValue(null);
    loadVendoredScript.mockReset();
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
  });

  afterEach(() => {
    getContextSpy.mockRestore();
    delete globalThis.jsQR;
  });

  function stubCanvas() {
    getContextSpy.mockReturnValue({
      imageSmoothingEnabled: true,
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    });
  }

  it("decodes the raster and reports the result", async () => {
    stubCanvas();
    loadVendoredScript.mockResolvedValue(true);
    drawSvgBitmap.mockResolvedValue(true);
    const decode = vi.fn(() => ({ data: "payload" }));
    globalThis.jsQR = decode;

    await expect(svgDecodes("<svg/>", 300, 300)).resolves.toBe(true);
    expect(decode).toHaveBeenCalledTimes(1);
    // The code is padded back out to the standard's quiet zone before decoding:
    // the export is cropped to the configured margin, and a decoder handed that
    // crop can't find the finder patterns.
    const ctx = getContextSpy.mock.results[0].value;
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it("reports false when the decoder finds nothing", async () => {
    stubCanvas();
    loadVendoredScript.mockResolvedValue(true);
    drawSvgBitmap.mockResolvedValue(true);
    globalThis.jsQR = vi.fn(() => null);

    await expect(svgDecodes("<svg/>", 300, 300)).resolves.toBe(false);
  });

  it("rasterises at the SVG's own size, not the QR canvas size", async () => {
    // A framed render is taller than wide; rasterising it into the QR canvas
    // box would squash the code and report a false failure.
    stubCanvas();
    loadVendoredScript.mockResolvedValue(true);
    drawSvgBitmap.mockResolvedValue(true);
    globalThis.jsQR = vi.fn(() => ({ data: "x" }));
    svgIntrinsicSize.mockReturnValue({ w: 600, h: 900 });

    await svgDecodes("<svg width='600' height='900'></svg>", 300, 300);

    expect(drawSvgBitmap).toHaveBeenCalledWith(expect.anything(), expect.anything(), 600, 900);
  });

  it("returns null without a 2D canvas, and does not fetch the decoder", async () => {
    getContextSpy.mockReturnValue(null);

    await expect(svgDecodes("<svg/>", 300, 300)).resolves.toBeNull();
    expect(loadVendoredScript).not.toHaveBeenCalled();
  });

  it("returns null when the decoder cannot load or the raster fails", async () => {
    stubCanvas();
    loadVendoredScript.mockResolvedValue(false);
    await expect(svgDecodes("<svg/>", 300, 300)).resolves.toBeNull();

    loadVendoredScript.mockResolvedValue(true);
    globalThis.jsQR = vi.fn(() => ({ data: "x" }));
    drawSvgBitmap.mockResolvedValue(false);
    await expect(svgDecodes("<svg/>", 300, 300)).resolves.toBeNull();
  });

  it("returns null for an empty render", async () => {
    await expect(svgDecodes("", 300, 300)).resolves.toBeNull();
    await expect(svgDecodes(null, 300, 300)).resolves.toBeNull();
  });
});
