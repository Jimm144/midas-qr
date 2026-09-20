import { describe, it, expect } from "vitest";
import {
  MIN_QR_CONTRAST,
  MIN_RENDER_MODULE_PX,
  contrastRatio,
  isTooSmallToScan,
  modulePixelSize,
  parseHexColor,
  readabilityHint,
  relativeLuminance,
} from "../src/js/generator/readability.js";

describe("parseHexColor", () => {
  it("parses six-digit hex with or without the leading hash", () => {
    expect(parseHexColor("#FF0000")).toEqual([255, 0, 0]);
    expect(parseHexColor("00ff00")).toEqual([0, 255, 0]);
    expect(parseHexColor("  #0000FF  ")).toEqual([0, 0, 255]);
  });

  it("rejects non-strings, short hex and non-hex input", () => {
    expect(parseHexColor(null)).toBeNull();
    expect(parseHexColor(undefined)).toBeNull();
    expect(parseHexColor("#fff")).toBeNull();
    expect(parseHexColor("#GGGGGG")).toBeNull();
    expect(parseHexColor({})).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("returns 21 for black on white and 1 for identical colors", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#000000", "#777777")).toBeCloseTo(contrastRatio("#777777", "#000000"), 5);
  });

  it("returns null when either color is invalid", () => {
    expect(contrastRatio("#000000", "red")).toBeNull();
    expect(contrastRatio(null, "#FFFFFF")).toBeNull();
  });

  it("exposes the minimum graphic contrast threshold", () => {
    expect(MIN_QR_CONTRAST).toBeGreaterThan(1);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
  });
});

describe("render size checks", () => {
  it("computes the module edge from the requested width", () => {
    expect(modulePixelSize(300, 25)).toBe(12);
    expect(modulePixelSize(52, 25)).toBe(2);
    expect(modulePixelSize(0, 25)).toBe(0);
    expect(modulePixelSize(300, 0)).toBe(0);
    expect(modulePixelSize("nope", 25)).toBe(0);
  });

  it("flags renders whose modules are too small to scan", () => {
    expect(isTooSmallToScan(300, 25)).toBe(false);
    expect(isTooSmallToScan(100, 25)).toBe(false); // exactly the 4px floor
    expect(isTooSmallToScan(52, 25)).toBe(true);
    // Unknown sizes are not flagged.
    expect(isTooSmallToScan(0, 25)).toBe(false);
    expect(isTooSmallToScan(300, 0)).toBe(false);
  });

  it("documents the module floor", () => {
    expect(MIN_RENDER_MODULE_PX).toBeGreaterThanOrEqual(4);
  });
});

describe("readabilityHint", () => {
  const base = {
    bgColor: "#FFFFFF",
    bgTransparent: false,
    bgImageDataUrl: null,
    dotsColor: "#000000",
    cornersSquareColor: "#000000",
    cornersDotColor: "#000000",
    logoDataUrl: null,
    logoSizeProportion: 0.4,
    maskType: "none",
  };

  it("returns no hint for a high-contrast plain config", () => {
    expect(readabilityHint(base)).toBe("");
    expect(readabilityHint(null)).toBe("");
  });

  it("blames a background image first", () => {
    const hint = readabilityHint({ ...base, bgImageDataUrl: "data:image/png;base64,AAAA" });
    expect(hint).toMatch(/background image/i);
  });

  it("flags an oversized logo", () => {
    const hint = readabilityHint({
      ...base,
      logoDataUrl: "data:image/png;base64,AAAA",
      logoSizeProportion: 0.4,
    });
    expect(hint).toMatch(/logo/i);
  });

  it("does not flag a small logo", () => {
    expect(
      readabilityHint({ ...base, logoDataUrl: "data:image/png;base64,AAAA", logoSizeProportion: 0.2 })
    ).toBe("");
  });

  it("names the specific low-contrast target", () => {
    expect(readabilityHint({ ...base, dotsColor: "#FEFEFE" })).toMatch(/body/i);
    expect(readabilityHint({ ...base, dotsColor: "#000000", cornersSquareColor: "#FAFAFA" })).toMatch(
      /corner squares/i
    );
    expect(
      readabilityHint({
        ...base,
        dotsColor: "#000000",
        cornersSquareColor: "#000000",
        cornersDotColor: "#FEFEFE",
      })
    ).toMatch(/corner dots/i);
  });

  it("mentions transparency when the background is transparent", () => {
    expect(readabilityHint({ ...base, bgTransparent: true })).toMatch(/transparent/i);
  });

  it("falls back to the quiet-zone tip for masks", () => {
    expect(readabilityHint({ ...base, maskType: "circle" })).toMatch(/mask/i);
  });

      it("blames the dot body style before the generic mask note", () => {
        expect(readabilityHint({ ...base, shapeBody: "dots" })).toMatch(/dot body/i);
        expect(readabilityHint({ ...base, shapeBody: "dot" })).toMatch(/dot body/i);
        expect(readabilityHint({ ...base, shapeBody: "dots", maskType: "circle" })).toMatch(/dot body/i);
        expect(readabilityHint({ ...base, shapeBody: "square" })).toBe("");
      });

      it("flags a target that exactly matches the background", () => {
    const hint = readabilityHint({ ...base, dotsColor: "#FFFFFF" });
    expect(hint).toMatch(/body/i);
    expect(hint).toMatch(/low contrast/i);
  });
});
