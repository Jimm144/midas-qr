import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { applyGlobalDotGradient } from "../src/js/generator/mask.js";
import { frameTextFill } from "../src/js/generator/frame.js";
import { buildQrStylingOptions } from "../src/js/generator/qr-instance.js";
import { state } from "../src/js/state";

let Ctor = null;
let initial;

beforeAll(() => {
  const src = fs.readFileSync(path.resolve("src/lib/qr-code-styling.min.js"), "utf8");
  new Function(src)();
  Ctor = globalThis.QRCodeStyling;
  initial = { ...state.generator };
});

afterEach(() => {
  Object.assign(state.generator, initial);
});

async function renderSvg() {
  const qr = new Ctor(buildQrStylingOptions(300, 300, {}));
  const blob = await qr.getRawData("svg");
  return blob.text();
}

const fillFor = (svg, clip) => {
  const re = new RegExp(`<rect[^>]*clip-path="url\\('#${clip}[^']*'\\)"[^>]*fill="([^"]+)"`);
  const m = svg.match(re);
  if (m) return m[1];
  // fill sometimes precedes clip-path
  const re2 = new RegExp(`<rect[^>]*fill="([^"]+)"[^>]*clip-path="url\\('#${clip}[^']*'\\)"`);
  const m2 = svg.match(re2);
  return m2 ? m2[1] : null;
};

describe("corner square / dot colors reach the render", () => {
  it("paints the finder rings and inner dots with their configured colors", async () => {
    state.generator.cornersSquareColor = "#FF0000";
    state.generator.cornersDotColor = "#00FF00";
    state.generator.dotsColor = "#0000FF";
    const svg = await renderSvg();
    expect(fillFor(svg, "clip-path-corners-square-color-0")).toBe("#FF0000");
    expect(fillFor(svg, "clip-path-corners-dot-color-0")).toBe("#00FF00");
    expect(fillFor(svg, "clip-path-dot-color")).toBe("#0000FF");
  });

  it("keeps corner colors when a dots gradient is set (per-group gradients)", async () => {
    state.generator.cornersSquareColor = "#FF0000";
    state.generator.cornersDotColor = "#00FF00";
    state.generator.dotsColor = "#0000FF";
    state.generator.dotsGradient = { type: "linear", rotation: 45, color2: "#00C2FF" };
    const svg = await renderSvg();
    const out = applyGlobalDotGradient(svg, 300, 300);
    // dots follow the shared gradient...
    expect(fillFor(out, "clip-path-dot-color")).toBe("url(#qr-global-grad)");
    // ...while the corners keep their own solid colors.
    expect(fillFor(out, "clip-path-corners-square-color-0")).toBe("#FF0000");
    expect(fillFor(out, "clip-path-corners-dot-color-0")).toBe("#00FF00");
  });

  it("gives a corner its own gradient when one is configured", async () => {
    state.generator.dotsGradient = null;
    state.generator.dotsColor = "#0000FF";
    state.generator.cornersSquareGradient = { type: "radial", rotation: 0, color2: "#123456" };
    state.generator.cornersSquareColor = "#FF0000";
    const svg = await renderSvg();
    const out = applyGlobalDotGradient(svg, 300, 300);
    expect(out).toContain('id="qr-corners-square-grad"');
    expect(fillFor(out, "clip-path-corners-square-color-0")).toBe("url(#qr-corners-square-grad)");
    // untouched groups keep their solid color
    expect(fillFor(out, "clip-path-dot-color")).toBe("#0000FF");
  });
});

describe("frameTextFill", () => {
  const barFrame = { textColor: "bg" };
  const plainFrame = {};

  it("prefers an explicit frame text color", () => {
    state.generator.frameTextColor = "#AABBCC";
    state.generator.frameColor = "#111111";
    state.generator.dotsColor = "#222222";
    expect(frameTextFill(plainFrame)).toBe("#AABBCC");
    expect(frameTextFill(barFrame)).toBe("#AABBCC");
  });

  it("falls back to the background for bar frames and the frame/dots color otherwise", () => {
    state.generator.frameTextColor = "";
    state.generator.frameColor = "";
    state.generator.dotsColor = "#222222";
    state.generator.bgColor = "#333333";
    expect(frameTextFill(plainFrame)).toBe("#222222");
    expect(frameTextFill(barFrame)).toBe("#333333");
    state.generator.frameColor = "#444444";
    expect(frameTextFill(plainFrame)).toBe("#444444");
  });
});
