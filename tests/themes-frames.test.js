import { describe, it, expect } from "vitest";
import { themes } from "../src/js/themes";
import {
  BUILT_IN_MASK_PATHS,
  FRAME_TEXT_DEFAULTS,
  framesConfig,
  FRAME_FONTS,
  defaultFrameTextEnabled,
} from "../src/js/frames";
import { frameTextFill } from "../src/js/generator/frame.js";
import { DEFAULT_GENERATOR, state } from "../src/js/state";
import {
  ALLOWED_DATA_TYPES,
  ALLOWED_ECC,
  ALLOWED_FRAMES,
  ALLOWED_GRADIENT_TYPES,
  ALLOWED_MASKS,
  ALLOWED_SHAPES,
  FRAME_TEXT_SIZE_BOUNDS,
} from "../src/js/constants.js";

/** Every field buildCssVarMap() reads off a theme variant. */
const VARIANT_KEYS = [
  "bg",
  "accent",
  "accentContrast",
  "accentSoft",
  "text",
  "surface",
  "bgElevated",
  "inset",
  "border",
  "borderStrong",
  "muted",
  "danger",
  "success",
  "warning",
  "shadowPop",
  "shadowColor",
  "radiusInner",
  "radiusElement",
  "radiusContainer",
  "buttonRadius",
];

const FONT_KEYS = ["body", "heading", "display", "code", "scale", "headingWeight"];

describe("theme families", () => {
  const families = Object.entries(themes);

  it("ships the seven documented theme families", () => {
    expect(families.map(([name]) => name).sort()).toEqual(
      ["butter", "chocolate", "gothic", "matcha", "neutral", "stone", "y2k"].sort()
    );
  });

  it.each(families)("%s exposes every token in both variants", (_name, family) => {
    for (const variantName of ["dark", "light"]) {
      const variant = family[variantName];
      expect(variant, `${variantName} variant missing`).toBeDefined();
      for (const key of VARIANT_KEYS) {
        expect(typeof variant[key], `${variantName}.${key}`).toBe("string");
        expect(variant[key], `${variantName}.${key}`).not.toBe("");
      }
    }
  });

  it.each(families)("%s exposes the full typography set", (_name, family) => {
    for (const key of FONT_KEYS) {
      expect(family.fonts[key], `fonts.${key}`).toBeDefined();
      expect(family.fonts[key]).not.toBe("");
    }
    expect(typeof family.fonts.scale).toBe("number");
    expect(family.fonts.scale).toBeGreaterThan(0);
  });
});

describe("frame configs", () => {
  it("covers the frame styles the share validator allows", () => {
    expect(Object.keys(framesConfig).sort()).toEqual(
      ["badge", "dashed", "label", "none", "rounded", "scan"].sort()
    );
    expect(framesConfig.none).toBeNull();
  });

  it.each(Object.entries(framesConfig).filter(([, cfg]) => cfg))(
    "%s has well-formed geometry",
    (_name, cfg) => {
      expect(cfg.svg).toMatch(/__ACCENT__|__BG__|<rect|<path/);
      for (const key of ["x", "y", "w", "h"]) {
        expect(typeof cfg.qrArea[key], `qrArea.${key}`).toBe("number");
      }
      expect(cfg.qrArea.w).toBeGreaterThan(0);
      expect(cfg.qrArea.h).toBeGreaterThan(0);
      expect(cfg.textArea.x).toBeGreaterThan(0);
      expect(cfg.textArea.size).toBeGreaterThan(0);
      expect(cfg.vbHeight).toBeGreaterThanOrEqual(24);
    }
  );

  it("collapses bar frames to a bar-free square without text", () => {
    for (const name of ["label", "badge"]) {
      const cfg = framesConfig[name];
      expect(cfg.noTextSvg, name).toBeTruthy();
      expect(cfg.noTextSvg, name).not.toContain("__ACCENT__");
      const area = cfg.noTextQrArea ?? cfg.qrArea;
      expect(area.y + area.h, name).toBeLessThanOrEqual(24);
      expect(area.x + area.w, name).toBeLessThanOrEqual(24);
    }
  });

  it("exposes only hostable or system frame fonts", () => {
    expect(FRAME_FONTS.length).toBeGreaterThan(0);
    for (const font of FRAME_FONTS) {
      expect(typeof font.value).toBe("string");
      expect(typeof font.label).toBe("string");
      expect(font.family === null || font.file !== null).toBe(true);
      if (font.family !== null) {
        expect(font.file, font.label).toMatch(/^src\/fonts\/[a-z0-9-]+\.woff2$/);
      }
    }
  });

  it("lists the hosted frame-text families added for the font picker", () => {
    const labels = FRAME_FONTS.map((font) => font.label);
    for (const label of [
      "Inter",
      "Space Grotesk",
      "Bebas Neue",
      "Anton",
      "Archivo Black",
      "Merriweather",
      "Lora",
      "Space Mono",
    ]) {
      expect(labels, label).toContain(label);
    }
  });

  it("keeps the default frame text size inside its bounds", () => {
    expect(typeof DEFAULT_GENERATOR.frameTextSize).toBe("number");
    expect(DEFAULT_GENERATOR.frameTextSize).toBeGreaterThanOrEqual(FRAME_TEXT_SIZE_BOUNDS.min);
    expect(DEFAULT_GENERATOR.frameTextSize).toBeLessThanOrEqual(FRAME_TEXT_SIZE_BOUNDS.max);
  });
});

describe("persistence/share allow-lists stay in sync with render tables", () => {
  it("ALLOWED_FRAMES matches framesConfig exactly", () => {
    expect([...ALLOWED_FRAMES].sort()).toEqual(Object.keys(framesConfig).sort());
  });

  it("FRAME_TEXT_DEFAULTS matches framesConfig and defaults the open frames off", () => {
    expect(Object.keys(FRAME_TEXT_DEFAULTS).sort()).toEqual(Object.keys(framesConfig).sort());
    for (const name of ["scan", "dashed", "rounded"]) {
      expect(FRAME_TEXT_DEFAULTS[name], name).toBe(false);
      expect(defaultFrameTextEnabled(name), name).toBe(false);
    }
    for (const name of ["none", "label", "badge"]) {
      expect(FRAME_TEXT_DEFAULTS[name], name).toBe(true);
      expect(defaultFrameTextEnabled(name), name).toBe(true);
    }
    // An unknown style never hides the text by accident.
    expect(defaultFrameTextEnabled("__proto__")).toBe(true);
    expect(defaultFrameTextEnabled("")).toBe(true);
  });

  it("ALLOWED_MASKS covers every built-in path plus the analytic/custom masks", () => {
    for (const key of Object.keys(BUILT_IN_MASK_PATHS)) {
      expect(ALLOWED_MASKS).toContain(key);
    }
    for (const key of ["circle", "triangle", "custom"]) {
      expect(ALLOWED_MASKS).toContain(key);
    }
  });

  it("every allow-list holds unique, non-empty values", () => {
    const lists = [
      ALLOWED_DATA_TYPES,
      ALLOWED_ECC,
      ALLOWED_FRAMES,
      ALLOWED_GRADIENT_TYPES,
      ALLOWED_MASKS,
      ALLOWED_SHAPES,
    ];
    for (const list of lists) {
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list).size).toBe(list.length);
      for (const value of list) {
        expect(typeof value).toBe("string");
        expect(value).not.toBe("");
      }
    }
  });
});

describe("frameTextFill contrast resolution", () => {
  it("uses bgColor on solid-bar frames (label, badge) by default", () => {
    state.generator.frameColor = "#000000";
    state.generator.dotsColor = "#000000";
    state.generator.bgColor = "#ffffff";
    state.generator.frameTextColor = "";

    expect(frameTextFill(framesConfig.label)).toBe("#ffffff");
    expect(frameTextFill(framesConfig.badge)).toBe("#ffffff");
  });

  it("uses explicit contrasting frameTextColor when provided", () => {
    state.generator.frameColor = "#000000";
    state.generator.dotsColor = "#000000";
    state.generator.bgColor = "#ffffff";
    state.generator.frameTextColor = "#ffcc00";

    expect(frameTextFill(framesConfig.label)).toBe("#ffcc00");
    expect(frameTextFill(framesConfig.scan)).toBe("#ffcc00");
  });

  it("avoids blending into solid bar when frameTextColor matches bar color", () => {
    state.generator.frameColor = "#000000";
    state.generator.dotsColor = "#000000";
    state.generator.bgColor = "#ffffff";
    state.generator.frameTextColor = "#000000"; // same as bar

    expect(frameTextFill(framesConfig.label)).toBe("#ffffff");
  });

  it("uses frameColor/dotsColor on open frames (scan, dashed, etc.) by default", () => {
    state.generator.frameColor = "#112233";
    state.generator.dotsColor = "#000000";
    state.generator.frameTextColor = "";

    expect(frameTextFill(framesConfig.scan)).toBe("#112233");
    expect(frameTextFill(framesConfig.dashed)).toBe("#112233");
  });
});
