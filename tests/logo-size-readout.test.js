import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../src/js/state";
import { DOM } from "../src/js/ui/dom.js";
import { syncLogoSizeReadout } from "../src/js/generator/generator.js";

// The logo ratio is a slider, which shows no number of its own: the value sits
// beside the label, and it has to survive share links and history restores as
// well as the user dragging it.
describe("logo size readout", () => {
  beforeEach(() => {
    DOM.logoSizeValue = document.createElement("span");
  });

  it("mirrors the ratio, without trailing zeros", () => {
    state.generator.logoSizeProportion = 0.4;
    syncLogoSizeReadout();
    expect(DOM.logoSizeValue.textContent).toBe("0.4");

    state.generator.logoSizeProportion = 0.35;
    syncLogoSizeReadout();
    expect(DOM.logoSizeValue.textContent).toBe("0.35");

    state.generator.logoSizeProportion = 0.1;
    syncLogoSizeReadout();
    expect(DOM.logoSizeValue.textContent).toBe("0.1");
  });

  it("shows nothing rather than 'NaN' for a corrupt state", () => {
    state.generator.logoSizeProportion = Number.NaN;
    syncLogoSizeReadout();
    expect(DOM.logoSizeValue.textContent).toBe("");
  });

  it("is a no-op when the readout is absent", () => {
    DOM.logoSizeValue = null;
    state.generator.logoSizeProportion = 0.4;
    expect(() => syncLogoSizeReadout()).not.toThrow();
  });
});
