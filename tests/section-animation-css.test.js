import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The section accordion is pure CSS mechanics driven by two classes the toggle
// adds (is-collapsed / is-animating). These rules are what make the motion work,
// and each one replaced a specific bug — so pin them here rather than trusting
// that a stylesheet edit will not quietly undo one:
//   - grid-template-rows 1fr <-> 0fr  : one animated property (height+padding+
//     margin relaid the panel out every frame and looked choppy)
//   - minmax(0, 1fr) column           : without it the implicit auto track sized
//     to the inner, so a grid-2 panel (Colors) rendered at half width
//   - .section-inner > * flex-shrink:0: a column flex container with a
//     constrained height otherwise squashes its children instead of clipping
const rawCss = readFileSync(path.join(process.cwd(), "src/css/style.css"), "utf8");
// Comments carry prose about the rules (including the words being asserted on),
// so strip them before parsing.
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Declarations of every rule whose selector list contains `selector`, joined.
 * Split on rule boundaries and compare selectors exactly, so shared rules
 * (`.panel-card, .preview-card`) and selector lists work — a regex for
 * `selector {` misses both.
 */
const RULES = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((match) => ({
  selectors: match[1]
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean),
  body: match[2].replace(/\s+/g, " "),
}));

function ruleBody(selector) {
  const want = selector.replace(/\s+/g, " ");
  return RULES.filter((rule) => rule.selectors.includes(want))
    .map((rule) => rule.body)
    .join(" ");
}

describe("section accordion CSS contract", () => {
  it("animates a single grid track", () => {
    const body = ruleBody(".section-body");
    expect(body).toContain("display: grid");
    expect(body).toContain("grid-template-rows: 1fr");
    expect(body).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(body).toMatch(/transition: grid-template-rows/);
    // Animating geometry other than the track is what made it choppy.
    expect(body).not.toMatch(/transition:[^;]*\bheight\b/);
    expect(body).not.toMatch(/transition:[^;]*\bpadding\b/);
  });

  it("collapses to a zero-height track", () => {
    expect(ruleBody(".section-body.is-collapsed")).toContain("grid-template-rows: 0fr");
  });

  it("keeps the collapsed panel in the flow instead of display:none", () => {
    // `display: none` cannot be transitioned, so opening needed a forced reflow
    // to commit the 0fr start state — and once that reflow was made cheap the
    // track's used size was never resolved, so the panel snapped open. The
    // collapsed panel keeps its place at a 0fr track and is hidden from the tab
    // order and the a11y tree with visibility instead.
    const collapsed = ruleBody(".section-body.is-collapsed");
    expect(collapsed).not.toContain("display: none");
    expect(ruleBody(".section-body.is-collapsed:not(.is-animating)")).toContain("visibility: hidden");
    // The clip that does the revealing must be off once the panel has settled.
    expect(ruleBody(".section-body.is-animating > .section-inner")).toContain("overflow: hidden");
    expect(ruleBody(".section-inner")).not.toContain("overflow: hidden");
  });

  it("takes the collapsed inner's padding to zero in step with the track", () => {
    // A grid track's automatic minimum size includes the item's padding, which
    // cannot compress, so a "0fr" panel reserved its ~29px. The padding must
    // reach zero, and it must do so *with* the track: zeroing it in one frame
    // jumped the content up at the start of a close.
    const collapsedInner = ruleBody(".section-body.is-collapsed > .section-inner");
    expect(collapsedInner).toContain("padding-top: 0");
    expect(collapsedInner).toContain("padding-bottom: 0");
    const inner = ruleBody(".section-inner");
    expect(inner).toMatch(/transition:[^;]*padding-top/);
    expect(inner).toMatch(/transition:[^;]*padding-bottom/);
    expect(inner).not.toMatch(/transition:[^;]*\bheight\b/);
  });

  it("keeps the inner's children at their natural size", () => {
    // Without this the fields compress vertically during the animation.
    expect(ruleBody(".section-inner > *")).toContain("flex-shrink: 0");
    expect(ruleBody(".section-inner")).toContain("min-height: 0");
  });

  it("puts the two-column layout on the inner, not the panel", () => {
    // A .section-body.grid-2 rule made the *panel* a two-column grid, so the
    // single inner wrapper occupied one column (half the width).
    expect(ruleBody(".section-body.grid-2")).toBe("");
    expect(ruleBody(".section-body.grid-2 > .section-inner")).toContain("display: grid");
  });

  it("does not reserve page height below the footer", () => {
    // The page must end at the footer: no scrollable space under it and no slack
    // pushing it past collapsed content. The consequence — collapsing a section
    // near the bottom can shift the view because the browser clamps the scroll
    // when the document shortens past it — is accepted and noted in the CSS.
    expect(css).not.toMatch(/body\.tab-generator/);
    expect(css).not.toMatch(/padding-bottom:\s*300px/);
  });

  it("gives the sticky preview a containing block taller than itself", () => {
    // A sticky item can only travel inside its grid area. While the panel grid
    // was only as tall as its content, the row equalled the preview's own height
    // whenever the sections column was shorter — zero travel, so sticky did
    // nothing at all. The generator's grid must fill its height, and the card
    // must not stretch to that height.
    expect(ruleBody(".preview-card")).toContain("position: sticky");
    expect(ruleBody(".preview-card")).toContain("align-self: start");
    expect(ruleBody("#panel-generator.panel-grid")).toContain("flex: 1");
    expect(ruleBody(".workspace")).toContain("display: flex");
    expect(ruleBody(".workspace")).toContain("flex-direction: column");
  });

  it("connects the header to its panel without moving anything", () => {
    // The connected look is cosmetic only: the header's bottom corners and
    // border *colour* flip (transitioned, no layout), while every layout value
    // stays constant. Flipping a margin with aria-expanded closed the gap in one
    // frame on open (a snap) and made the gap breathe while the panel grew.
    const button = ruleBody(".btn-toggle-section");
    expect(button).toContain("margin-bottom: 10px");
    expect(button).toMatch(/transition:[^;]*border-bottom-color/);
    expect(button).toMatch(/transition:[^;]*border-bottom-left-radius/);
    expect(button).not.toMatch(/transition:[^;]*margin/);
    // These finish after the panel, so they must stay shorter than its 220ms or
    // the edge reads as turning smooth too slowly.
    expect(button).not.toMatch(/transition:[^;]*border-bottom-color 220ms/);
    expect(button).not.toMatch(/transition:[^;]*border-bottom-left-radius 220ms/);
    // The panel cancels the header's margin with a constant negative top margin.
    expect(ruleBody(".section-body")).toContain("margin-top: -11px");
    expect(ruleBody(".section-body")).not.toMatch(/transition:[^;]*margin/);
    // The inner is the bottom half of the joined box.
    expect(ruleBody(".section-inner")).toContain("border-top: none");
    expect(ruleBody(".section-inner")).toContain("border-radius: 0 0");
    // The join is held for the whole motion, not keyed to aria-expanded alone.
    expect(ruleBody('.btn-toggle-section[aria-expanded="true"]')).toContain(
      "border-bottom-color: transparent"
    );
    expect(ruleBody(".btn-toggle-section.is-animating")).toContain("border-bottom-color: transparent");
  });

  it("never animates the join's border width or rounds it mid-motion", () => {
    // A transitioned border-bottom-width leaves a bright 1px line between the
    // header and the panel for the whole animation; flipping it instantly makes
    // the border reappear in one frame at the end of a close. The width must not
    // be touched at all — only its colour. And the open path disables the
    // transition while it flattens the header, so no half-morphed corner can sit
    // over the panel's square top corners.
    expect(ruleBody(".btn-toggle-section")).not.toMatch(/transition:[^;]*border-bottom-width/);
    expect(ruleBody('.btn-toggle-section[aria-expanded="true"]')).not.toContain("border-bottom-width");
    expect(ruleBody(".btn-toggle-section.is-animating")).not.toContain("border-bottom-width");
    expect(ruleBody(".btn-toggle-section.no-join-transition")).toContain("transition: none");
  });
});
