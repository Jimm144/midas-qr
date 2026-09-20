import { DOM } from "../ui/dom.js";
import { state } from "../state";
import { generateQR, renderOnce } from "./generator.js";
import { exportRenderedBlob, downloadBlob, sanitizeFilename } from "./export.js";
import { announce } from "../ui/announce.js";

/**
 * Parse a CSV file (exported from Excel/Sheets, hence the optional UTF-8 BOM)
 * and return the first column of every non-empty data row. Delimiter-aware
 * (comma by default, tab for TSV); quoted fields with embedded delimiters,
 * quotes and newlines are supported.
 */
export function parseCsv(text, delimiter = ",") {
  if (typeof text !== "string") return [];
  const sep = typeof delimiter === "string" && delimiter !== "" ? delimiter : ",";
  const src = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      // Only a quote at the very start of a field opens a quoted field; a
      // stray quote inside unquoted data stays literal (RFC 4180).
      quoted = true;
    } else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => (r[0] || "").trim()).filter((v) => v !== "");
}

let batchBusy = false;

/** True while a batch export is running (guards UI re-entry). */
function isBatchExportRunning() {
  return batchBusy;
}

/**
 * Render every parsed data string and download one file per row.
 * Rows are streamed one at a time with live progress; a row that fails to
 * render/export is counted and skipped instead of aborting the whole run.
 */
export async function runBatchExport(values) {
  if (batchBusy || !values || values.length === 0) return 0;
  // One-off renders temporarily override dataType/dataString per row and put
  // them back before resolving; claim the busy flag first so a failure can
  // never strand it set.
  batchBusy = true;
  const ext = (DOM.exportFormat && DOM.exportFormat.value) || "png";
  const status = DOM.batchStatus;
  const setStatus = (text) => {
    if (status) status.textContent = text;
  };
  // Re-entry guard: the button is disabled for the whole run and the busy flag
  // rejects a second invocation even if the DOM is bypassed.
  const button = DOM.btnBatch;
  const buttonWasDisabled = button ? button.disabled : true;
  if (button) button.disabled = true;
  const total = values.length;
  let done = 0;
  let failed = 0;
  try {
    setStatus(`0/${total}`);
    announce(`Batch export started: ${total} codes — allow multiple downloads if your browser asks`);
    for (let i = 0; i < total; i++) {
      const value = values[i];
      try {
        // One-off render: the overrides are applied and restored by renderOnce,
        // so the live config is never clobbered mid-run.
        await renderOnce({ dataType: "text", dataString: value, isValid: true });
        // The live payload is restored before this resolves, so hand the
        // exporter the row's own payload/ECC for the TXT (Unicode) branch.
        const blob = await exportRenderedBlob(ext, null, { dataString: value, ecc: state.generator.ecc });
        if (!blob) throw new Error("render unavailable");
        downloadBlob(blob, `${sanitizeFilename(value, "qr")}.${ext}`);
        done++;
      } catch (err) {
        failed++;
        console.warn(`[QR] batch row ${i + 1} ("${value.slice(0, 40)}") failed:`, err);
      }
      setStatus(`${done + failed}/${total}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    announce(
      failed === 0
        ? `Batch export finished: ${done} of ${total} codes`
        : `Batch export finished: ${done} of ${total} codes (${failed} failed)`
    );
    setStatus(failed === 0 ? `Done: ${done}/${total}` : `Done: ${done}/${total} (${failed} failed)`);
    setTimeout(() => {
      if (!batchBusy && status && status.textContent.startsWith("Done")) {
        status.textContent = "";
      }
    }, 4000);
  } finally {
    // renderOnce restored the live config itself; just repaint the preview.
    generateQR(true);
    batchBusy = false;
    if (button) button.disabled = buttonWasDisabled;
  }
  return done;
}

/**
 * Parse a plain-text batch list: one value per line. Commas are data, not
 * separators, so unlike parseCsv each line is used whole.
 */
export function parseBatchLines(text) {
  if (typeof text !== "string") return [];
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|[\r\n\u2028\u2029]/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Pick the parser for a batch file: `.txt` (or text/plain) is one code per
 * line; `.tsv` (or text/tab-separated-values) is tab-delimited; everything
 * else goes through the comma CSV parser.
 */
export function parseBatchFile(text, filename = "", mime = "") {
  if (/\.txt$/i.test(filename) || mime === "text/plain") return parseBatchLines(text);
  if (/\.tsv$/i.test(filename) || mime === "text/tab-separated-values") return parseCsv(text, "\t");
  return parseCsv(text);
}

export function initBatchExport() {
  if (!DOM.btnBatch || !DOM.batchCsv) return;
  DOM.btnBatch.addEventListener("click", () => DOM.batchCsv.click());
  DOM.batchCsv.addEventListener("change", (e) => {
    const file = e.target.files[0];
    DOM.batchCsv.value = "";
    if (!file) return;
    const reader = new FileReader();
    // readAsText with an explicit encoding keeps accents/CJK from a UTF-8
    // CSV/TXT intact; the BOM (Excel) is stripped by the parsers.
    reader.onload = (event) => {
      if (isBatchExportRunning()) {
        announce("A batch export is already running");
        return;
      }
      const values = parseBatchFile(event.target.result, file.name, file.type);
      if (values.length === 0) {
        if (DOM.batchStatus) {
          DOM.batchStatus.textContent = "No rows in file";
          setTimeout(() => {
            if (
              !isBatchExportRunning() &&
              DOM.batchStatus &&
              DOM.batchStatus.textContent === "No rows in file"
            ) {
              DOM.batchStatus.textContent = "";
            }
          }, 3000);
        }
        announce("No data rows found in that file");
        return;
      }
      runBatchExport(values);
    };
    reader.onerror = (err) => {
      console.error("[QR] batch file read failed:", err);
      if (DOM.batchStatus) {
        DOM.batchStatus.textContent = "Couldn't read file";
        setTimeout(() => {
          if (
            !isBatchExportRunning() &&
            DOM.batchStatus &&
            DOM.batchStatus.textContent === "Couldn't read file"
          ) {
            DOM.batchStatus.textContent = "";
          }
        }, 3000);
      }
      announce("Could not read that file");
    };
    reader.readAsText(file, "utf-8");
  });
}
