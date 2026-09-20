import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { state, repairLowVisibilityColors, migrateInvertedStockPalette, DEFAULT_GENERATOR } from "../src/js/state";
import { decodeStateFromUrl } from "../src/js/share.js";

beforeEach(() => {
  state.generator.bgColor = "#ffffff";
  state.generator.bgTransparent = false;
  state.generator.dotsColor = "#000000";
  state.generator.cornersSquareColor = "#000000";
  state.generator.cornersDotColor = "#000000";
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("repairLowVisibilityColors", () => {
  it("repairs corner colors that match an opaque background to the foreground", () => {
    state.generator.cornersSquareColor = "#ffffff";
    state.generator.cornersDotColor = "#FFFFFF";
    expect(repairLowVisibilityColors(state.generator)).toBe(true);
    expect(state.generator.cornersSquareColor).toBe("#000000");
    expect(state.generator.cornersDotColor).toBe("#000000");
  });

  it("repairs an invisible foreground and lets the corners follow it", () => {
    state.generator.bgColor = "#101010";
    state.generator.dotsColor = "#101010";
    state.generator.cornersSquareColor = "#101010";
    state.generator.cornersDotColor = "#101010";
    expect(repairLowVisibilityColors(state.generator)).toBe(true);
    expect(state.generator.dotsColor).toBe("#ffffff");
    expect(state.generator.cornersSquareColor).toBe("#ffffff");
    expect(state.generator.cornersDotColor).toBe("#ffffff");
  });

  it("normalizes color casing and a missing leading #", () => {
    state.generator.bgColor = "ffffff";
    state.generator.cornersSquareColor = "#FFFFFF";
    expect(repairLowVisibilityColors(state.generator)).toBe(true);
    expect(state.generator.cornersSquareColor).toBe("#000000");
  });

  it("leaves transparent backgrounds alone", () => {
    state.generator.bgTransparent = true;
    state.generator.cornersSquareColor = "#ffffff";
    expect(repairLowVisibilityColors(state.generator)).toBe(false);
    expect(state.generator.cornersSquareColor).toBe("#ffffff");
  });

  it("leaves readable configs untouched", () => {
    expect(repairLowVisibilityColors(state.generator)).toBe(false);
  });
});

describe("stock palette polarity", () => {
  it("defaults to white code on a black card", () => {
  expect(DEFAULT_GENERATOR.bgColor).toBe("#ffffff");
  expect(DEFAULT_GENERATOR.dotsColor).toBe("#000000");
  expect(DEFAULT_GENERATOR.cornersSquareColor).toBe("#000000");
  expect(DEFAULT_GENERATOR.cornersDotColor).toBe("#000000");
  });

  it("flips a stored config still on the exact old stock palette", () => {
    state.generator.bgColor = "#ffffff";
    state.generator.dotsColor = "#000000";
    state.generator.cornersSquareColor = "#000000";
    state.generator.cornersDotColor = "#000000";
    expect(migrateInvertedStockPalette(state.generator)).toBe(true);
    expect(state.generator.bgColor).toBe("#000000");
    expect(state.generator.dotsColor).toBe("#ffffff");
    expect(state.generator.cornersSquareColor).toBe("#ffffff");
    expect(state.generator.cornersDotColor).toBe("#ffffff");
  });

  it("leaves custom palettes and transparent backgrounds alone", () => {
    state.generator.cornersSquareColor = "#123456";
    expect(migrateInvertedStockPalette(state.generator)).toBe(false);
    expect(state.generator.bgColor).toBe("#ffffff");

    state.generator.cornersSquareColor = "#000000";
    state.generator.bgTransparent = true;
    expect(migrateInvertedStockPalette(state.generator)).toBe(false);
  });
});

describe("share links repair invisible colors on decode", () => {
  it("repairs corner colors equal to the background from URL params", () => {
    window.history.replaceState(
      {},
      "",
      "/?dots=%23000000&bg=%23ffffff&cs=%23ffffff&cd=%23ffffff"
    );
    expect(decodeStateFromUrl()).toBe(true);
    expect(state.generator.cornersSquareColor).toBe("#000000");
    expect(state.generator.cornersDotColor).toBe("#000000");
  });

  it("keeps intentionally contrasting corner colors", () => {
    window.history.replaceState({}, "", "/?bg=%23ffffff&dots=%23000000&cs=%23ff0000&cd=%230000ff");
    expect(decodeStateFromUrl()).toBe(true);
    expect(state.generator.cornersSquareColor).toBe("#ff0000");
    expect(state.generator.cornersDotColor).toBe("#0000ff");
  });
});
