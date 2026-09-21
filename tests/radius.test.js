import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { applyRadiusToDoc, maxSafeRadius, renderSvg } from "../src/js/generator/svg-pipeline.js";
import { buildQrStylingOptions } from "../src/js/generator/qr-instance.js";
import { state } from "../src/js/state";
import { insideRoundedRect } from "./helpers/svg-path.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTHS = [50, 100, 200, 300, 600];
const MODULE_COUNTS = [21, 25, 33, 45, 57];
const MARGINS = [0, 1, 4, 10, 30];
const RADII = [1, 8, 13, 20, 100, 1000];

let Ctor = null;
let baseSvg = "";
let initial;

beforeAll(async () => {
  const src = fs.readFileSync(path.resolve("src/lib/qr-code-styling.min.js"), "utf8");
  new Function(src)();
  Ctor = globalThis.QRCodeStyling;
  // Mirror generateQR's geometry: moduleCount 25 -> moduleSize 12 -> dataW 300
  // + 2 * 4px margin = a 308px canvas.
  const qr = new Ctor(
    buildQrStylingOptions(308, 308, { data: "https://example.com/radius-probe", margin: 4 })
  );
  baseSvg = await (await qr.getRawData("svg")).text();
  initial = { ...state.generator };
});

afterEach(() => {
  Object.assign(state.generator, initial);
});

function parse(svg) {
  return new DOMParser().parseFromString(svg, "image/svg+xml");
}

function directChildren(root, tag) {
  return [...root.children].filter((el) => el.tagName === tag);
}

function clipRectOf(root) {
  const clip = root.querySelector("#qr-canvas-radius-clip");
  return clip ? clip.querySelector("rect") : null;
}

function syntheticDoc(w, margin) {
  return parse(
    `<svg xmlns="${SVG_NS}" width="${w}" height="${w}">` +
      '<defs><clipPath id="library-clip"><rect x="0" y="0" width="10" height="10"/></clipPath></defs>' +
      `<rect x="0" y="0" width="${w}" height="${w}" fill="#ffffff"/>` +
      `<rect x="${margin}" y="${margin}" width="${w - 2 * margin}" height="${w - 2 * margin}" fill="#000000" clip-path="url(#library-clip)"/>` +
      "</svg>"
  );
}

describe("maxSafeRadius", () => {
  it("is derived from the quiet zone and never reaches half the canvas", () => {
    expect(maxSafeRadius(300, 300, 0)).toBe(0);
    expect(maxSafeRadius(300, 300, 4)).toBeCloseTo(4 / (1 - Math.SQRT1_2), 6);
    expect(maxSafeRadius(300, 300, 10)).toBeGreaterThan(maxSafeRadius(300, 300, 4));
    // Half the data area caps a very large quiet zone.
    expect(maxSafeRadius(300, 300, 100)).toBe(50);
    // Degenerate geometry can't produce a usable radius.
    expect(maxSafeRadius(100, 50, 40)).toBe(0);
    expect(maxSafeRadius(0, 300, 4)).toBe(0);
    expect(maxSafeRadius(NaN, 300, 4)).toBe(0);
  });
});

describe("applyRadiusToDoc", () => {
  it("rounds the visible background rect, not the first rect in <defs>", () => {
    const doc = syntheticDoc(300, 4);
    const applied = applyRadiusToDoc(doc, 20, 300, 300, 4);
    expect(applied).toBe(true);

    const [bgRect] = directChildren(doc.documentElement, "rect");
    expect(bgRect.getAttribute("rx")).toBe(String(Math.floor(maxSafeRadius(300, 300, 4))));
    expect(bgRect.getAttribute("ry")).toBe(String(Math.floor(maxSafeRadius(300, 300, 4))));
    // The library's own clip rectangles are untouched.
    expect(doc.querySelector("#library-clip rect").getAttribute("rx")).toBeNull();
    const radiusClip = doc.querySelector("#qr-canvas-radius-clip");
    for (const rect of radiusClip.querySelectorAll("rect")) {
      expect(rect.getAttribute("rx")).not.toBeNull();
    }
  });

  it("clips the content group with the same clamped radius", () => {
    const doc = syntheticDoc(300, 4);
    applyRadiusToDoc(doc, 1000, 300, 300, 4);
    const expected = Math.floor(maxSafeRadius(300, 300, 4));

    const group = directChildren(doc.documentElement, "g").find((g) =>
      (g.getAttribute("clip-path") || "").includes("qr-canvas-radius-clip")
    );
    expect(group).toBeTruthy();
    const clipRect = clipRectOf(doc.documentElement);
    expect(clipRect.getAttribute("rx")).toBe(String(expected));
    expect(Number(clipRect.getAttribute("width"))).toBe(300);
  });

  it("ignores a non-canvas first rect and rounds the real background", () => {
    const doc = parse(
      `<svg xmlns="${SVG_NS}" width="300" height="300">` +
        '<defs><clipPath id="c"><rect x="0" y="0" width="10" height="10"/></clipPath></defs>' +
        '<rect x="10" y="10" width="50" height="50" fill="#ff0000"/>' +
        '<rect x="0" y="0" width="300" height="300" fill="#ffffff"/>' +
        "</svg>"
    );
    applyRadiusToDoc(doc, 20, 300, 300, 4);
    const directRects = directChildren(doc.documentElement, "rect");
    expect(directRects).toHaveLength(1);
    expect(directRects[0].getAttribute("width")).toBe("300");
    expect(directRects[0].getAttribute("rx")).toBe(String(Math.floor(maxSafeRadius(300, 300, 4))));
    // The stray overlay was moved into the clipped content group.
    expect(doc.querySelector('g[clip-path*="qr-canvas-radius-clip"] rect[width="50"]')).toBeTruthy();
  });

  it("still clips content when no canvas-sized background rect exists", () => {
    const doc = parse(
      `<svg xmlns="${SVG_NS}" width="300" height="300">` +
        '<rect x="10" y="10" width="50" height="50" fill="#ff0000"/>' +
        "</svg>"
    );
    expect(applyRadiusToDoc(doc, 20, 300, 300, 4)).toBe(true);
    expect(clipRectOf(doc.documentElement)).toBeTruthy();
    expect(doc.querySelector('g[clip-path*="qr-canvas-radius-clip"] rect[width="50"]')).toBeTruthy();
  });

  it("ignores zero, negative, NaN and non-numeric radii", () => {
    for (const radius of [0, -5, NaN, "nonsense", null, undefined]) {
      const doc = syntheticDoc(300, 4);
      expect(applyRadiusToDoc(doc, radius, 300, 300, 4), String(radius)).toBe(false);
    }
  });

  it("applies nothing when the quiet zone leaves no safe radius", () => {
    const doc = syntheticDoc(300, 0);
    expect(applyRadiusToDoc(doc, 8, 300, 300, 0)).toBe(false);
    expect(doc.documentElement.querySelector("#qr-canvas-radius-clip")).toBeNull();
    expect(directChildren(doc.documentElement, "rect")[0].getAttribute("rx")).toBeNull();
  });

  for (const width of WIDTHS) {
    for (const moduleCount of MODULE_COUNTS) {
      for (const margin of MARGINS) {
        for (const radius of RADII) {
          it(`keeps every data corner inside the clip · ${width}px · ${moduleCount} modules · margin ${margin} · radius ${radius}`, () => {
            const moduleSize = Math.max(1, Math.floor(width / moduleCount));
            const dataW = moduleCount * moduleSize;
            const totalMarginPx = margin;
            const w = dataW + 2 * totalMarginPx;
            const doc = syntheticDoc(w, totalMarginPx);
            applyRadiusToDoc(doc, radius, w, w, totalMarginPx);

            const expected = Math.floor(Math.min(radius, maxSafeRadius(w, w, totalMarginPx)));
            if (expected <= 0) {
              expect(doc.documentElement.querySelector("#qr-canvas-radius-clip")).toBeNull();
              return;
            }
            const clipRect = clipRectOf(doc.documentElement);
            if (!clipRect) return; // nothing to clip when the doc has no content
            const effective = Number(clipRect.getAttribute("rx"));
            expect(effective).toBeLessThanOrEqual(w / 2);
            expect(effective).toBe(expected);

            for (const [x, y] of [
              [totalMarginPx, totalMarginPx],
              [w - totalMarginPx, totalMarginPx],
              [totalMarginPx, w - totalMarginPx],
              [w - totalMarginPx, w - totalMarginPx],
            ]) {
              expect(insideRoundedRect(x, y, w, w, effective), `corner ${x},${y}`).toBe(true);
            }
          });
        }
      }
    }
  }
});

describe("radius pass on a real library render", () => {
  async function processRadius(radius, marginPx = 4, urlWidth = 300) {
    state.generator.maskType = "none";
    state.generator.bgTransparent = false;
    state.generator.qrRadius = radius;
    state.generator.bgGradient = null;
    state.generator.dotsGradient = null;
    state.generator.cornersSquareGradient = null;
    state.generator.cornersDotGradient = null;
    state.generator.bgImageDataUrl = null;
    state.generator.logoDataUrl = null;
    state.generator.shapeOuter = "square";
    state.generator.shapeInner = "square";
    const moduleCount = 25;
    const moduleSize = Math.floor(urlWidth / moduleCount);
    const dataW = moduleCount * moduleSize;
    const w = dataW + 2 * marginPx;
    const out = (
      await renderSvg({ svgText: baseSvg, layout: { userMarginPx: marginPx, w, h: w }, moduleCount })
    ).svg;
    return { doc: parse(out), w, marginPx, dataW };
  }

  it("clamps a persisted 1000px radius and never turns the code into a circle", async () => {
    const { doc, w, marginPx, dataW } = await processRadius(1000);
    const expected = Math.floor(maxSafeRadius(w, w, marginPx));
    const bgRect = directChildren(doc.documentElement, "rect")[0];
    expect(bgRect.getAttribute("rx")).toBe(String(expected));
    // The library's background clip rectangle must stay square: only the
    // radius clip carries a rounding.
    const libraryBgClip = doc.querySelector('clipPath[id^="clip-path-background-color"] rect');
    expect(libraryBgClip.getAttribute("rx")).toBeNull();
    const clipRect = clipRectOf(doc.documentElement);
    const effective = Number(clipRect.getAttribute("rx"));
    expect(effective).toBe(expected);
    for (const [x, y] of [
      [marginPx, marginPx],
      [marginPx + dataW, marginPx],
      [marginPx, marginPx + dataW],
      [marginPx + dataW, marginPx + dataW],
    ]) {
      expect(insideRoundedRect(x, y, w, w, effective), `corner ${x},${y}`).toBe(true);
    }
  });

  it("rounds a gradient background through its visible rect", async () => {
    state.generator.bgGradient = { type: "linear", rotation: 45, color2: "#00C2FF" };
    state.generator.maskType = "none";
    state.generator.qrRadius = 8;
    const gradientQr = new Ctor(
      buildQrStylingOptions(308, 308, {
        data: "https://example.com/radius-gradient",
        background: "#ffffff",
        margin: 4,
      })
    );
    const gradientSvg = await (await gradientQr.getRawData("svg")).text();
    const out = (
      await renderSvg({ svgText: gradientSvg, layout: { userMarginPx: 4, w: 308, h: 308 }, moduleCount: 25 })
    ).svg;
    const doc = parse(out);
    const bgRect = directChildren(doc.documentElement, "rect")[0];
    expect(bgRect.getAttribute("fill")).toContain("url(");
    expect(bgRect.getAttribute("rx")).toBe(String(Math.floor(Math.min(8, maxSafeRadius(308, 308, 4)))));
  });

  it("keeps the plain render untouched when the radius is zero", async () => {
    state.generator.maskType = "none";
    state.generator.qrRadius = 0;
    state.generator.bgImageDataUrl = null;
    state.generator.logoDataUrl = null;
    state.generator.bgGradient = null;
    state.generator.dotsGradient = null;
    state.generator.cornersSquareGradient = null;
    state.generator.cornersDotGradient = null;
    state.generator.shapeOuter = "square";
    state.generator.shapeInner = "square";
    const out = (
      await renderSvg({ svgText: baseSvg, layout: { userMarginPx: 4, w: 308, h: 308 }, moduleCount: 25 })
    ).svg;
    expect(out).not.toContain("qr-canvas-radius-clip");
  });
});
