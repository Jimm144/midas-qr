import { describe, it, expect, beforeEach, vi } from "vitest";

// Force the encoder load to fail so the pre-render early return is exercised
// without waiting on the real 20s script-load timeout.
vi.mock("../src/js/generator/encoder.js", () => ({
  ensureQrcodeLoaded: async () => false,
  generateUnicodeQR: () => null,
}));

import { state } from "../src/js/state";
import { DOM } from "../src/js/ui/dom.js";
import { renderOnce } from "../src/js/generator/generator.js";

function installDom() {
  DOM.qrCanvasContainer = document.createElement("div");
  DOM.qrPreviewContainer = document.createElement("div");
  DOM.emptyStateQr = document.createElement("div");
  DOM.btnDownload = document.createElement("button");
  DOM.btnCopy = document.createElement("button");
  DOM.btnSave = document.createElement("button");
  DOM.btnShareLink = document.createElement("button");
  DOM.qrLoading = null;
  DOM.marginWarning = null;
  DOM.qrReadabilityBadge = null;
}

describe("generateQR when the encoder library cannot load", () => {
  beforeEach(() => {
    installDom();
    state.generator.dataType = "text";
    state.generator.dataString = "hello";
    state.generator.isValid = true;
    state.generator.width = 300;
    state.generator.height = 300;
    state.generator.margin = 4;
    state.generator.frameStyle = "none";
    state.generator.maskType = "none";
    state.generator.logoDataUrl = null;
    state.generator.bgImageDataUrl = null;
  });

  it("settles one-off render waiters instead of leaving them pending", async () => {
    await expect(renderOnce({ dataString: "hello" })).rejects.toThrow(/libraries failed to load/i);
  });
});
