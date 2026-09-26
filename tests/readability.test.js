import { describe, it, expect } from "vitest";
import {
  MIN_QR_CONTRAST,
  MIN_RENDER_MODULE_PX,
  MIN_DOT_MODULE_PX,
  MIN_QUIET_ZONE_PX,
  contrastRatio,
  isTooSmallToScan,
  modulePixelSize,
  parseHexColor,
  readabilityHintDescriptor,
  readabilityHintKey,
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

  it("documents the module and quiet-zone floors", () => {
    expect(MIN_RENDER_MODULE_PX).toBeGreaterThanOrEqual(4);
    expect(MIN_DOT_MODULE_PX).toBeGreaterThan(MIN_RENDER_MODULE_PX);
    expect(MIN_QUIET_ZONE_PX).toBeGreaterThan(0);
  });
});

// The advisor reports a translation key, never a sentence: the wording lives in
// the catalogs. These assertions therefore name keys, which also pins the
// precedence between overlapping causes.
describe("readabilityHintKey", () => {
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
    expect(readabilityHintKey(base)).toBe("");
    expect(readabilityHintKey(null)).toBe("");
  });

  it("blames a background image first", () => {
    expect(readabilityHintKey({ ...base, bgImageDataUrl: "data:image/png;base64,AAAA" })).toBe(
      "readability.backgroundImage"
    );
  });

  it("flags an oversized logo", () => {
    expect(
      readabilityHintKey({
        ...base,
        logoDataUrl: "data:image/png;base64,AAAA",
        logoSizeProportion: 0.4,
        imageMargin: 8,
      })
    ).toBe("readability.largeLogo");
  });

  it("does not flag a small logo on its backing plate", () => {
    expect(
      readabilityHintKey({
        ...base,
        logoDataUrl: "data:image/png;base64,AAAA",
        logoSizeProportion: 0.2,
        imageMargin: 8,
      })
    ).toBe("");
  });

  it("flags a logo that sits on the code without a backing plate", () => {
    expect(
      readabilityHintKey({
        ...base,
        logoDataUrl: "data:image/png;base64,AAAA",
        logoSizeProportion: 0.2,
        imageMargin: 0,
      })
    ).toBe("readability.logoNoPlate");
    // A margin large enough to paint a plate clears the warning again.
    expect(
      readabilityHintKey({
        ...base,
        logoDataUrl: "data:image/png;base64,AAAA",
        logoSizeProportion: 0.2,
        imageMargin: 4,
      })
    ).toBe("");
  });

  it("reports an oversized logo as large before it reports the missing plate", () => {
    // Both conditions hold; "covers a large part" is the more useful advice.
    expect(
      readabilityHintKey({
        ...base,
        logoDataUrl: "data:image/png;base64,AAAA",
        logoSizeProportion: 0.45,
        imageMargin: 0,
      })
    ).toBe("readability.largeLogo");
  });

  it("flags a plate that would swallow the code", () => {
    // 0.1 * 300 + 2 * 100 = 230px on a 300px code.
    expect(
      readabilityHintKey(
        {
          ...base,
          logoDataUrl: "data:image/png;base64,AAAA",
          logoSizeProportion: 0.1,
          imageMargin: 100,
        },
        { canvasSize: 300 }
      )
    ).toBe("readability.logoPlateTooBig");
    // Without a canvas size the check stays quiet rather than guessing.
    expect(
      readabilityHintKey({
        ...base,
        logoDataUrl: "data:image/png;base64,AAAA",
        logoSizeProportion: 0.1,
        imageMargin: 100,
      })
    ).toBe("");
    // A reasonable margin on a big canvas is fine.
    expect(
      readabilityHintKey(
        {
          ...base,
          logoDataUrl: "data:image/png;base64,AAAA",
          logoSizeProportion: 0.3,
          imageMargin: 8,
        },
        { canvasSize: 1000 }
      )
    ).toBe("");
  });

  it("names the specific low-contrast target", () => {
    expect(readabilityHintKey({ ...base, dotsColor: "#FEFEFE" })).toBe("readability.lowContrastBody");
    expect(
      readabilityHintKey({ ...base, dotsColor: "#000000", cornersSquareColor: "#FAFAFA" })
    ).toBe("readability.lowContrastCornersSquare");
    expect(
      readabilityHintKey({
        ...base,
        dotsColor: "#000000",
        cornersSquareColor: "#000000",
        cornersDotColor: "#FEFEFE",
      })
    ).toBe("readability.lowContrastCornersDot");
  });

  it("mentions transparency when the background is transparent", () => {
    expect(readabilityHintKey({ ...base, bgTransparent: true })).toBe("readability.transparent");
  });

  it("does not warn about a square body with no mask", () => {
    expect(readabilityHintKey({ ...base, shapeBody: "square" }, { modulePx: 9 })).toBe("");
  });

  it("stays quiet on a dot body until the modules get small", () => {
    // Dots are a deliberate style choice: at 9px modules they scan fine, so
    // choosing one must not turn the badge yellow.
    expect(readabilityHintKey({ ...base, shapeBody: "dots" }, { modulePx: 9 })).toBe("");
    expect(readabilityHintKey({ ...base, shapeBody: "dot" }, { modulePx: 9 })).toBe("");
    // A small render is where the gaps start to cost real scans.
    expect(readabilityHintKey({ ...base, shapeBody: "dots" }, { modulePx: 4 })).toBe(
      "readability.dotBody"
    );
    expect(readabilityHintKey({ ...base, shapeBody: "dot" }, { modulePx: 4 })).toBe(
      "readability.dotBody"
    );
    // Dots win over a mask: they are the stronger factor.
    expect(
      readabilityHintKey({ ...base, shapeBody: "dots", maskType: "circle" }, { modulePx: 4 })
    ).toBe("readability.dotBody");
  });

  it("stays quiet on a mask that keeps a full quiet zone", () => {
    expect(readabilityHintKey({ ...base, maskType: "circle", margin: 4 })).toBe("");
    expect(readabilityHintKey({ ...base, maskType: "circle", margin: 12 })).toBe("");
    expect(readabilityHintKey({ ...base, maskType: "circle", margin: 0 })).toBe("readability.mask");
  });

  it("flags a target that exactly matches the background", () => {
    expect(readabilityHintKey({ ...base, dotsColor: "#FFFFFF" })).toBe("readability.lowContrastBody");
  });

  it("passes the offending colours as params for interpolation", () => {
    const descriptor = readabilityHintDescriptor({ ...base, dotsColor: "#FEFEFE" });
    expect(descriptor.params).toEqual({ color: "#FEFEFE", background: "#FFFFFF" });
  });
});
