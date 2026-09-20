import { describe, it, expect } from "vitest";
import { resolveLayout, resolveFrameGeometry, frameOutputSize } from "../src/js/generator/layout.js";

describe("resolveLayout", () => {
  it("returns canvas math consistent across widths and masks", () => {
    for (const width of [50, 100, 300, 512, 2000]) {
      for (const mask of ["none", "circle", "star", "custom"]) {
        const l = resolveLayout({ width, margin: 4, maskType: mask }, 33);
        expect(l.moduleSize).toBe(Math.max(1, Math.floor(width / 33)));
        expect(l.dataW).toBe(33 * l.moduleSize);
        expect(l.w).toBe(l.dataW + 2 * l.totalMarginPx);
        expect(l.w).toBeGreaterThan(0);
        expect(Number.isFinite(l.w)).toBe(true);
      }
    }
  });

  it("keeps the module size at least one for tiny widths", () => {
    const l = resolveLayout({ width: 10, margin: 0, maskType: "none" }, 45);
    expect(l.moduleSize).toBe(1);
  });

  it("shifts the code only for masks whose silhouette is asymmetric", () => {
    const triangle = resolveLayout({ width: 300, margin: 4, maskType: "triangle" }, 21);
    const circle = resolveLayout({ width: 300, margin: 4, maskType: "circle" }, 21);
    expect(triangle.maskDy).toBeGreaterThan(0);
    expect(circle.maskDy).toBe(0);
  });
});

describe("frame geometry resolution", () => {
  it("resolves the no-text artwork when text is disabled or empty", () => {
    const withText = resolveFrameGeometry("scan", "HELLO", true);
    const noText = resolveFrameGeometry("scan", "HELLO", false);
    const empty = resolveFrameGeometry("scan", "  ", true);
    expect(withText.showText).toBe(true);
    expect(noText.showText).toBe(false);
    expect(empty.showText).toBe(false);
    expect(noText.vbHeight).toBe(24);
  });

  it("returns null for an unknown style", () => {
    expect(resolveFrameGeometry("nope", "x", true)).toBeNull();
  });

  it("scales output size from the QR area", () => {
    const geo = resolveFrameGeometry("scan", "HELLO", true);
    const out = frameOutputSize(300, geo);
    expect(out.w).toBeCloseTo(300 * (24 / geo.qrArea.w), 6);
    expect(out.h).toBeCloseTo(out.w * (geo.vbHeight / 24), 6);
  });
});
