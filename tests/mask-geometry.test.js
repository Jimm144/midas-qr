import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  HEART_PATH_D,
  innerPaddingForMask,
  maskVerticalShift,
  safeMaskPathD,
} from "../src/js/generator/mask.js";
import { applyGlobalDotGradient, applySurroundShape } from "./helpers/svg-doc.js";
import { BUILT_IN_MASK_PATHS } from "../src/js/frames";
import { state } from "../src/js/state";
import { distanceToPolygon, flattenPath, pointInPolygon } from "./helpers/svg-path.js";

const PATH_MASKS = ["star", "diamond", "hexagon", "shield", "heart", "custom"];
const ALL_MASKS = [...PATH_MASKS, "circle", "triangle"];
const MODULE_COUNTS = [21, 33, 57];
const WIDTHS = [50, 300, 1000];
const USER_MARGINS = [0, 4, 30];
const CUSTOM_SQUARE_PATH = "M0 0h24v24H0z";

let initial;
let originalGetContext;

beforeAll(() => {
  initial = { ...state.generator };
  // jsdom has no canvas backend: fake enough of it that the surround-dot
  // generator can run for path masks and be inspected.
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  globalThis.Path2D = class Path2D {
    constructor(d) {
      this.points = flattenPath(d);
    }
  };
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
      isPointInPath: (path, x, y) => pointInPolygon(path.points, x, y),
    };
  };
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  delete globalThis.Path2D;
});

afterEach(() => {
  Object.assign(state.generator, initial);
});

/** Same geometry the render pipeline uses. */
function geometry(maskType, moduleCount, width, userMargin) {
  const moduleSize = Math.max(1, Math.floor(width / moduleCount));
  const dataW = moduleCount * moduleSize;
  const padModules = innerPaddingForMask(maskType, moduleCount);
  const totalMarginPx = userMargin + padModules * moduleSize;
  const canvas = dataW + totalMarginPx * 2;
  const dy = maskVerticalShift(maskType, moduleCount) * moduleSize;
  return { moduleSize, dataW, padModules, totalMarginPx, canvas, dy, userMargin, maskType };
}

function maskPathFor(maskType) {
  if (maskType === "heart") return HEART_PATH_D;
  if (maskType === "custom") return CUSTOM_SQUARE_PATH;
  return BUILT_IN_MASK_PATHS[maskType];
}

/** Silhouette outline in canvas coordinates (path masks only). */
function silhouettePolygon(maskType, g) {
  const scale = (g.canvas - 2 * g.userMargin) / 24;
  return flattenPath(maskPathFor(maskType)).map(([x, y]) => [
    g.userMargin + x * scale,
    g.userMargin + y * scale,
  ]);
}

function syntheticSvg(canvas) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}">` +
    `<rect x="0" y="0" width="${canvas}" height="${canvas}" fill="#ffffff"/>` +
    `<g id="qr-content"><rect x="0" y="0" width="10" height="10" fill="#000000"/></g>` +
    "</svg>"
  );
}

/** Code face rectangle in canvas coordinates. */
function codeBox(g) {
  return {
    left: g.totalMarginPx,
    top: g.totalMarginPx + g.dy,
    size: g.dataW,
  };
}

describe("mask silhouette geometry across mask x resolution x margin", () => {
  for (const maskType of PATH_MASKS) {
    it(`${maskType}: keeps every module corner inside the silhouette`, () => {
      state.generator.shapeBody = "square";
      state.generator.maskCustom = maskType === "custom" ? CUSTOM_SQUARE_PATH : "";
      for (const moduleCount of MODULE_COUNTS) {
        for (const width of WIDTHS) {
          for (const userMargin of USER_MARGINS) {
            const g = geometry(maskType, moduleCount, width, userMargin);
            state.generator.maskType = maskType;
            state.generator.width = width;
            const polygon = silhouettePolygon(maskType, g);
            const label = `${maskType} mc=${moduleCount} w=${width} m=${userMargin}`;
            for (let r = 0; r <= moduleCount; r++) {
              for (let c = 0; c <= moduleCount; c++) {
                const x = g.totalMarginPx + c * g.moduleSize;
                const y = g.totalMarginPx + g.dy + r * g.moduleSize;
                expect(pointInPolygon(polygon, x, y), `${label} corner ${c},${r} @ ${x},${y}`).toBe(true);
              }
            }
          }
        }
      }
    });
  }

  for (const maskType of PATH_MASKS) {
    it(`${maskType}: keeps a visible gap between the code and the silhouette edge`, () => {
      state.generator.shapeBody = "square";
      state.generator.maskCustom = maskType === "custom" ? CUSTOM_SQUARE_PATH : "";
      for (const moduleCount of MODULE_COUNTS) {
        for (const width of WIDTHS) {
          for (const userMargin of USER_MARGINS) {
            const g = geometry(maskType, moduleCount, width, userMargin);
            const polygon = silhouettePolygon(maskType, g);
            const box = codeBox(g);
            const samples = [];
            for (let i = 0; i <= 60; i++) {
              const offset = (box.size * i) / 60;
              samples.push(
                [box.left + offset, box.top],
                [box.left + offset, box.top + box.size],
                [box.left, box.top + offset],
                [box.left + box.size, box.top + offset]
              );
            }
            let min = Infinity;
            for (const [x, y] of samples) min = Math.min(min, distanceToPolygon(polygon, x, y));
            expect(min, `${maskType} mc=${moduleCount} w=${width} m=${userMargin}`).toBeGreaterThan(0.5);
          }
        }
      }
    });
  }

  for (const maskType of PATH_MASKS) {
    it(`${maskType}: stays inside the canvas`, () => {
      state.generator.maskCustom = maskType === "custom" ? CUSTOM_SQUARE_PATH : "";
      for (const [moduleCount, width, userMargin] of [
        [21, 50, 0],
        [25, 100, 4],
        [33, 300, 30],
        [57, 1000, 120],
      ]) {
        const g = geometry(maskType, moduleCount, width, userMargin);
        for (const [x, y] of silhouettePolygon(maskType, g)) {
          expect(x, `${maskType} x`).toBeGreaterThanOrEqual(0);
          expect(y, `${maskType} y`).toBeGreaterThanOrEqual(0);
          expect(x, `${maskType} x`).toBeLessThanOrEqual(g.canvas);
          expect(y, `${maskType} y`).toBeLessThanOrEqual(g.canvas);
        }
      }
    });
  }
});

describe("surround dots never reach the code or leave the canvas", () => {
  const bboxOf = (el) => {
    if (el.tagName === "circle") {
      const cx = +el.getAttribute("cx");
      const cy = +el.getAttribute("cy");
      const r = +el.getAttribute("r");
      return { left: cx - r, top: cy - r, right: cx + r, bottom: cy + r };
    }
    const x = +el.getAttribute("x");
    const y = +el.getAttribute("y");
    return {
      left: x,
      top: y,
      right: x + +el.getAttribute("width"),
      bottom: y + +el.getAttribute("height"),
    };
  };

  const intersects = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  for (const maskType of ALL_MASKS) {
    it(`${maskType}: every surround tile sits outside the code box and inside the canvas`, () => {
      state.generator.dotsColor = "#123456";
      state.generator.bgColor = "#ffffff";
      state.generator.shapeBody = "rounded";
      state.generator.maskCustom = maskType === "custom" ? CUSTOM_SQUARE_PATH : "";
      // The custom square fills the whole canvas (tens of thousands of tiles),
      // so it gets the cheapest configuration.
      const combos =
        maskType === "custom"
          ? [[21, 100, 0]]
          : [
              [21, 300, 0],
              [45, 300, 4],
            ];
      for (const [moduleCount, width, userMargin] of combos) {
        state.generator.maskType = maskType;
        state.generator.width = width;
        const g = geometry(maskType, moduleCount, width, userMargin);
        const out = applySurroundShape(syntheticSvg(g.canvas), userMargin, g.canvas, g.canvas, moduleCount);
        const doc = new DOMParser().parseFromString(out, "image/svg+xml");
        const surround = [...doc.querySelectorAll("g")].find(
          (group) => group.getAttribute("fill") === "#123456"
        );
        const label = `${maskType} mc=${moduleCount} w=${width} m=${userMargin}`;
        if (!surround) {
          // Path masks need a canvas backend; the stub above provides one,
          // so a missing surround group is a real failure.
          throw new Error(`${label}: no surround group`);
        }
        const box = codeBox(g);
        const codeRect = {
          left: box.left,
          top: box.top,
          right: box.left + box.size,
          bottom: box.top + box.size,
        };
        const tiles = [...surround.children];
        if (tiles.length === 0) throw new Error(`${label}: empty surround group`);
        for (const tile of tiles) {
          const bbox = bboxOf(tile);
          expect(intersects(bbox, codeRect), `${label}: tile overlaps code`).toBe(false);
          expect(bbox.left, `${label}: left`).toBeGreaterThanOrEqual(-0.001);
          expect(bbox.top, `${label}: top`).toBeGreaterThanOrEqual(-0.001);
          expect(bbox.right, `${label}: right`).toBeLessThanOrEqual(g.canvas + 0.001);
          expect(bbox.bottom, `${label}: bottom`).toBeLessThanOrEqual(g.canvas + 0.001);
        }
      }
    }, 20000);
  }

  it("draws the surround layer behind the code group", () => {
    state.generator.maskType = "circle";
    state.generator.dotsColor = "#123456";
    state.generator.shapeBody = "square";
    const canvas = 300;
    const out = applySurroundShape(syntheticSvg(canvas), 4, canvas, canvas, 25);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const contentGroup = [...doc.documentElement.children].find((el) => el.tagName === "g");
    const surround = contentGroup.querySelector('g[fill="#123456"]');
    expect(surround).toBeTruthy();
    expect([...contentGroup.children][0]).toBe(surround);
  });
});

describe("surround ring paint", () => {
  const libLike = () =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
    '<defs><clipPath id="clip-path-dot-color-0"><rect x="0" y="0" width="300" height="300"/></clipPath></defs>' +
    '<rect x="0" y="0" width="300" height="300" fill="#ffffff"/>' +
    '<rect x="0" y="0" width="300" height="300" fill="#123456" clip-path="url(#clip-path-dot-color-0)"/>' +
    "</svg>";

  it("uses the shared dots gradient so the ring registers with the code", () => {
    state.generator.maskType = "circle";
    state.generator.dotsColor = "#123456";
    state.generator.dotsGradient = { type: "linear", rotation: 45, color2: "#00C2FF" };
    state.generator.shapeBody = "square";
    state.generator.bgColor = "#ffffff";
    const out = applySurroundShape(syntheticSvg(300), 4, 300, 300, 25);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const surround = [...doc.querySelectorAll("g")].find((group) =>
      (group.getAttribute("fill") || "").includes("qr-global-grad")
    );
    expect(surround).toBeTruthy();
    const grad = doc.querySelector("#qr-global-grad");
    expect(grad).toBeTruthy();
    expect(grad.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
    expect([...grad.querySelectorAll("stop")].map((s) => s.getAttribute("stop-color"))).toEqual([
      "#123456",
      "#00C2FF",
    ]);
  });

  it("falls back to the solid dots colour without a gradient", () => {
    state.generator.maskType = "circle";
    state.generator.dotsColor = "#123456";
    state.generator.dotsGradient = null;
    state.generator.shapeBody = "square";
    state.generator.bgColor = "#ffffff";
    const out = applySurroundShape(syntheticSvg(300), 4, 300, 300, 25);
    expect(out).toContain('fill="#123456"');
    expect(out).not.toContain("qr-global-grad");
  });

  it("defines the gradient once when the full pass repaints the code", () => {
    state.generator.maskType = "circle";
    state.generator.dotsColor = "#123456";
    state.generator.dotsGradient = { type: "radial", rotation: 0, color2: "#00C2FF" };
    state.generator.shapeBody = "square";
    state.generator.bgColor = "#ffffff";
    const masked = applySurroundShape(libLike(), 4, 300, 300, 25);
    const out = applyGlobalDotGradient(masked, 300, 300);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    expect(doc.querySelectorAll("#qr-global-grad")).toHaveLength(1);
    const surround = [...doc.querySelectorAll("g")].find((group) =>
      (group.getAttribute("fill") || "").includes("qr-global-grad")
    );
    expect(surround).toBeTruthy();
    const dotRect = doc.querySelector('rect[clip-path*="clip-path-dot-color"]');
    expect(dotRect.getAttribute("fill")).toBe("url(#qr-global-grad)");
  });
});

describe("safeMaskPathD", () => {
  it("accepts complete path data and rejects partial or malformed input", () => {
    expect(safeMaskPathD("M0 0h24v24H0z")).toBe("M0 0h24v24H0z");
    expect(safeMaskPathD("M 12 2 L 22 12 Z")).toBe("M 12 2 L 22 12 Z");
    expect(safeMaskPathD("m2 2 c1 1 2 2 3 3 z")).toBe("m2 2 c1 1 2 2 3 3 z");
    for (const bad of [
      "",
      "hello",
      "L1 1",
      "M0 0 onload",
      "M0 0 h",
      'M0 0" onload="x',
      "M0 0 z 5",
      "M0 0 L1",
    ]) {
      expect(safeMaskPathD(bad), JSON.stringify(bad)).toBe("");
    }
  });
});

describe("custom mask hardening", () => {
  it("falls back to the square silhouette for a malformed custom path", () => {
    state.generator.maskType = "custom";
    state.generator.maskCustom = 'M0 0" onload="alert(1)';
    state.generator.shapeBody = "square";
        const out = applySurroundShape(syntheticSvg(300), 4, 300, 300, 25);
        expect(out).toContain('d="M0 0h300v300H0z"');
    expect(out).not.toContain("onload");
    expect(out).not.toContain("alert");
  });

  it("clips a custom silhouette to the canvas so it cannot bleed into a frame", () => {
    state.generator.maskType = "custom";
    state.generator.maskCustom = "M0 0h48v48H0z";
    state.generator.shapeBody = "square";
        const out = applySurroundShape(syntheticSvg(300), 4, 300, 300, 25);
        const doc = new DOMParser().parseFromString(out, "image/svg+xml");
        const path = doc.querySelector(".qr-mask-bg");
        expect(path).toBeTruthy();
        expect(path.getAttribute("clip-path")).toBe("url(#qr-mask-canvas-clip)");
    const clip = doc.querySelector("#qr-mask-canvas-clip rect");
    expect(clip.getAttribute("width")).toBe("300");
  });

  it("does not add the canvas clip to built-in silhouettes", () => {
    for (const maskType of ["circle", "star", "heart", "triangle"]) {
      state.generator.maskType = maskType;
      const out = applySurroundShape(syntheticSvg(300), 4, 300, 300, 25);
      expect(out, maskType).not.toContain("qr-mask-canvas-clip");
    }
  });
});
