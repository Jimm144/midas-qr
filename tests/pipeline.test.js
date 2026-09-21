import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { maxSafeRadius, renderSvg } from "../src/js/generator/svg-pipeline.js";
import { buildQrStylingOptions } from "../src/js/generator/qr-instance.js";
import { resolveLayout } from "../src/js/generator/layout.js";
import { framesConfig } from "../src/js/frames";
import { state } from "../src/js/state";

const DATA = "https://example.com/pipeline-matrix";
const BG_IMAGE = "data:image/png;base64,AAAA";
const LOGO = "data:image/png;base64,BBBB";
const MASKS = ["none", "circle", "custom"];
const FRAMES = ["none", "label"];
const MARGINS = [0, 4];

let Ctor = null;
let initial;

beforeAll(() => {
  const src = fs.readFileSync(path.resolve("src/lib/qr-code-styling.min.js"), "utf8");
  window.eval(src);
  Ctor = globalThis.QRCodeStyling;
  initial = { ...state.generator };
});

afterEach(() => {
  Object.assign(state.generator, initial);
});

function reset({ maskType = "none", frameStyle = "none", margin = 4, radius = 0, width = 300 } = {}) {
  state.generator.maskType = maskType;
  state.generator.maskCustom = maskType === "custom" ? "M12 2l10 10-10 10L2 12z" : "";
  state.generator.frameStyle = frameStyle;
  state.generator.frameText = "Scan me!";
  state.generator.frameTextSize = 115;
  state.generator.frameTextEnabled = true;
  state.generator.frameFont = "theme";
  state.generator.frameColor = "";
  state.generator.frameTextColor = "";
  state.generator.frameGradient = null;
  state.generator.frameTextGradient = null;
  state.generator.margin = margin;
  state.generator.width = width;
  state.generator.height = width;
  state.generator.qrRadius = radius;
  state.generator.ecc = "H";
  state.generator.bgTransparent = false;
  state.generator.bgColor = "#ffffff";
  state.generator.dotsColor = "#000000";
  state.generator.cornersSquareColor = "#000000";
  state.generator.cornersDotColor = "#000000";
  state.generator.shapeBody = "square";
  state.generator.shapeOuter = "square";
  state.generator.shapeInner = "square";
  state.generator.dotsGradient = null;
  state.generator.cornersSquareGradient = null;
  state.generator.cornersDotGradient = null;
  state.generator.bgGradient = null;
  state.generator.bgImageDataUrl = null;
  state.generator.logoDataUrl = null;
}

/** Mirror generateQR's geometry exactly by asking the same resolver. */
function geometry(width, margin, maskType, moduleCount) {
  return resolveLayout({ width, margin, maskType }, moduleCount);
}

async function renderPipeline() {
  const width = state.generator.width;
  const layout = globalThis.qrcode(0, state.generator.ecc);
  layout.addData(DATA);
  layout.make();
  const moduleCount = layout.getModuleCount();
  const g = geometry(width, state.generator.margin, state.generator.maskType, moduleCount);
  const totalMarginPx = (g.w - g.dataW) / 2;
  // Mirror generateQR: the library is handed the padded canvas and its margin.
  const qr = new Ctor(buildQrStylingOptions(g.w, g.w, { data: DATA, margin: totalMarginPx }));
  const raw = await (await qr.getRawData("svg")).text();
  const processed = await renderSvg({ svgText: raw, layout: g, moduleCount, qrMatrix: layout });
  return { svg: processed.svg, ...g, moduleCount };
}

function expectResolvedUrlRefs(doc) {
  const refs = new Set();
  for (const match of doc.documentElement.outerHTML.matchAll(/url\(#([^)'"]+)\)/g)) refs.add(match[1]);
  for (const id of refs) {
    expect(doc.getElementById(id), `unresolved paint reference #${id}`).not.toBeNull();
  }
}

describe("full render pipeline matrix (real library)", () => {
  beforeAll(() => {
    const src = fs.readFileSync(path.resolve("src/lib/qrcode.min.js"), "utf8");
    window.eval(src);
  });

  for (const maskType of MASKS) {
    for (const frameStyle of FRAMES) {
      for (const margin of MARGINS) {
        it(`${maskType} mask · ${frameStyle} frame · margin ${margin}`, async () => {
          reset({ maskType, frameStyle, margin });
          const { svg } = await renderPipeline();
          const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
          expect(doc.querySelector("parsererror")).toBeNull();
          expect(doc.documentElement.tagName).toBe("svg");

          if (frameStyle !== "none") {
            const nested = doc.documentElement.querySelector("svg");
            expect(nested, "framed output nests the QR svg").toBeTruthy();
            expect(doc.documentElement.getAttribute("viewBox")).toBe(
              `0 0 24 ${framesConfig[frameStyle].vbHeight}`
            );
            expect(doc.querySelector("text").textContent).toBe("Scan me!");
          }
          if (maskType === "circle" || maskType === "custom") {
            expect(doc.querySelector(".qr-mask-bg")).toBeTruthy();
          }
          if (maskType === "custom") {
            expect(doc.querySelector("#qr-mask-canvas-clip")).toBeTruthy();
          }
          expectResolvedUrlRefs(doc);
        });
      }
    }
  }
});

describe("pipeline feature combinations", () => {
  beforeAll(() => {
    if (typeof globalThis.qrcode === "undefined") {
      const src = fs.readFileSync(path.resolve("src/lib/qrcode.min.js"), "utf8");
      window.eval(src);
    }
  });

  it("merges the module clip for framed renders too", async () => {
    reset({ maskType: "none", frameStyle: "label", margin: 4, width: 300 });
    const { svg } = await renderPipeline();
    const clip = svg.match(/<clipPath[^>]*id="clip-path-dot-color[^"]*"[^>]*>([\s\S]*?)<\/clipPath>/);
    expect(clip, "dot clip present in framed output").not.toBeNull();
    // optimizeSvgRects collapses the per-module rects into one path so the
    // framed render keeps the same AA-seam fix and file size as the plain one.
    expect(clip[1]).toContain("<path");
    expect(clip[1]).not.toContain("<rect");
  });

  it("keeps a radius render, background image and logo stacked correctly", async () => {
    reset({ radius: 8, frameStyle: "label" });
    state.generator.bgImageDataUrl = BG_IMAGE;
    state.generator.logoDataUrl = LOGO;
    const { svg, w, userMarginPx } = await renderPipeline();
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("#qr-canvas-radius-clip")).toBeTruthy();
    expect(doc.querySelector("#qr-bg-image-mask-clip")).toBeNull();
    expect(doc.querySelector("image[href]")).toBeTruthy();
    const qrSvg = [...doc.querySelectorAll("svg")].find((s) => s.getAttribute("width") === "100%");
    const bg = [...qrSvg.children].find((el) => el.tagName === "rect");
    expect(bg.getAttribute("rx")).toBe(String(Math.floor(Math.min(8, maxSafeRadius(w, w, userMarginPx)))));
    const logo = doc.querySelector(".qr-logo-overlay");
    expect(logo).toBeTruthy();
    expect(logo.querySelector("image")).toBeTruthy();
    expectResolvedUrlRefs(doc);
  });

  it("shows the background image inside a mask silhouette", async () => {
    reset({ maskType: "circle" });
    state.generator.bgImageDataUrl = BG_IMAGE;
    const { svg } = await renderPipeline();
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const image = doc.querySelector("image[clip-path]");
    expect(image).toBeTruthy();
    expect(image.getAttribute("clip-path")).toContain("qr-bg-image-mask-clip");
        expect(doc.querySelector("#qr-bg-image-mask-clip path")).toBeTruthy();
    expectResolvedUrlRefs(doc);
  });

  it("applies every per-target gradient through the combined passes", async () => {
    reset({ maskType: "star", frameStyle: "badge" });
    state.generator.dotsGradient = { type: "linear", rotation: 45, color2: "#00C2FF" };
    state.generator.cornersSquareGradient = { type: "radial", rotation: 0, color2: "#FF00AA" };
    state.generator.cornersDotGradient = { type: "linear", rotation: 90, color2: "#22CC88" };
    state.generator.frameGradient = { type: "linear", rotation: 30, color2: "#FFCC00" };
    state.generator.frameTextGradient = { type: "radial", rotation: 0, color2: "#0000FF" };
    const { svg } = await renderPipeline();
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("#qr-global-grad")).toBeTruthy();
    expect(doc.querySelector("#qr-corners-square-grad")).toBeTruthy();
    expect(doc.querySelector("#qr-corners-dot-grad")).toBeTruthy();
    expect(doc.querySelector("#qr-frame-grad")).toBeTruthy();
    expect(doc.querySelector("#qr-frame-text-grad")).toBeTruthy();
    expectResolvedUrlRefs(doc);
  });

  it("collapses the badge frame to a square when the text is off", async () => {
    reset({ frameStyle: "badge" });
    state.generator.frameTextEnabled = false;
    const { svg } = await renderPipeline();
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(doc.querySelector("text")).toBeNull();
    // The badge's accent bar disappears with the text band.
    const nested = doc.documentElement.querySelector("svg");
    expect(nested).toBeTruthy();
    expect(nested.getAttribute("y")).toBe("4");
    const bar = [...doc.querySelectorAll("rect")].find((rect) => rect.getAttribute("y") === "1.2");
    expect(bar).toBeUndefined();
  });

  it("does not apply the radius pass when a mask is active", async () => {
    reset({ maskType: "circle", radius: 20 });
    const { svg } = await renderPipeline();
        expect(svg).not.toContain("qr-canvas-radius-clip");
        expect(svg).toContain('class="qr-mask-bg"');
  });

  it("rebuilds extended corner styles inside a masked render", async () => {
    reset({ maskType: "circle" });
    state.generator.shapeOuter = "classy";
    state.generator.shapeInner = "classy-rounded";
    const { svg } = await renderPipeline();
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const ring = doc.querySelector('clipPath[id^="clip-path-corners-square-color"]');
    expect(ring.querySelector("path").getAttribute("d")).toContain("a ");
    const dot = doc.querySelector('clipPath[id^="clip-path-corners-dot-color"]');
    expect(dot.querySelector("path")).toBeTruthy();
    expectResolvedUrlRefs(doc);
  });
});
