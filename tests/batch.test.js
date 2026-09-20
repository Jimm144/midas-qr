import { describe, it, expect, vi, beforeEach } from "vitest";
import { state } from "../src/js/state";

vi.mock("../src/js/generator/generator.js", () => ({ generateQR: vi.fn(), renderOnce: vi.fn() }));
vi.mock("../src/js/generator/export.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, exportRenderedBlob: vi.fn(), downloadBlob: vi.fn() };
});
vi.mock("../src/js/ui/announce.js", () => ({ announce: vi.fn() }));
vi.mock("../src/js/ui/dom.js", () => ({
  DOM: {
    exportFormat: { value: "png" },
    batchStatus: { textContent: "" },
    btnBatch: { disabled: false },
    batchCsv: null,
  },
}));

import { parseBatchFile, parseBatchLines, parseCsv, runBatchExport } from "../src/js/generator/batch.js";
import { generateQR, renderOnce } from "../src/js/generator/generator.js";
import { exportRenderedBlob, downloadBlob } from "../src/js/generator/export.js";
import { announce } from "../src/js/ui/announce.js";
import { DOM } from "../src/js/ui/dom.js";

describe("parseCsv (batch data export)", () => {
  it("takes the first column of every non-empty row", () => {
    expect(parseCsv("https://a.example\nhttps://b.example\n")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(parseCsv("a,ignored\n\n b ,ignored\n")).toEqual(["a", "b"]);
  });

  it("strips a UTF-8 BOM (Excel exports) and keeps non-ASCII data intact", () => {
    expect(parseCsv("\uFEFFcafé München\n東京\n")).toEqual(["café München", "東京"]);
  });

  it("handles quoted fields with commas, quotes and newlines", () => {
    expect(parseCsv('"Hello, world","x"\n"say ""hi""","y"\n')).toEqual(['Hello, world', 'say "hi"']);
    expect(parseCsv('"line1\nline2",x\n')).toEqual(["line1\nline2"]);
  });

  it("supports CRLF line endings", () => {
    expect(parseCsv("one\r\ntwo\r\n")).toEqual(["one", "two"]);
  });

  it("keeps stray quotes inside unquoted fields literal", () => {
    expect(parseCsv('say "hi",x\n')).toEqual(['say "hi"']);
    expect(parseCsv('a"b"c,ignored\n')).toEqual(['a"b"c']);
  });

  it("splits rows on Unicode line and paragraph separators", () => {
    expect(parseCsv("a\u2028b\u2029c")).toEqual(["a", "b", "c"]);
    expect(parseCsv('"keep\u2028this",x\nnext')).toEqual(["keep\u2028this", "next"]);
  });

  it("skips rows whose first (data) column is missing or empty", () => {
    expect(parseCsv(",,\nvalue,other\n")).toEqual(["value"]);
    expect(parseCsv("   ,x\n\t\n")).toEqual([]);
  });

  it("returns an empty list for empty or non-string input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
    expect(parseCsv(null)).toEqual([]);
  });
});

describe("parseBatchLines (TXT batch data)", () => {
  it("takes one whole line per code, keeping commas as data", () => {
    expect(parseBatchLines("https://a.example\nsay, hi\nhttps://b.example\n")).toEqual([
      "https://a.example",
      "say, hi",
      "https://b.example",
    ]);
  });

  it("trims lines, drops blanks and strips a UTF-8 BOM", () => {
    expect(parseBatchLines("\uFEFF  one  \n\n   \n\ttwo\t\r\n")).toEqual(["one", "two"]);
  });

  it("splits on unicode line separators and returns [] for non-strings", () => {
    expect(parseBatchLines("a\u2028b\u2029c")).toEqual(["a", "b", "c"]);
    expect(parseBatchLines("")).toEqual([]);
    expect(parseBatchLines(null)).toEqual([]);
  });
});

describe("parseBatchFile dispatch", () => {
  it("uses line parsing for .txt (by name or MIME)", () => {
    expect(parseBatchFile("a,b\nc", "list.txt")).toEqual(["a,b", "c"]);
    expect(parseBatchFile("a,b\nc", "anything", "text/plain")).toEqual(["a,b", "c"]);
  });

  it("uses tab parsing for .tsv (by name or MIME)", () => {
    expect(parseBatchFile("a,b\tignored\nc\td", "list.tsv")).toEqual(["a,b", "c"]);
    expect(parseBatchFile('"a\tb"\tc', "anything", "text/tab-separated-values")).toEqual(["a\tb"]);
  });

  it("uses comma CSV for everything else", () => {
    expect(parseBatchFile("a,b\nc", "list.csv")).toEqual(["a", "c"]);
    expect(parseBatchFile('"a,b"\nc', "list.csv", "text/csv")).toEqual(["a,b", "c"]);
  });
});

describe("runBatchExport progress and failure isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    DOM.btnBatch.disabled = false;
    exportRenderedBlob.mockResolvedValue(new Blob(["x"]));
    // Mimic the real renderOnce: apply overrides, hand back a result, and
    // restore the live config before resolving.
    renderOnce.mockImplementation(async (overrides = {}) => {
      const saved = {};
      for (const key of Object.keys(overrides)) {
        saved[key] = state.generator[key];
        state.generator[key] = overrides[key];
      }
      Object.assign(state.generator, saved);
      return { svg: "<svg/>" };
    });
  });

  it("keeps exporting after a row fails and re-enables the button", async () => {
    exportRenderedBlob
      .mockResolvedValueOnce(new Blob(["a"]))
      .mockRejectedValueOnce(new Error("row failed"))
      .mockResolvedValueOnce(new Blob(["c"]));

    const done = await runBatchExport(["one", "two", "three"]);

    expect(done).toBe(2);
    expect(exportRenderedBlob).toHaveBeenCalledTimes(3);
    expect(downloadBlob).toHaveBeenCalledTimes(2);
    expect(DOM.btnBatch.disabled).toBe(false);
    expect(announce).toHaveBeenCalledWith(expect.stringContaining("2 of 3"));
    expect(announce).toHaveBeenCalledWith(expect.stringContaining("1 failed"));
  });

  it("restores the live generator payload after the run", async () => {
    const { state } = await import("../src/js/state");
    state.generator.dataType = "url";
    state.generator.dataString = "https://live.example";
    state.generator.isValid = true;

    const done = await runBatchExport(["one"]);

    expect(done).toBe(1);
    expect(state.generator.dataType).toBe("url");
    expect(state.generator.dataString).toBe("https://live.example");
    expect(generateQR).toHaveBeenCalled();
  });

  it("passes each row's payload and ECC to the exporter", async () => {
    state.generator.ecc = "H";

    await runBatchExport(["row-value"]);

    expect(exportRenderedBlob).toHaveBeenCalledWith("png", null, { dataString: "row-value", ecc: "H" });
  });

  it("sanitizes each batch filename with the shared filename sanitizer", async () => {
    await runBatchExport(["../evil/na:me?x", "CON"]);

    expect(downloadBlob).toHaveBeenNthCalledWith(1, expect.any(Blob), "evil-na-me-x.png");
    expect(downloadBlob).toHaveBeenNthCalledWith(2, expect.any(Blob), "CON-qr.png");
  });

  it("rejects re-entry while a run is in flight and restores the button", async () => {
    let release;
    exportRenderedBlob.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    const first = runBatchExport(["a"]);
    expect(DOM.btnBatch.disabled).toBe(true);
    const second = await runBatchExport(["b"]);
    expect(second).toBe(0);

    release(new Blob(["x"]));
    await first;
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(DOM.btnBatch.disabled).toBe(false);
  });
});
