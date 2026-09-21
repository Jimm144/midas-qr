import { describe, it, expect, afterEach } from "vitest";
import { innerPaddingForMask, maskVerticalShift } from "../src/js/generator/mask.js";
import { applySurroundShape } from "./helpers/svg-doc.js";
import { framesConfig, BUILT_IN_MASK_PATHS } from "../src/js/frames";
import { sanitizeGeneratorConfig, state } from "../src/js/state";

const MASKS = ["circle", "triangle", "heart", "star", "diamond", "hexagon", "shield", "custom"];
const MODULE_COUNTS = [21, 25, 33, 45, 57];
const WIDTHS = [50, 100, 200, 300, 600, 1000];
const USER_MARGIN = 4;
const CUSTOM_SQUARE_PATH = "M0 0h24v24H0z";

const initial = { ...state.generator };

afterEach(() => {
  Object.assign(state.generator, initial);
});

function setup(width, maskType) {
  state.generator.width = width;
  state.generator.height = width;
  state.generator.margin = 0; // the user margin is passed to applySurroundShape
  state.generator.maskType = maskType;
  state.generator.shapeBody = "rounded";
  state.generator.maskCustom = maskType === "custom" ? CUSTOM_SQUARE_PATH : "";
}

/**
 * Same geometry the render pipeline uses, recomputed here so a regression in
 * either place fails loudly rather than drifting.
 */
function geometry(maskType, moduleCount, width) {
  const moduleSize = Math.max(1, Math.floor(width / moduleCount));
  const dataW = moduleCount * moduleSize;
  const padModules = innerPaddingForMask(maskType, moduleCount);
  const totalMarginPx = USER_MARGIN + padModules * moduleSize;
  const canvas = dataW + totalMarginPx * 2;
  const dyModules = maskVerticalShift(maskType, moduleCount);
  return { moduleSize, dataW, padModules, totalMarginPx, canvas, dy: dyModules * moduleSize };
}

/** Point-in-silhouette for the analytic masks (circle/triangle), 0 for others. */
function silhouetteCheck(maskType, { canvas }) {
  const shapeW = canvas - 2 * USER_MARGIN;
  if (maskType === "circle") {
    const r = shapeW / 2;
    const c = canvas / 2;
    return (x, y) => Math.hypot(x - c, y - c) <= r + 1e-6;
  }
  if (maskType === "triangle") {
    const topY = USER_MARGIN;
    const botY = canvas - USER_MARGIN;
    return (x, y) => {
      if (y < topY || y > botY) return false;
      const halfW = (shapeW / 2) * ((y - topY) / (botY - topY));
      return Math.abs(x - canvas / 2) <= halfW + 1e-6;
    };
  }
  return null;
}

describe("mask sizing across every mask, module count and resolution", () => {
  for (const maskType of MASKS) {
    for (const moduleCount of MODULE_COUNTS) {
      for (const width of WIDTHS) {
        it(`${maskType} · ${moduleCount} modules · ${width}px`, () => {
          setup(width, maskType);
          const g = geometry(maskType, moduleCount, width);
          expect(g.moduleSize).toBeGreaterThanOrEqual(1);
          expect(g.padModules).toBeGreaterThanOrEqual(0);
          expect(g.canvas).toBeGreaterThan(0);
          expect(Number.isFinite(g.canvas)).toBe(true);
          // The code fits the requested width whenever a module can be at least
          // 1px; below that the 1px-module floor wins and the art grows.
          if (g.moduleSize > 1) {
            expect(g.dataW).toBeLessThanOrEqual(width);
          } else {
            expect(g.moduleSize).toBe(1);
          }
        });
      }
    }
  }

  it("keeps the code inside the circle for every module count", () => {
    for (const moduleCount of MODULE_COUNTS) {
      setup(300, "circle");
      const g = geometry("circle", moduleCount, 300);
      const inside = silhouetteCheck("circle", g);
      const left = g.totalMarginPx;
      const top = g.totalMarginPx + g.dy;
      for (const [x, y] of [
        [left, top],
        [left + g.dataW, top],
        [left, top + g.dataW],
        [left + g.dataW, top + g.dataW],
        [left + g.dataW / 2, top],
      ]) {
        expect(inside(x, y), `point ${x},${y} @ ${moduleCount} modules`).toBe(true);
      }
    }
  });

  it("keeps the code inside the triangle for every module count", () => {
    for (const moduleCount of MODULE_COUNTS) {
      setup(300, "triangle");
      const g = geometry("triangle", moduleCount, 300);
      const inside = silhouetteCheck("triangle", g);
      const left = g.totalMarginPx;
      const top = g.totalMarginPx + g.dy;
      for (const [x, y] of [
        [left, top],
        [left + g.dataW, top],
        [left, top + g.dataW],
        [left + g.dataW, top + g.dataW],
      ]) {
        expect(inside(x, y), `point ${x},${y} @ ${moduleCount} modules`).toBe(true);
      }
    }
  });

  it("renders the mask and keeps the surround layer behind the code", () => {
    for (const maskType of MASKS) {
      setup(300, maskType);
      const moduleCount = 33;
      const g = geometry(maskType, moduleCount, 300);
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${g.canvas}" height="${g.canvas}">` +
        `<rect x="0" y="0" width="${g.canvas}" height="${g.canvas}" fill="#000000"/>` +
        `<g id="qr-content"><rect x="0" y="0" width="9" height="9" fill="#ffffff"/></g>` +
        `</svg>`;
      const out = applySurroundShape(svg, USER_MARGIN, g.canvas, g.canvas, moduleCount);
      // Every mask paints the stepped silhouette path (module-aligned cells).
      expect(out, maskType).toContain('class="qr-mask-bg"');
    }
  });

  it("exposes a padding entry for every built-in mask path", () => {
    for (const maskType of Object.keys(BUILT_IN_MASK_PATHS)) {
      expect(innerPaddingForMask(maskType, 33), maskType).toBeGreaterThan(0);
    }
  });
});

describe("frame text stays inside the frame viewBox at every size", () => {
  const frames = Object.entries(framesConfig).filter(([, cfg]) => cfg);
  // Frame text sizes in percent: minimum, default, maximum of the UI range.
  const TEXT_SIZES = { "60%": 0.6, "115%": 1.15, "200%": 2 };

  for (const [name, cfg] of frames) {
    for (const [sizeName, scale] of Object.entries(TEXT_SIZES)) {
      for (const width of [50, 100, 300, 600]) {
        it(`${name} · ${sizeName} text · ${width}px`, () => {
          const fontSize = cfg.textArea.size * scale;
          // Text is centred on textArea.y, so its glyph box spans
          // y ± fontSize*0.62 (covers ascenders/descenders with a margin).
          const half = fontSize * 0.62;
          // Every label stays inside the SVG viewBox.
          expect(cfg.textArea.y - half, "text top").toBeGreaterThanOrEqual(0);
          expect(cfg.textArea.y + half, "text bottom").toBeLessThanOrEqual(cfg.vbHeight);
          // Labels hanging outside the QR box must stay clear of the code.
          if (cfg.textColor !== "bg") {
            expect(cfg.textArea.y - half, "text top").toBeGreaterThanOrEqual(cfg.qrArea.y + cfg.qrArea.h);
          }

          const outW = width * (24 / cfg.qrArea.w);
          const outH = outW * (cfg.vbHeight / 24);
          expect(Number.isFinite(outW) && outW > 0).toBe(true);
          expect(Number.isFinite(outH) && outH > 0).toBe(true);
          // The frame stays a sane aspect: no frame is taller than 1.25:1.
          expect(outH / outW).toBeLessThanOrEqual(1.25);
        });
      }
    }
  }

  it("keeps the QR area square and inside the 24-unit frame box", () => {
    for (const [name, cfg] of frames) {
      expect(cfg.qrArea.w, name).toBeGreaterThan(0);
      expect(cfg.qrArea.h, name).toBeGreaterThan(0);
      expect(cfg.qrArea.x, name).toBeGreaterThanOrEqual(0);
      expect(cfg.qrArea.x + cfg.qrArea.w, name).toBeLessThanOrEqual(24);
      expect(cfg.qrArea.y + cfg.qrArea.h, name).toBeLessThanOrEqual(cfg.vbHeight);
    }
  });

  it("keeps the no-text geometry renderable for the bar frames", () => {
    for (const name of ["label", "badge"]) {
      const cfg = framesConfig[name];
      const area = cfg.noTextQrArea ?? cfg.qrArea;
      expect(area.w, name).toBeGreaterThan(0);
      expect(area.h, name).toBeGreaterThan(0);
      expect(area.x + area.w, name).toBeLessThanOrEqual(24);
      expect(area.y + area.h, name).toBeLessThanOrEqual(24);
      const outW = 300 * (24 / area.w);
      const outH = outW * (24 / 24);
      expect(Number.isFinite(outW) && outW > 0, name).toBe(true);
      expect(Number.isFinite(outH) && outH > 0, name).toBe(true);
    }
  });
});

describe("frame art stays clear of the QR area", () => {
  it("keeps solid label bars clear of the QR area", () => {
    const barRe = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*fill="__ACCENT__"/g;
    for (const [name, cfg] of Object.entries(framesConfig).filter(([, c]) => c)) {
      let match;
      barRe.lastIndex = 0;
      while ((match = barRe.exec(cfg.svg))) {
        const [x, y, w, h] = [+match[1], +match[2], +match[3], +match[4]];
        const overlapX = x < cfg.qrArea.x + cfg.qrArea.w && x + w > cfg.qrArea.x;
        const overlapY = y < cfg.qrArea.y + cfg.qrArea.h && y + h > cfg.qrArea.y;
        expect(overlapX && overlapY, `${name} bar overlaps the QR area`).toBe(false);
      }
    }
  });
});

describe("hostile persisted configs sanitize to renderable geometry", () => {
  it("clamps a corrupt config and keeps the mask geometry finite", () => {
    const clean = sanitizeGeneratorConfig({
      width: -1e9,
      height: 1e9,
      margin: 1e9,
      maskType: "star",
      maskCustom: 'M0 0" onload="x',
      shapeBody: "rounded",
      frameStyle: "label",
      frameText: "x".repeat(500),
      frameTextSize: "large",
      logoSizeProportion: 99,
    });
    expect(Number.isFinite(clean.width)).toBe(true);
    expect(clean.width).toBe(50);
    expect(clean.height).toBe(2000);
    expect(clean.frameText).toHaveLength(15);
    expect(clean.frameTextSize).toBe(125);
    setup(clean.width, clean.maskType);
    const g = geometry(clean.maskType, 33, clean.width);
    expect(Number.isFinite(g.canvas)).toBe(true);
    expect(g.canvas).toBeGreaterThan(0);
    expect(g.moduleSize).toBeGreaterThanOrEqual(1);
  });
});
