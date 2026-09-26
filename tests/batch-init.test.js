import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// initBatchExport is the only entry point to batch export, and it was entirely
// untested (batch.test.js mocks DOM.batchCsv to null, which makes it a no-op).
const hoisted = vi.hoisted(() => {
  const listeners = new Map();
  const batchCsv = {
    value: "",
    files: [],
    click: vi.fn(),
    addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
  };
  return {
    listeners,
    batchCsv,
    btnBatch: { disabled: false, addEventListener: vi.fn(), click: vi.fn() },
    batchStatus: { textContent: "" },
  };
});

vi.mock("../src/js/generator/generator.js", () => ({ generateQR: vi.fn(), renderOnce: vi.fn() }));
vi.mock("../src/js/generator/export.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, exportRenderedBlob: vi.fn(), downloadBlob: vi.fn() };
});
vi.mock("../src/js/ui/announce.js", () => ({ announce: vi.fn() }));
vi.mock("../src/js/ui/dom.js", () => ({
  DOM: {
    exportFormat: { value: "png" },
    batchStatus: hoisted.batchStatus,
    btnBatch: hoisted.btnBatch,
    batchCsv: hoisted.batchCsv,
  },
}));

import { initBatchExport } from "../src/js/generator/batch.js";
import { exportRenderedBlob, downloadBlob } from "../src/js/generator/export.js";
import { announce } from "../src/js/ui/announce.js";

/** Drive the file input's change handler with a fake File. */
function chooseFile(file) {
  hoisted.batchCsv.files = file ? [file] : [];
  hoisted.listeners.get("change")({ target: hoisted.batchCsv });
}

class StubFileReader {
  readAsText() {
    if (this.onload) this.onload({ target: { result: this.result } });
  }
}

describe("initBatchExport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hoisted.batchCsv.value = "chosen";
    hoisted.batchCsv.files = [];
    hoisted.listeners.clear();
    globalThis.FileReader = StubFileReader;
    exportRenderedBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    initBatchExport();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("wires the button to the hidden file input", () => {
    const clickHandler = hoisted.btnBatch.addEventListener.mock.calls.find(([type]) => type === "click")[1];
    clickHandler();
    expect(hoisted.batchCsv.click).toHaveBeenCalled();
  });

  it("parses the chosen CSV and exports one code per row", async () => {
    StubFileReader.prototype.result = "https://a.example\nhttps://b.example\n";
    chooseFile({ name: "codes.csv", type: "text/csv" });

    await vi.advanceTimersByTimeAsync(1000);

    expect(downloadBlob).toHaveBeenCalledTimes(2);
    // The input is reset so re-picking the same file fires change again.
    expect(hoisted.batchCsv.value).toBe("");
  });

  it("honours the TSV extension even when the MIME says text/plain", async () => {
    StubFileReader.prototype.result = "first\tignored\nsecond\tignored\n";
    chooseFile({ name: "codes.tsv", type: "text/plain" });

    await vi.advanceTimersByTimeAsync(1000);

    expect(downloadBlob).toHaveBeenNthCalledWith(1, expect.any(Blob), "first.png");
    expect(downloadBlob).toHaveBeenNthCalledWith(2, expect.any(Blob), "second.png");
  });

  it("treats a .txt file as one value per line", async () => {
    StubFileReader.prototype.result = "keep, this, whole\nsecond\n";
    chooseFile({ name: "codes.txt", type: "text/plain" });

    await vi.advanceTimersByTimeAsync(1000);

    // Commas stay part of the value (and of the filename: they are legal on
    // every platform the sanitizer targets).
    expect(downloadBlob).toHaveBeenNthCalledWith(1, expect.any(Blob), "keep, this, whole.png");
  });

  it("announces an empty file instead of exporting", async () => {
    StubFileReader.prototype.result = "\n\n";
    chooseFile({ name: "empty.csv", type: "text/csv" });

    await vi.advanceTimersByTimeAsync(1000);

    expect(downloadBlob).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(expect.stringContaining("rows"));
  });

  it("reports a read failure", async () => {
    class FailingReader {
      readAsText() {
        if (this.onerror) this.onerror(new Error("boom"));
      }
    }
    globalThis.FileReader = FailingReader;

    chooseFile({ name: "broken.csv", type: "text/csv" });

    expect(announce).toHaveBeenCalled();
    expect(hoisted.batchStatus.textContent).not.toBe("");
  });

  it("ignores an empty selection without throwing", () => {
    expect(() => chooseFile(null)).not.toThrow();
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
