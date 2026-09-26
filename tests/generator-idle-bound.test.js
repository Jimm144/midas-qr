import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Kept in its own file: a deliberately hung render leaves the module's render
// queue pending forever, which would poison every later test in a shared file.
describe("whenIdle is bounded", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.qrcode;
    delete globalThis.QRCodeStyling;
  });

  it("gives up on a hung live render instead of spinning a timer forever", async () => {
    const { DOM } = await import("../src/js/ui/dom.js");
    const { state } = await import("../src/js/state");
    const { generateQR, renderOnce } = await import("../src/js/generator/generator.js");

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

    globalThis.qrcode = () => ({ addData() {}, make() {}, getModuleCount: () => 25 });
    // Never settles: the classic hung-render case.
    globalThis.QRCodeStyling = class {
      update() {}
      getRawData() {
        return new Promise(() => {});
      }
    };

    state.generator.dataType = "text";
    state.generator.dataString = "hang";
    state.generator.isValid = true;
    state.generator.width = 300;
    state.generator.height = 300;
    state.generator.margin = 4;
    state.generator.bgTransparent = false;
    state.generator.bgColor = "#ffffff";
    state.generator.dotsColor = "#000000";
    state.generator.cornersSquareColor = "#000000";
    state.generator.cornersDotColor = "#000000";
    state.generator.maskType = "none";
    state.generator.frameStyle = "none";
    state.generator.logoDataUrl = null;
    state.generator.bgImageDataUrl = null;

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateQR(true);
    await vi.advanceTimersByTimeAsync(50);

    // renderOnce waits for the live render to go idle first. Without the bound
    // it rescheduled every 15ms for the life of the page, and every caller
    // (batch export) stayed disabled behind it.
    void renderOnce({ dataString: "queued" }).catch(() => {});
    await vi.advanceTimersByTimeAsync(21000);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("did not settle"));
  });
});
