// Render benchmark for the QR post-processing pipeline.
//
// Run: node tools/bench-render.mjs [iterations]
//
// Measures the real production pipeline (library render -> mask -> frame ->
// corner styles -> gradients -> background image) at the worst case described
// in the perf task (600px, mask + frame + logo) plus a plain render. It is a
// plain node script (jsdom + esbuild, both devDependencies) and is NOT part of
// `npm test`; run it manually to compare before/after.
//
// The vendored library's image loader never resolves under jsdom, so the
// benchmark installs a tiny Image shim that fires onload synchronously-ish.
// This changes nothing about the produced SVG (the data URL is embedded as-is)
// and keeps the logo in the measured pipeline.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ITERATIONS = Math.max(1, Number(process.argv[2]) || 5);
const WIDTH = 600;
const DATA = "https://example.com/benchmark-probe-longish-url?x=1";
const LOGO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const BG_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const { JSDOM } = await import(pathToFileURL(path.join(ROOT, "node_modules/jsdom/lib/api.js")).href);
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
class FakeImage {
  constructor() {
    this.width = 1;
    this.height = 1;
    this.onload = null;
    this.crossOrigin = null;
  }
  set src(value) {
    this._src = value;
    setTimeout(() => this.onload && this.onload(), 0);
  }
  get src() {
    return this._src;
  }
}
dom.window.Image = FakeImage;
for (const key of ["Image", "window", "document", "DOMParser", "XMLSerializer", "Blob", "URL", "HTMLCanvasElement"]) {
  globalThis[key] = dom.window[key];
}
const qrCodeSrc = fs.readFileSync(path.join(ROOT, "src/lib/qrcode.min.js"), "utf8");
globalThis.qrcode = new Function(`${qrCodeSrc}\nreturn qrcode;`)();
new Function(fs.readFileSync(path.join(ROOT, "src/lib/qr-code-styling.min.js"), "utf8"))();

// Bundle the app modules so the benchmark runs the exact production code.
const entry = `
import { state } from ${JSON.stringify(path.join(ROOT, "src/js/state").replace(/\\/g, "/"))};
import { innerPaddingForMask, maskVerticalShift } from ${JSON.stringify(path.join(ROOT, "src/js/generator/mask.js").replace(/\\/g, "/"))};
import { getQrCode, buildQrStylingOptions } from ${JSON.stringify(path.join(ROOT, "src/js/generator/qr-instance.js").replace(/\\/g, "/"))};
import { renderSvg } from ${JSON.stringify(path.join(ROOT, "src/js/generator/svg-pipeline.js").replace(/\\/g, "/"))};
export { state, innerPaddingForMask, maskVerticalShift, getQrCode, buildQrStylingOptions, renderSvg };
`;
const entryPath = path.join(os.tmpdir(), `qr-bench-entry-${process.pid}.mjs`);
const outPath = path.join(os.tmpdir(), `qr-bench-bundle-${process.pid}.mjs`);
fs.writeFileSync(entryPath, entry);
await build({
  entryPoints: [entryPath],
  outfile: outPath,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2020",
  logLevel: "silent",
});
const app = await import(pathToFileURL(outPath).href);
fs.rmSync(entryPath, { force: true });
fs.rmSync(outPath, { force: true });

const { state } = app;

function configure({ mask, frame, gradient, bgImage, corners }) {
  const g = state.generator;
  g.dataType = "text";
  g.dataString = DATA;
  g.isValid = true;
  g.width = WIDTH;
  g.height = WIDTH;
  g.margin = 4;
  g.bgColor = "#000000";
  g.bgTransparent = false;
  g.dotsColor = "#ffffff";
  g.cornersSquareColor = "#ffffff";
  g.cornersDotColor = "#ffffff";
  g.shapeBody = "square";
  g.shapeOuter = corners ? "rounded" : "square";
  g.shapeInner = corners ? "classy" : "square";
  g.maskType = mask;
  g.maskCustom = "";
  g.ecc = "H";
  g.qrRadius = 0;
  g.logoDataUrl = LOGO;
  g.logoSizeProportion = 0.4;
  g.imageMargin = 0;
  g.hideBackgroundDots = false;
  g.frameStyle = frame;
  g.frameText = "Scan me!";
  g.frameTextSize = "medium";
  g.frameFont = "theme";
  g.frameColor = "";
  g.frameTextColor = "";
  g.frameGradient = null;
  g.dotsGradient = gradient ? { type: "linear", rotation: 45, color2: "#00c2ff" } : null;
  g.cornersSquareGradient = null;
  g.cornersDotGradient = null;
  g.bgGradient = null;
  g.bgImageDataUrl = bgImage ? BG_IMAGE : null;
}

async function renderOnce({ mask, frame }) {
  const requestedW = WIDTH;
  const matrix = globalThis.qrcode(0, "H");
  matrix.addData(DATA);
  matrix.make();
  const moduleCount = matrix.getModuleCount();
  const moduleSize = Math.max(1, Math.floor(requestedW / moduleCount));
  const dataW = moduleCount * moduleSize;
  const userMarginPx = 4;
  const innerPaddingModules = app.innerPaddingForMask(mask, moduleCount);
  const totalMarginPx = userMarginPx + innerPaddingModules * moduleSize;
  const w = dataW + totalMarginPx * 2;
  const h = w;

  const options = app.buildQrStylingOptions(w, h, {
    data: DATA,
    margin: totalMarginPx,
    roundSize: state.generator.shapeBody !== "square",
    background: state.generator.bgColor,
    image: LOGO,
  });
  app.getQrCode().update(options);
  const t = { library: 0, pipeline: 0 };

  let t0 = performance.now();
  const raw = await (await app.getQrCode().getRawData("svg")).text();
  t.library = performance.now() - t0;
  t0 = performance.now();
  const svg = (
    await app.renderSvg({
      svgText: raw,
      layout: {
        userMarginPx,
        w,
        h,
        moduleSize,
        totalMarginPx,
        maskDx: 0,
        maskDy: app.maskVerticalShift(mask, moduleCount) * moduleSize,
      },
      moduleCount,
      qrMatrix: matrix,
    })
  ).svg;
  t.pipeline = performance.now() - t0;
  return { svg, t, moduleCount, w };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const scenarios = [
  { label: "plain (no mask/frame)", mask: "none", frame: "none", gradient: false, bgImage: false, corners: false },
  {
    label: "worst (mask + frame + logo)",
    mask: "circle",
    frame: "scan",
    gradient: false,
    bgImage: false,
    corners: false,
  },
  {
    label: "all features (gradient + bg image + corners)",
    mask: "circle",
    frame: "scan",
    gradient: true,
    bgImage: true,
    corners: true,
  },
];

console.log(`QR render benchmark — ${WIDTH}px, ${ITERATIONS} iterations (median)`);
for (const scenario of scenarios) {
  configure(scenario);
  let result;
  const totals = [];
  const stages = { library: [], pipeline: [] };
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    result = await renderOnce(scenario);
    totals.push(performance.now() - t0);
    for (const key of Object.keys(stages)) stages[key].push(result.t[key]);
  }
  const ms = (v) => `${v.toFixed(1)}ms`;
  console.log(`\n${scenario.label}`);
  console.log(
    `  modules ${result.moduleCount}, raster ${result.w}x${result.w}, svg ${result.svg.length} bytes, rects ${(result.svg.match(/<rect/g) || []).length}`
  );
  console.log(
    `  total ${ms(median(totals))} | library ${ms(median(stages.library))} | pipeline ${ms(median(stages.pipeline))}`
  );
}
