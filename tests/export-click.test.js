import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const FRESH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect/></svg>';
const STALE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
  '<image class="qr-logo-image" href="data:image/png;base64,AAAA"/></svg>';

vi.mock("../src/js/generator/generator.js", () => ({
  renderOnce: vi.fn(async () => ({ svg: FRESH_SVG, w: 100, h: 100 })),
}));

import { DOM } from "../src/js/ui/dom.js";
import { setRenderInfo } from "../src/js/generator/render-info.js";
import { initExport } from "../src/js/generator/export.js";
import { renderOnce } from "../src/js/generator/generator.js";

describe("download renders the live config before exporting", () => {
  let captured;

  beforeEach(() => {
    document.body.innerHTML = "";
    DOM.btnDownload = document.createElement("button");
    DOM.btnCopy = document.createElement("button");
    DOM.exportFilename = document.createElement("input");
    DOM.exportFormat = { value: "svg" };
    document.body.append(DOM.btnDownload, DOM.btnCopy, DOM.exportFilename);
    captured = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      captured = blob;
      return "blob:test";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // The published render still carries the old logo (the race the fix closes).
    setRenderInfo({ svg: STALE_SVG, w: 100, h: 100, moduleCount: 21, userMarginPx: 4 });
    initExport();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setRenderInfo(null);
    delete DOM.btnDownload;
    delete DOM.btnCopy;
    delete DOM.exportFilename;
    delete DOM.exportFormat;
  });

  it("exports the awaited render instead of the stale published SVG", async () => {
    DOM.btnDownload.click();
    await vi.waitFor(() => expect(captured).not.toBeNull());
    expect(renderOnce).toHaveBeenCalled();
    expect(await captured.text()).toBe(FRESH_SVG);
  });
});

describe("copy button feedback", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    DOM.btnDownload = document.createElement("button");
    DOM.btnCopy = document.createElement("button");
    DOM.btnCopy.textContent = "Copy";
    DOM.exportFilename = document.createElement("input");
    DOM.exportFormat = { value: "svg" };
    document.body.append(DOM.btnDownload, DOM.btnCopy, DOM.exportFilename);
    setRenderInfo({ svg: FRESH_SVG, w: 100, h: 100, moduleCount: 21, userMarginPx: 4 });
    initExport();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setRenderInfo(null);
    delete DOM.btnDownload;
    delete DOM.btnCopy;
    delete DOM.exportFilename;
    delete DOM.exportFormat;
  });

  it("flashes a translated label, not the raw key", async () => {
    // The button used to flash the literal string "common.copied": the key
    // exists in no catalog (the catalogs define controls.copied).
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText, write: vi.fn() },
    });
    globalThis.ClipboardItem = undefined;

    DOM.btnCopy.click();
    await vi.waitFor(() => expect(DOM.btnCopy.textContent).toBe("Copied"));
    expect(DOM.btnCopy.textContent).not.toContain("common.");
    expect(writeText).toHaveBeenCalled();
  });
});
