import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
    vi.doMock("../src/js/generator/export.js", () => ({
      exportRenderedBlob: vi.fn(async (...args) => {
        exportCalls.push(args);
        return new Blob(["png"], { type: "image/png" });
      }),
      downloadBlob: vi.fn((_blob, name) => downloads.push(name)),
    }));
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

    expect(downloads).toEqual(["qr-code-3.png", "qr-code-2.png", "qr-code-1.png"]);
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

    expect(downloads).toEqual(["qr-code-3.png", "qr-code-1.png"]);
    expect(DOM.btnExportHistoryAll.textContent).toBe("Download all");
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

describe("generator history — design preview", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the saved colours and shapes on a fixed tile", async () => {
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
          shapeBody: "dot",
          shapeOuter: "dot",
          shapeInner: "dot",
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
    // The tile keeps its own shape: the overall mask never clips it.
    expect(svg.querySelector("clipPath")).toBeNull();
    expect(svg.querySelectorAll("circle").length).toBeGreaterThan(3);
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
