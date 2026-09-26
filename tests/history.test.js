import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatHistoryTimestamp } from "../src/js/utils.js";

async function freshHistoryModule({ mockGenerator = false } = {}) {
  vi.resetModules();
  if (mockGenerator) {
    vi.doMock("../src/js/generator/generator.js", () => ({
      generateQR: vi.fn(),
      syncConfigToUI: vi.fn(),
      renderOnce: vi.fn(),
    }));
  } else {
    vi.doUnmock("../src/js/generator/generator.js");
  }
  const dom = await import("../src/js/ui/dom.js");
  const stateMod = await import("../src/js/state");
  const historyMod = await import("../src/js/generator/history.js");
  dom.DOM.generatorHistoryList = document.createElement("div");
  dom.DOM.btnClearGeneratorHistory = document.createElement("button");
  dom.DOM.btnExportHistoryAll = document.createElement("button");
  document.body.append(
    dom.DOM.generatorHistoryList,
    dom.DOM.btnClearGeneratorHistory,
    dom.DOM.btnExportHistoryAll
  );
  return {
    DOM: dom.DOM,
    state: stateMod.state,
    initGeneratorHistory: historyMod.initGeneratorHistory,
    renderGeneratorHistory: historyMod.renderGeneratorHistory,
    saveGeneratorHistory: historyMod.saveGeneratorHistory,
    historyEntryName: historyMod.historyEntryName,
  };
}

describe("generator history clear-all", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.spyOn(window, "confirm").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears history and shows an undo toast instead of calling window.confirm", async () => {
    const { DOM, state, initGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [{ id: 1, time: "now", config: { dataString: "https://example.com" } }];
    initGeneratorHistory();
    DOM.btnClearGeneratorHistory.click();

    expect(window.confirm).not.toHaveBeenCalled();
    expect(state.generatorHistory).toHaveLength(0);

    const toast = document.getElementById("undo-toast");
    expect(toast).not.toBeNull();
    expect(toast.classList.contains("hidden")).toBe(false);
  });

  it("undo restores the cleared history", async () => {
    const { DOM, state, initGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [{ id: 1, time: "now", config: { dataString: "https://example.com" } }];
    initGeneratorHistory();
    DOM.btnClearGeneratorHistory.click();
    expect(state.generatorHistory).toHaveLength(0);

    const undoBtn = document.getElementById("undo-toast-btn");
    expect(undoBtn).not.toBeNull();
    undoBtn.click();

    expect(state.generatorHistory).toHaveLength(1);
    expect(state.generatorHistory[0].config.dataString).toBe("https://example.com");
  });

  it("is a no-op when history is already empty", async () => {
    const { DOM, state, initGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [];
    initGeneratorHistory();
    DOM.btnClearGeneratorHistory.click();
    expect(document.getElementById("undo-toast")).toBeNull();
    expect(window.confirm).not.toHaveBeenCalled();
  });
});

describe("generator history — delete/undo round-trip", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("deletes an item and restores it at the same index on undo", async () => {
    const { DOM, state, initGeneratorHistory, renderGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [
      { id: 3, time: "t", config: { dataString: "third" } },
      { id: 2, time: "t", config: { dataString: "second" } },
      { id: 1, time: "t", config: { dataString: "first" } },
    ];
    initGeneratorHistory();
    renderGeneratorHistory();

    DOM.generatorHistoryList.querySelectorAll(".btn-delete-generator-history")[1].click();
    expect(state.generatorHistory.map((item) => item.id)).toEqual([3, 1]);

    const undoBtn = document.getElementById("undo-toast-btn");
    expect(undoBtn).not.toBeNull();
    undoBtn.click();

    expect(state.generatorHistory.map((item) => item.id)).toEqual([3, 2, 1]);
    expect(state.generatorHistory[1].config.dataString).toBe("second");
  });

  it("clamps the undo insert position when the list shrank meanwhile", async () => {
    const { DOM, state, initGeneratorHistory, renderGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [
      { id: 3, time: "t", config: { dataString: "third" } },
      { id: 2, time: "t", config: { dataString: "second" } },
      { id: 1, time: "t", config: { dataString: "first" } },
    ];
    initGeneratorHistory();
    renderGeneratorHistory();

    DOM.generatorHistoryList.querySelectorAll(".btn-delete-generator-history")[2].click();
    state.generatorHistory.length = 0;
    document.getElementById("undo-toast-btn").click();

    expect(state.generatorHistory).toHaveLength(1);
    expect(state.generatorHistory[0].id).toBe(1);
  });
});

describe("generator history — malformed stored items", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders corrupt items without throwing", async () => {
    const { DOM, state, renderGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [
      null,
      { id: 1 },
      { id: 2, config: null, time: null },
      { id: 3, time: 5, config: { dataString: 12345 } },
      { id: 4, time: "<b>x</b>", config: { dataString: "<img src=x onerror=alert(1)>" } },
    ];
    expect(() => renderGeneratorHistory()).not.toThrow();
    expect(DOM.generatorHistoryList.querySelectorAll(".history-item")).toHaveLength(5);
    expect(DOM.generatorHistoryList.textContent).toContain("12345");
    expect(DOM.generatorHistoryList.querySelector("img")).toBeNull();
    expect(DOM.generatorHistoryList.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("Load applies only well-typed config fields", async () => {
    const { DOM, state, initGeneratorHistory } = await freshHistoryModule({ mockGenerator: true });
    state.generator.maskCustom = "M0 0";
    state.generator.width = 300;
    state.generator.dataString = "previous";
    state.generator.isValid = true;
    state.generatorHistory = [
      {
        id: 1,
        time: "now",
        config: {
          dataString: 42,
          maskCustom: { bad: true },
          width: "400",
          isValid: "yes",
          fields: "nope",
          bgColor: 123,
        },
      },
    ];
    initGeneratorHistory();
    DOM.generatorHistoryList.innerHTML = '<button class="btn-load-history" data-idx="0">Load</button>';
    DOM.generatorHistoryList.querySelector(".btn-load-history").click();

    expect(state.generator.maskCustom).toBe("M0 0");
    expect(state.generator.width).toBe(300);
    expect(state.generator.bgColor).toBe("#ffffff");
    expect(state.generator.dataString).toBe("");
    expect(state.generator.isValid).toBe(true);
  });

  it("survives quota failures and trims large-logo items", async () => {
    const { state, saveGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [
      null,
      { id: 1, time: "now", config: { dataString: "small", logoDataUrl: null } },
      { id: 2, time: "now", config: { dataString: "big", logoDataUrl: "x".repeat(70 * 1024) } },
    ];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("quota", "QuotaExceededError");
    };
    try {
      expect(() => saveGeneratorHistory()).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(state.generatorHistory.some((item) => item && item.id === 2)).toBe(false);
    expect(state.generatorHistory.some((item) => item && item.id === 1)).toBe(true);
    expect(state.generatorHistory.some((item) => item === null)).toBe(true);
  });

  it("trims items with oversized background images too", async () => {
    const { state, saveGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [
      { id: 1, time: "now", config: { dataString: "small", bgImageDataUrl: null } },
      { id: 2, time: "now", config: { dataString: "big-bg", bgImageDataUrl: "x".repeat(70 * 1024) } },
    ];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("quota", "QuotaExceededError");
    };
    try {
      expect(() => saveGeneratorHistory()).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(state.generatorHistory.map((item) => item.id)).toEqual([1]);
  });
});

describe("generator history — batch export", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("../src/js/generator/export.js");
    vi.doUnmock("../src/js/generator/generator.js");
    vi.restoreAllMocks();
  });

  async function freshBatchHistoryModule() {
    vi.resetModules();
    let capturedOverrides = null;
    vi.doMock("../src/js/generator/generator.js", () => ({
      generateQR: vi.fn(),
      syncConfigToUI: vi.fn(),
      renderOnce: vi.fn(async (overrides) => {
        capturedOverrides = overrides;
        return { svg: "<svg/>" };
      }),
    }));
    const downloads = [];
    const exportCalls = [];
    // Partial mock: keep the real sanitizeFilename (the download names under
    // test depend on it) and stub only the two side-effecting exports.
    vi.doMock("../src/js/generator/export.js", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        exportRenderedBlob: vi.fn(async (...args) => {
          exportCalls.push(args);
          return new Blob(["png"], { type: "image/png" });
        }),
        downloadBlob: vi.fn((_blob, name) => downloads.push(name)),
      };
    });
    const dom = await import("../src/js/ui/dom.js");
    const stateMod = await import("../src/js/state");
    const historyMod = await import("../src/js/generator/history.js");
    dom.DOM.generatorHistoryList = document.createElement("div");
    dom.DOM.btnClearGeneratorHistory = document.createElement("button");
    dom.DOM.btnExportHistoryAll = document.createElement("button");
    dom.DOM.btnExportHistoryAll.textContent = "Download all";
    document.body.append(
      dom.DOM.generatorHistoryList,
      dom.DOM.btnClearGeneratorHistory,
      dom.DOM.btnExportHistoryAll
    );
    return {
      DOM: dom.DOM,
      state: stateMod.state,
      initGeneratorHistory: historyMod.initGeneratorHistory,
      renderGeneratorHistory: historyMod.renderGeneratorHistory,
      downloads,
      exportCalls,
      capturedOverrides: () => capturedOverrides,
    };
  }

  it("downloads every entry newest-first and re-enables the button", async () => {
    const { DOM, state, initGeneratorHistory, downloads } = await freshBatchHistoryModule();
    state.generatorHistory = [
      { id: 3, time: "now", config: { dataString: "third" } },
      { id: 2, time: "now", config: { dataString: "second" } },
      { id: 1, time: "now", config: { dataString: "first" } },
    ];
    initGeneratorHistory();

    DOM.btnExportHistoryAll.click();
    expect(DOM.btnExportHistoryAll.disabled).toBe(true);
    expect(DOM.btnExportHistoryAll.textContent).toBe("Exporting…");
    DOM.btnExportHistoryAll.click();

    await vi.advanceTimersByTimeAsync(2000);

    // Files are named after the entry, not "qr-code-<timestamp>".
    expect(downloads).toEqual(["third.png", "second.png", "first.png"]);
    expect(DOM.btnExportHistoryAll.disabled).toBe(false);
    expect(DOM.btnExportHistoryAll.textContent).toBe("Download all");
  });

  it("skips entries deleted while a batch export is in flight", async () => {
    const { DOM, state, initGeneratorHistory, downloads } = await freshBatchHistoryModule();
    state.generatorHistory = [
      { id: 3, time: "now", config: { dataString: "third" } },
      { id: 2, time: "now", config: { dataString: "second" } },
      { id: 1, time: "now", config: { dataString: "first" } },
    ];
    initGeneratorHistory();

    DOM.btnExportHistoryAll.click();
    // First file downloaded, gap sleep pending: remove the middle entry.
    await vi.advanceTimersByTimeAsync(150);
    state.generatorHistory.splice(1, 1);
    await vi.advanceTimersByTimeAsync(2000);

    expect(downloads).toEqual(["third.png", "first.png"]);
    expect(DOM.btnExportHistoryAll.textContent).toBe("Download all");
  });

  it("keeps the row's export icon while the file is prepared", async () => {
    const {
      DOM,
      state,
      initGeneratorHistory,
      renderGeneratorHistory,
      downloads,
    } = await freshBatchHistoryModule();
    state.generatorHistory = [
      { id: 1, time: "t", config: { dataType: "url", dataString: "https://example.com" } },
    ];
    initGeneratorHistory();
    renderGeneratorHistory();

    const btn = DOM.generatorHistoryList.querySelector(".btn-export-history");
    expect(btn.querySelector("svg")).not.toBeNull();
    btn.click();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    // The busy state used to write a "…" into the button, which replaced the
    // icon and left an empty square behind.
    expect(btn.querySelector("svg")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(10);

    expect(btn.disabled).toBe(false);
    expect(btn.hasAttribute("aria-busy")).toBe(false);
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(downloads).toEqual(["example-com.png"]);
  });

  it("renders the saved config without overwriting the live one", async () => {
    const { state, capturedOverrides } = await freshBatchHistoryModule();
    const historyMod = await import("../src/js/generator/history.js");
    state.generator.dataType = "url";
    state.generator.dataString = "https://live.example";
    const item = { id: 1, time: "now", config: { dataType: "text", dataString: "saved payload" } };

    await historyMod.exportHistoryConfigPng(item);

    expect(capturedOverrides().dataType).toBe("text");
    expect(capturedOverrides().dataString).toBe("saved payload");
    expect(state.generator.dataType).toBe("url");
    expect(state.generator.dataString).toBe("https://live.example");
  });

  it("renders a history export with the item's gradients, not the live ones", async () => {
    const { state, capturedOverrides } = await freshBatchHistoryModule();
    const historyMod = await import("../src/js/generator/history.js");
    const liveFrame = { type: "linear", rotation: 10, color2: "#111111" };
    const liveFrameText = { type: "linear", rotation: 20, color2: "#222222" };
    state.generator.frameGradient = liveFrame;
    state.generator.frameTextGradient = liveFrameText;
    const item = { id: 1, time: "now", config: { dataString: "a" } };

    await historyMod.exportHistoryConfigPng(item);

    expect(capturedOverrides().frameGradient).toBeNull();
    expect(capturedOverrides().frameTextGradient).toBeNull();
    expect(state.generator.frameGradient).toEqual(liveFrame);
    expect(state.generator.frameTextGradient).toEqual(liveFrameText);
  });

  it("passes the saved background to the exporter so a transparent design stays transparent", async () => {
    const { state, exportCalls } = await freshBatchHistoryModule();
    const historyMod = await import("../src/js/generator/history.js");
    state.generator.bgTransparent = false;
    state.generator.bgColor = "#ff0000";
    const item = {
      id: 1,
      time: "now",
      config: { dataString: "a", bgTransparent: true, bgColor: "#00ff00" },
    };

    await historyMod.exportHistoryConfigPng(item);

    const dataOverride = exportCalls[0][2];
    expect(dataOverride.bgTransparent).toBe(true);
    expect(dataOverride.bgColor).toBe("#00ff00");
    expect(exportCalls[0][1]).toBeNull();
  });

  it("keeps the batch button disabled when the list is emptied mid-export", async () => {
    const { DOM, state, initGeneratorHistory, downloads } = await freshBatchHistoryModule();
    state.generatorHistory = [{ id: 1, time: "now", config: { dataString: "only" } }];
    initGeneratorHistory();

    DOM.btnExportHistoryAll.click();
    // The first item is already in flight; delete everything before it lands.
    state.generatorHistory.splice(0, 1);
    await vi.advanceTimersByTimeAsync(2000);

    expect(downloads).toEqual([]);
    expect(DOM.btnExportHistoryAll.disabled).toBe(true);
    expect(DOM.btnExportHistoryAll.textContent).toBe("Download all");
  });
});

describe("generator history — Save button re-evaluation", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("re-runs generateQR after delete, clear and both undos", async () => {
    const { DOM, state, initGeneratorHistory, renderGeneratorHistory } = await freshHistoryModule({
      mockGenerator: true,
    });
    const { generateQR } = await import("../src/js/generator/generator.js");
    state.generatorHistory = [
      { id: 1, time: "t", config: { dataString: "saved" } },
      { id: 2, time: "t", config: { dataString: "other" } },
    ];
    initGeneratorHistory();
    renderGeneratorHistory();
    generateQR.mockClear();

    DOM.generatorHistoryList.querySelector(".btn-delete-generator-history").click();
    expect(generateQR).toHaveBeenCalledWith(true);

    generateQR.mockClear();
    document.getElementById("undo-toast-btn").click();
    expect(generateQR).toHaveBeenCalledWith(true);

    generateQR.mockClear();
    DOM.btnClearGeneratorHistory.click();
    expect(generateQR).toHaveBeenCalledWith(true);

    generateQR.mockClear();
    document.getElementById("undo-toast-btn").click();
    expect(generateQR).toHaveBeenCalledWith(true);
  });

  it("does not kick off a render for a plain repaint of the same list", async () => {
    const { state, initGeneratorHistory, renderGeneratorHistory } = await freshHistoryModule({
      mockGenerator: true,
    });
    const { generateQR } = await import("../src/js/generator/generator.js");
    state.generatorHistory = [{ id: 1, time: "t", config: { dataString: "saved" } }];
    initGeneratorHistory();
    renderGeneratorHistory();
    renderGeneratorHistory();
    generateQR.mockClear();
    renderGeneratorHistory();
    expect(generateQR).not.toHaveBeenCalled();
  });
});

describe("generator history — design thumbnail", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("draws four shapes in the saved colours", async () => {
    const { DOM, state, renderGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [
      {
        id: 1,
        time: "t",
        config: {
          dataString: "https://example.com",
          bgColor: "#102030",
          dotsColor: "#405060",
          cornersSquareColor: "#708090",
          cornersDotColor: "#a0b0c0",
          shapeBody: "square",
          shapeOuter: "square",
          shapeInner: "square",
          maskType: "star",
        },
      },
    ];
    renderGeneratorHistory();

    const svg = DOM.generatorHistoryList.querySelector(".history-preview svg");
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    const markup = svg.outerHTML;
    for (const color of ["#102030", "#405060", "#708090", "#a0b0c0"]) {
      expect(markup).toContain(color);
    }
    // Four shapes: three finders (outer + inner block each) and one body block.
    // The 3x3 dot grid that made the old tile read as a face is gone.
    expect(svg.querySelectorAll("rect")).toHaveLength(8);
    expect(svg.querySelectorAll("circle")).toHaveLength(0);
    // The tile keeps its own square: the overall mask never clips it.
    expect(svg.querySelector("clipPath")).toBeNull();
  });

  it("uses gradients and drops the background rect when transparent", async () => {
    const { DOM, state, renderGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [
      {
        id: 1,
        time: "t",
        config: {
          dataString: "x",
          bgTransparent: true,
          dotsColor: "#111111",
          dotsGradient: { type: "linear", rotation: 90, color2: "#222222" },
        },
      },
    ];
    renderGeneratorHistory();

    const svg = DOM.generatorHistoryList.querySelector(".history-preview svg");
    expect(svg.querySelector('rect[width="24"]')).toBeNull();
    expect(svg.querySelector("linearGradient")).not.toBeNull();
    expect(svg.innerHTML).toContain("url(#hp");
  });

  it("draws dot shapes as circles", async () => {
    const { DOM, state, renderGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [
      {
        id: 1,
        time: "t",
        config: { dataString: "x", shapeBody: "dot", shapeOuter: "dot", shapeInner: "dot" },
      },
    ];
    renderGeneratorHistory();

    const svg = DOM.generatorHistoryList.querySelector(".history-preview svg");
    // Three finders (2 circles each) plus the body block.
    expect(svg.querySelectorAll("circle")).toHaveLength(7);
    expect(svg.querySelectorAll("rect")).toHaveLength(1);
  });
});

describe("generator history — entry names", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("names a URL entry after its host and types it as a URL", async () => {
    const { historyEntryName } = await freshHistoryModule();
    const { title, meta } = historyEntryName({
      dataType: "url",
      dataString: "https://www.example.com/docs/page?x=1",
      fields: { "input-url": "https://www.example.com/docs/page?x=1" },
    });
    expect(title).toBe("example.com");
    expect(meta).toBe("URL");
  });

  it("names Wi-Fi, contact and event entries after their payload", async () => {
    const { historyEntryName } = await freshHistoryModule();
    expect(
      historyEntryName({ dataType: "wifi", fields: { "wifi-ssid": "Home network" } })
    ).toEqual({ title: "Home network", meta: "Wi-Fi" });
    expect(
      historyEntryName({ dataType: "contact", fields: { "contact-first": "Ada", "contact-last": "L" } })
    ).toEqual({ title: "Ada", meta: "Contact" });
    expect(historyEntryName({ dataType: "event", fields: { "event-title": "Launch" } })).toEqual({
      title: "Launch",
      meta: "Event",
    });
  });

  it("falls back to the payload, then to a placeholder", async () => {
    const { historyEntryName } = await freshHistoryModule();
    expect(historyEntryName({ dataType: "text", dataString: "just some words" }).title).toBe(
      "just some words"
    );
    // A payload-only URL entry still names itself after the host.
    expect(
      historyEntryName({ dataType: "url", dataString: "https://example.com/deep/link" }).title
    ).toBe("example.com");
    expect(historyEntryName({ dataType: "text", dataString: "" }).title).toBe("EMPTY");
    expect(historyEntryName(null).meta).toBe("Text");
  });

  it("keeps a long payload to one clipped line", async () => {
    const { historyEntryName } = await freshHistoryModule();
    const long = "x".repeat(200);
    const { title } = historyEntryName({ dataType: "text", dataString: long });
    expect(title.length).toBeLessThanOrEqual(40);
    expect(title.endsWith("…")).toBe(true);
  });

  it("renders the name with the type and time underneath", async () => {
    const { DOM, state, renderGeneratorHistory } = await freshHistoryModule();
    const id = new Date(2026, 0, 1, 12, 0).getTime();
    state.generatorHistory = [
      {
        id,
        // Stored in some other locale's format; the row must re-derive it.
        time: "stale-time-string",
        config: { dataType: "url", dataString: "https://example.com", fields: { "input-url": "https://example.com" } },
      },
    ];
    renderGeneratorHistory();

    const lines = DOM.generatorHistoryList.querySelectorAll(".history-item p");
    expect(lines[0].textContent).toBe("example.com");
    expect(lines[1].textContent).toBe(`URL · ${formatHistoryTimestamp(id)}`);
    // The raw payload stays reachable on hover.
    expect(lines[0].getAttribute("title")).toBe("https://example.com");
  });

  it("falls back to the stored time string when the entry has no id", async () => {
    const { DOM, state, renderGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [
      { id: null, time: "yesterday", config: { dataType: "text", dataString: "hello" } },
    ];
    renderGeneratorHistory();
    expect(DOM.generatorHistoryList.querySelectorAll(".history-item p")[1].textContent).toContain(
      "yesterday"
    );
  });

  it("escapes a hostile payload in the row", async () => {
    const { DOM, state, renderGeneratorHistory } = await freshHistoryModule();
    state.generatorHistory = [
      {
        id: 1,
        time: "t",
        config: { dataType: "text", dataString: '<img src=x onerror="alert(1)">', fields: {} },
      },
    ];
    renderGeneratorHistory();
    expect(DOM.generatorHistoryList.querySelector("img")).toBeNull();
    expect(DOM.generatorHistoryList.textContent).toContain("<img src=x");
  });
});

describe("generator history — frame gradient load correctness", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  async function loadConfig(config, liveFrameGradient = null, liveFrameTextGradient = null) {
    const { DOM, state, initGeneratorHistory } = await freshHistoryModule({ mockGenerator: true });
    state.generator.frameGradient = liveFrameGradient;
    state.generator.frameTextGradient = liveFrameTextGradient;
    state.generatorHistory = [{ id: 1, time: "now", config }];
    initGeneratorHistory();
    DOM.generatorHistoryList.innerHTML = '<button class="btn-load-history" data-idx="0">Load</button>';
    DOM.generatorHistoryList.querySelector(".btn-load-history").click();
    return state;
  }

  it("restores a saved frame gradient", async () => {
    const state = await loadConfig({
      dataString: "a",
      frameGradient: { type: "radial", rotation: 0, color2: "#ABCDEF" },
    });
    expect(state.generator.frameGradient).toEqual({ type: "radial", rotation: 0, color2: "#ABCDEF" });
  });

  it("clears a stale live frame gradient when the saved entry is solid", async () => {
    const state = await loadConfig({ dataString: "a" }, { type: "linear", rotation: 45, color2: "#123456" });
    expect(state.generator.frameGradient).toBeNull();
  });

  it("ignores a malformed saved frame gradient without throwing", async () => {
    const state = await loadConfig({ dataString: "a", frameGradient: { type: "sweep", color2: "nope" } });
    expect(state.generator.frameGradient).toBeNull();
  });

  it("restores a saved frame-text gradient", async () => {
    const state = await loadConfig({
      dataString: "a",
      frameTextGradient: { type: "linear", rotation: 135, color2: "#ABCDEF" },
    });
    expect(state.generator.frameTextGradient).toEqual({ type: "linear", rotation: 135, color2: "#ABCDEF" });
  });

  it("clears a stale live frame-text gradient when the saved entry is solid", async () => {
    const state = await loadConfig(
      { dataString: "a" },
      null,
      { type: "radial", rotation: 30, color2: "#123456" }
    );
    expect(state.generator.frameTextGradient).toBeNull();
  });

  it("ignores a malformed saved frame-text gradient", async () => {
    const state = await loadConfig({ dataString: "a", frameTextGradient: { type: "sweep" } }, null, {
      type: "radial",
      rotation: 30,
      color2: "#123456",
    });
    expect(state.generator.frameTextGradient).toBeNull();
  });
});
