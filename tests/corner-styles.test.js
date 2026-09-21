import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { applyCornerStyles } from "./helpers/svg-doc.js";
import { state } from "../src/js/state";

let baseSvg = "";

afterEach(() => {
  state.generator.shapeOuter = "square";
  state.generator.shapeInner = "square";
});

beforeAll(async () => {
  const src = fs.readFileSync(path.resolve("src/lib/qr-code-styling.min.js"), "utf8");
  new Function(src)();
  const QRCodeStylingCtor = globalThis.QRCodeStyling;
  const qr = new QRCodeStylingCtor({
    type: "svg",
    width: 300,
    height: 300,
    margin: 0,
    data: "https://example.com/corner-probe",
    qrOptions: { errorCorrectionLevel: "H" },
    // Mirrors buildQrStylingOptions(): the app always asks for the sharp
    // square corner and restyles it afterwards.
    cornersSquareOptions: { type: "square", color: "#000000", roundSize: false },
    cornersDotOptions: { type: "square", color: "#000000" },
    dotsOptions: { type: "square", color: "#000000" },
    backgroundOptions: { color: "#ffffff" },
  });
  const blob = await qr.getRawData("svg");
  baseSvg = await blob.text();
});

function cornerSquareClipText(svg) {
  const m = svg.match(/<clipPath id="clip-path-corners-square-color-0-0-0">([\s\S]*?)<\/clipPath>/);
  return m ? m[1] : "";
}

describe("vendored library corner output", () => {
  it("renders a sharp square ring when roundSize is disabled", () => {
    const clip = cornerSquareClipText(baseSvg);
    expect(clip).toContain("<path");
    // Sharp corners => the ring path has no arc segments.
    expect(clip).not.toMatch(/[aA]\s?-?[\d.]/);
  });
});

describe("applyCornerStyles against the vendored library output", () => {
  it("rebuilds the corner ring for the extended outer styles", () => {
    state.generator.shapeOuter = "classy-rounded";
    state.generator.shapeInner = "square";
    const out = applyCornerStyles(baseSvg);
    expect(out).not.toBe(baseSvg);
    const clip = cornerSquareClipText(out);
    expect(clip).toMatch(/a 22\.5 22\.5/); // big radius 2.5 * (63/7)
    expect(clip).toMatch(/a 8\.1 8\.1/); // soft radius 0.9 * (63/7)
  });

  it("keeps the rotation transform of the non-primary corners", () => {
    state.generator.shapeOuter = "classy";
    state.generator.shapeInner = "square";
    const out = applyCornerStyles(baseSvg);
    expect(out).toContain("rotate(90,266.5,32.5)");
    expect(out).toContain("rotate(-90,32.5,266.5)");
  });

  it("leaves the SVG untouched for the plain square styles", () => {
    state.generator.shapeOuter = "square";
    state.generator.shapeInner = "square";
    expect(applyCornerStyles(baseSvg)).toBe(baseSvg);
  });

  it("restyles the inner corner dots as a leaf for classy styles", () => {
    state.generator.shapeOuter = "square";
    state.generator.shapeInner = "classy";
    const out = applyCornerStyles(baseSvg);
    expect(out).not.toBe(baseSvg);
    const clip = out.match(/<clipPath id="clip-path-corners-dot-color-0-0-0">([\s\S]*?)<\/clipPath>/);
    expect(clip && clip[1]).toContain("<path");
  });

  it("rebuilds every extended outer ring with a finite even-odd path", () => {
    // extra-rounded is a native library style (no post-pass), the other three
    // are rebuilt from the square geometry.
    for (const style of ["rounded", "classy", "classy-rounded"]) {
      state.generator.shapeOuter = style;
      state.generator.shapeInner = "square";
      const out = applyCornerStyles(baseSvg);
      expect(out, style).not.toBe(baseSvg);
      const clip = cornerSquareClipText(out);
      expect(clip, style).toContain('clip-rule="evenodd"');
      expect(clip, style).not.toContain("NaN");
      expect(clip, style).not.toContain("Infinity");
    }
  });

  it("rounds the inner corner dots for rounded and extra-rounded", () => {
    for (const [style, factor] of [
      ["rounded", 0.2],
      ["extra-rounded", 0.3],
    ]) {
      state.generator.shapeOuter = "square";
      state.generator.shapeInner = style;
      const out = applyCornerStyles(baseSvg);
      const clip = out.match(/<clipPath id="clip-path-corners-dot-color-0-0-0">([\s\S]*?)<\/clipPath>/)[1];
      const width = Number((clip.match(/width="([\d.]+)"/) || [])[1]);
      const rx = Number((clip.match(/rx="([\d.]+)"/) || [])[1]);
      expect(Number.isFinite(rx), style).toBe(true);
      expect(rx, style).toBeCloseTo(width * factor, 5);
    }
  });
});
