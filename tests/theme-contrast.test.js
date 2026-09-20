import { describe, it, expect } from "vitest";
import { themes } from "../src/js/themes";

/** Parse #rgb / #rrggbb into [r, g, b]; null for anything else. */
function parseHex(color) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  expect(fg, `unparseable color ${foreground}`).not.toBeNull();
  expect(bg, `unparseable color ${background}`).not.toBeNull();
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Mix `color` at `weight` over `base`, mirroring CSS color-mix(in srgb, ...). */
function mixHex(color, weight, base) {
  const mixed = parseHex(color).map((value, i) => Math.round(value * weight + parseHex(base)[i] * (1 - weight)));
  return "#" + mixed.map((value) => value.toString(16).padStart(2, "0")).join("");
}

const WCAG_AA = 4.5;
const variants = Object.entries(themes).flatMap(([name, family]) =>
  ["dark", "light"].map((variant) => [`${name}/${variant}`, family[variant]])
);

describe("theme text contrast (WCAG AA)", () => {
  it.each(variants)("%s: body text meets 4.5:1 on every surface", (_label, variant) => {
    for (const background of ["bg", "surface", "bgElevated", "inset"]) {
      expect(
        contrastRatio(variant.text, variant[background]),
        `text on ${background}: ${contrastRatio(variant.text, variant[background]).toFixed(2)}`
      ).toBeGreaterThanOrEqual(WCAG_AA);
    }
  });

  it.each(variants)("%s: muted (label/hint) text meets 4.5:1 on every surface", (_label, variant) => {
    // Regression: chocolate/light muted measured 2.48 on surface,
    // matcha/light 4.41 and y2k/light 4.25 on bg before the token fixes.
    for (const background of ["bg", "surface", "bgElevated", "inset"]) {
      expect(
        contrastRatio(variant.muted, variant[background]),
        `muted on ${background}: ${contrastRatio(variant.muted, variant[background]).toFixed(2)}`
      ).toBeGreaterThanOrEqual(WCAG_AA);
    }
  });

  it.each(variants)("%s: accent-contrast text meets 4.5:1 on the accent fill", (_label, variant) => {
    expect(contrastRatio(variant.accentContrast, variant.accent)).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it.each(variants)("%s: status colors meet 4.5:1 on bg and surface", (_label, variant) => {
    for (const status of ["danger", "success", "warning"]) {
      for (const background of ["bg", "surface"]) {
        expect(
          contrastRatio(variant[status], variant[background]),
          `${status} on ${background}: ${contrastRatio(variant[status], variant[background]).toFixed(2)}`
        ).toBeGreaterThanOrEqual(WCAG_AA);
      }
    }
  });

  it.each(variants)("%s: warnings stay 4.5:1 on the accordion surface", (_label, variant) => {
    // .field-warning renders --danger text on .section-body, whose background
    // is color-mix(bgElevated 65%, surface).
    const section = parseHex(variant.bgElevated).map((value, i) =>
      Math.round(value * 0.65 + parseHex(variant.surface)[i] * 0.35)
    );
    const sectionHex = "#" + section.map((v) => v.toString(16).padStart(2, "0")).join("");
    expect(contrastRatio(variant.danger, sectionHex)).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it.each(variants)("%s: status badge copy stays 4.5:1 on its own tint", (_label, variant) => {
    // Mirrors #qr-readability-badge / #scan-status-badge: text is
    // color-mix(status 80%, text) on color-mix(status 14%, transparent)
    // composited over the card surface.
    for (const status of ["danger", "success", "warning"]) {
      const tint = mixHex(variant[status], 0.14, variant.surface);
      const copy = mixHex(variant[status], 0.8, variant.text);
      expect(
        contrastRatio(copy, tint),
        `${status} badge: ${contrastRatio(copy, tint).toFixed(2)}`
      ).toBeGreaterThanOrEqual(WCAG_AA);
    }
  });
});
