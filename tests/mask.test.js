import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  applySurroundShape,
  innerPaddingForMask,
  maskVerticalShift,
  optimizeSvgRects,
  surroundTilePlan,
} from "../src/js/generator/mask.js";
import { state } from "../src/js/state";

const USER_MARGIN = 4;
const MODULE_COUNT = 25;
const REQUESTED_W = 300;

function buildSvg(size) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect x="0" y="0" width="${size}" height="${size}" fill="#000000"/>` +
    `<g id="qr-content"><rect x="0" y="0" width="10" height="10" fill="#ffffff"/></g>` +
    `</svg>`
  );
}

function geometry(maskType) {
  const moduleSize = Math.floor(REQUESTED_W / MODULE_COUNT);
  const dataW = MODULE_COUNT * moduleSize;
  const padModules = innerPaddingForMask(maskType, MODULE_COUNT);
  const totalMarginPx = USER_MARGIN + padModules * moduleSize;
  const canvas = dataW + totalMarginPx * 2;
  const dy = maskVerticalShift(maskType, MODULE_COUNT) * moduleSize;
  return { dataW, totalMarginPx, canvas, dy };
}

let initial = { ...state.generator };

beforeEach(() => {
  initial = { ...state.generator };
});

afterEach(() => {
  Object.assign(state.generator, initial);
});

describe("mask fit", () => {
  it("returns no padding or shift for none/unknown masks", () => {
    expect(innerPaddingForMask("none", MODULE_COUNT)).toBe(0);
    expect(innerPaddingForMask("unknownMask", MODULE_COUNT)).toBe(0);
    expect(maskVerticalShift("none", MODULE_COUNT)).toBe(0);
    expect(maskVerticalShift("unknownMask", MODULE_COUNT)).toBe(0);
  });

  it("scales padding with the module count and never goes negative", () => {
    for (const mask of ["circle", "triangle", "heart", "star", "diamond", "hexagon", "shield", "custom"]) {
      expect(innerPaddingForMask(mask, MODULE_COUNT), mask).toBeGreaterThan(0);
      expect(innerPaddingForMask(mask, 41), mask).toBeGreaterThan(innerPaddingForMask(mask, 21));
      expect(innerPaddingForMask(mask, 0), mask).toBe(0);
    }
  });

  it("moves the code down for the triangle and up for the heart/shield", () => {
    expect(maskVerticalShift("triangle", MODULE_COUNT)).toBeGreaterThan(0);
    expect(maskVerticalShift("heart", MODULE_COUNT)).toBeLessThan(0);
    expect(maskVerticalShift("shield", MODULE_COUNT)).toBeLessThan(0);
    expect(maskVerticalShift("circle", MODULE_COUNT)).toBe(0);
  });
});

describe("applySurroundShape", () => {
  it("keeps the whole code inside the circle silhouette", () => {
    state.generator.maskType = "circle";
    state.generator.shapeBody = "square";
    const { dataW, totalMarginPx, canvas } = geometry("circle");
    const out = applySurroundShape(buildSvg(canvas), USER_MARGIN, canvas, canvas, MODULE_COUNT);

    const r = (canvas - 2 * USER_MARGIN) / 2;
    const cx = canvas / 2;
    const cy = canvas / 2;
    for (const [x, y] of [
      [totalMarginPx, totalMarginPx],
      [totalMarginPx + dataW, totalMarginPx],
      [totalMarginPx, totalMarginPx + dataW],
      [totalMarginPx + dataW, totalMarginPx + dataW],
    ]) {
      expect(Math.hypot(x - cx, y - cy), `corner ${x},${y}`).toBeLessThanOrEqual(r);
    }
    expect(out).toContain('class="qr-mask-bg"');
  });

  it("hoists the shared surround outline onto the group", () => {
    state.generator.maskType = "circle";
    state.generator.shapeBody = "square";
    state.generator.dotsColor = "#ffffff";
    state.generator.bgColor = "#000000";
    const { canvas } = geometry("circle");
    const out = applySurroundShape(buildSvg(canvas), USER_MARGIN, canvas, canvas, MODULE_COUNT);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const surround = [...doc.querySelectorAll("g")].find(
      (g) => g.getAttribute("fill") === "#ffffff" && g.getAttribute("stroke") === "#ffffff"
    );
    expect(surround).toBeTruthy();
    expect(surround.getAttribute("stroke-width")).toBe("0.5");
    // No child repeats the inherited outline.
    expect(surround.querySelector("[stroke]")).toBeNull();
  });

  it("moves the triangle code down inside the silhouette", () => {
    state.generator.maskType = "triangle";
    state.generator.shapeBody = "square";
    const { canvas, dy, dataW, totalMarginPx } = geometry("triangle");
    const out = applySurroundShape(buildSvg(canvas), USER_MARGIN, canvas, canvas, MODULE_COUNT);

    expect(out).toContain('class="qr-mask-bg"');
    expect(out).toContain(`translate(0, ${dy})`);

    const shapeW = canvas - 2 * USER_MARGIN;
    const topY = USER_MARGIN;
    const botY = canvas - USER_MARGIN;
    const halfWAt = (y) => (shapeW / 2) * ((y - topY) / (botY - topY));
    const qrTop = totalMarginPx + dy;
    expect(halfWAt(qrTop)).toBeGreaterThanOrEqual(dataW / 2);
    expect(halfWAt(qrTop + dataW)).toBeGreaterThanOrEqual(dataW / 2);
  });

  it("returns the input untouched when no mask is selected", () => {
    state.generator.maskType = "none";
    const svg = buildSvg(300);
    expect(applySurroundShape(svg, USER_MARGIN, 300, 300, MODULE_COUNT)).toBe(svg);
  });

  it("paints a stepped, module-aligned silhouette instead of a smooth curve", () => {
    state.generator.maskType = "circle";
    state.generator.shapeBody = "square";
    const { canvas } = geometry("circle");
    const moduleSize = Math.floor(REQUESTED_W / MODULE_COUNT);
    const out = applySurroundShape(buildSvg(canvas), USER_MARGIN, canvas, canvas, MODULE_COUNT);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const bg = doc.querySelector(".qr-mask-bg");
    expect(bg).toBeTruthy();
    expect(bg.tagName.toLowerCase()).toBe("path");
    expect(doc.querySelector("circle")).toBeNull();
    expect(bg.getAttribute("d")).toContain(`h${moduleSize}v${moduleSize}`);
    expect((bg.getAttribute("d").match(/z/g) || []).length).toBeGreaterThan(20);
  });

  it("gives surround tiles the same classy glyph as the body", () => {
    state.generator.maskType = "circle";
    state.generator.shapeBody = "classy-rounded";
    const { canvas } = geometry("circle");
    const out = applySurroundShape(buildSvg(canvas), USER_MARGIN, canvas, canvas, MODULE_COUNT);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const surround = doc.querySelector(".qr-surround");
    expect(surround).toBeTruthy();
    const tile = [...surround.querySelectorAll("path")].find((p) =>
      (p.getAttribute("d") || "").includes("a")
    );
    expect(tile).toBeTruthy();
  });

  it("keeps the silhouette edge solid and the interior neighbour-aware", () => {
    state.generator.maskType = "circle";
    state.generator.shapeBody = "classy-rounded";
    const { canvas } = geometry("circle");
    const moduleSize = Math.floor(REQUESTED_W / MODULE_COUNT);
    const out = applySurroundShape(buildSvg(canvas), USER_MARGIN, canvas, canvas, MODULE_COUNT);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const surround = doc.querySelector(".qr-surround");
    // Edge cells are full squares so the dark silhouette never pokes out...
    expect([...surround.querySelectorAll("rect")].some((r) => !r.hasAttribute("rx"))).toBe(true);
    // ...while interior tiles use the library's neighbour-aware glyphs.
    const glyphs = [...surround.querySelectorAll("path")].map((p) => p.getAttribute("d") || "");
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.some((d) => d.includes(`a${moduleSize} ${moduleSize} 0 0 0`))).toBe(true);
  });
});

describe("surroundTilePlan (library glyph rules)", () => {
  const none = { left: false, right: false, top: false, bottom: false };
  const left = { ...none, left: true };
  const right = { ...none, right: true };
  const top = { ...none, top: true };
  const bottom = { ...none, bottom: true };

  it("mirrors the library's classy-rounded rules", () => {
    expect(surroundTilePlan("classy-rounded", none)).toEqual({ primitive: "corners", rotation: 90 });
    expect(surroundTilePlan("classy-rounded", left)).toEqual({ primitive: "corner-extra", rotation: 90 });
    expect(surroundTilePlan("classy-rounded", top)).toEqual({ primitive: "corner-extra", rotation: 90 });
    expect(surroundTilePlan("classy-rounded", right)).toEqual({ primitive: "corner-extra", rotation: -90 });
    expect(surroundTilePlan("classy-rounded", { ...none, left: true, right: true })).toEqual({
      primitive: "square",
      rotation: 0,
    });
    expect(surroundTilePlan("classy-rounded", { ...none, left: true, bottom: true })).toEqual({
      primitive: "square",
      rotation: 0,
    });
  });

  it("mirrors the library's classy rules (sharp corner primitive)", () => {
    expect(surroundTilePlan("classy", none)).toEqual({ primitive: "corners", rotation: 90 });
    expect(surroundTilePlan("classy", left)).toEqual({ primitive: "corner", rotation: 90 });
    expect(surroundTilePlan("classy", bottom)).toEqual({ primitive: "corner", rotation: -90 });
  });

  it("mirrors the library's rounded and extra-rounded rules", () => {
    expect(surroundTilePlan("rounded", none)).toEqual({ primitive: "dot", rotation: 0 });
    expect(surroundTilePlan("rounded", bottom)).toEqual({ primitive: "side", rotation: -90 });
    expect(surroundTilePlan("rounded", { ...none, left: true, top: true })).toEqual({
      primitive: "corner",
      rotation: 90,
    });
    expect(surroundTilePlan("extra-rounded", { ...none, top: true, right: true })).toEqual({
      primitive: "corner-extra",
      rotation: 180,
    });
    expect(surroundTilePlan("extra-rounded", { ...none, left: true, top: true, right: true })).toEqual({
      primitive: "square",
      rotation: 0,
    });
  });
});

describe("optimizeSvgRects (per-module rect merge)", () => {
  const clipSvg = (rects) =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><defs>' +
    `<clipPath id="clip-path-dot-color-0">${rects}</clipPath>` +
    '</defs><rect x="0" y="0" width="60" height="60" clip-path="url(#clip-path-dot-color-0)" fill="#000000"/></svg>';

  const clipRects = (svg) => {
    const inner = svg.match(/<clipPath id="clip-path-dot-color-0">([\s\S]*?)<\/clipPath>/)[1];
    const fromPath = [...inner.matchAll(/M([-\d.]+) ([-\d.]+)h([-\d.]+)v([-\d.]+)h-([-\d.]+)z/g)].map(
      (m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] })
    );
    if (fromPath.length) return fromPath;
    return [...inner.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)].map(
      (m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] })
    );
  };

  const covers = (rects, px, py) =>
    rects.some((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);

  it("collapses a run of adjacent plain module rects into one path", () => {
    const rects = [0, 10, 20]
      .map((x) => `<rect x="${x}" y="0" width="10" height="10" transform="rotate(0,${x + 5},5)"/>`)
      .join("");
    const before = clipSvg(rects);
    const out = optimizeSvgRects(before);
    expect(out).not.toBe(before);
    // One path: separate clip shapes double-blend their AA at shared edges and
    // show up as hairline seams on fractional display scales.
    expect(out).toContain('<path d="M0 0h30v10h-30z"/>');
    const clipInner = out.match(/<clipPath id="clip-path-dot-color-0">([\s\S]*?)<\/clipPath>/)[1];
    expect(clipInner).not.toContain("<rect");
    expect(clipRects(out)).toHaveLength(1);
  });

  it("merges horizontally and vertically with pixel-identical coverage", () => {
    const cells = [
      [0, 0],
      [10, 0],
      [20, 0],
      [0, 10],
      [10, 10],
      [0, 20],
    ];
    const before = clipSvg(
      cells
        .map(
          ([x, y]) => `<rect x="${x}" y="${y}" width="10" height="10" transform="rotate(0,${x + 5},${y + 5})"/>`
        )
        .join("")
    );
    const out = optimizeSvgRects(before);
    const source = clipRects(before);
    const merged = clipRects(out);
    expect(merged.length).toBeLessThan(source.length);
    // Sample the whole canvas at half-pixel resolution: the union of the
    // merged runs must cover exactly the same points as the module rects.
    for (let x = -1; x <= 61; x += 0.5) {
      for (let y = -1; y <= 61; y += 0.5) {
        expect(covers(merged, x, y), `point ${x},${y}`).toBe(covers(source, x, y));
      }
    }
  });

  it("leaves rounded, rotated and circular clip shapes untouched", () => {
    const svg = clipSvg(
      '<rect x="0" y="0" width="10" height="10" rx="3" transform="rotate(0,5,5)"/>' +
        '<rect x="10" y="0" width="10" height="10" transform="rotate(45,15,5)"/>' +
        '<circle cx="25" cy="5" r="5"/>'
    );
    expect(optimizeSvgRects(svg)).toBe(svg);
  });

  it("returns the input untouched without a dot clip", () => {
    const noClip = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    expect(optimizeSvgRects(noClip)).toBe(noClip);
  });

  it("converts isolated plain rects into subpaths of one path", () => {
    const isolated = clipSvg(
      '<rect x="0" y="0" width="10" height="10"/><rect x="20" y="0" width="10" height="10"/>'
    );
    const out = optimizeSvgRects(isolated);
    expect(out).not.toBe(isolated);
    expect(out).toContain('<path d="M0 0h10v10h-10zM20 0h10v10h-10z"/>');
    expect(clipRects(out)).toHaveLength(2);
  });
});
