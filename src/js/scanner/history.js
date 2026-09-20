import { DOM } from "../ui/dom.js";
import { state, persistScannerHistory } from "../state";
import { escapeHTML, formatHistoryTimestamp } from "../utils.js";
import { MAX_SCAN_HISTORY } from "../constants.js";
import { createUndoableList } from "../ui/undoable-list.js";

export function getSafeHttpUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch (_err) {
    return null;
  }
  return null;
}

function scanHistoryRow(item, idx) {
  const rawContent = item && typeof item.content === "string" ? item.content : "";
  const safeContent = escapeHTML(rawContent);
  const safeTime = escapeHTML(item && item.time != null ? String(item.time) : "");
  return `
      <div class="history-item flex items-center justify-between p-2 border border-white text-xs gap-3" data-idx="${idx}">
        <span class="truncate max-w-[22ch]" title="${safeContent}">${safeContent}</span>
        <div class="flex items-center gap-2 flex-shrink-0 text-inherit">
          <span class="text-[10px] text-inherit">${safeTime}</span>
          <button class="btn-copy-scan text-xs h-7 w-16 flex items-center justify-center border border-current hover:bg-white hover:text-black transition-colors cursor-pointer" data-idx="${idx}">Copy</button>
          <button class="btn-delete-scan w-16 h-7 flex items-center justify-center border border-white hover:bg-red-500 hover:text-white transition-colors flex-shrink-0 text-xs" data-idx="${idx}" title="Delete" aria-label="Delete">✕</button>
        </div>
      </div>
    `;
}

let scanHistoryListInstance = null;

function getScanHistoryList() {
  if (!scanHistoryListInstance) {
    scanHistoryListInstance = createUndoableList({
      container: () => DOM.historyList,
      getItems: () => state.scanner.history,
      setItems: (items) => {
        state.scanner.history = items;
      },
      renderRow: scanHistoryRow,
      emptyMarkup: '<p id="history-empty" class="history-empty">No scans yet.</p>',
      undoLabels: { remove: "SCAN ITEM DELETED", clear: "SCAN HISTORY CLEARED" },
      persist: persistScannerHistory,
      onRender: (items) => {
        DOM.btnClearHistory.disabled = items.length === 0;
      },
    });
  }
  return scanHistoryListInstance;
}

export function renderHistoryList() {
  getScanHistoryList().render();
}

export function removeScanHistoryAt(idx) {
  getScanHistoryList().removeAt(idx);
}

export function clearScanHistory() {
  return getScanHistoryList().clear();
}

export function addToScanHistory(content) {
  if (typeof content !== "string" || content === "") return;
  const newest = state.scanner.history[0];
  if (newest && newest.content === content) return;
  const timestamp = Date.now();
  const dateStr = formatHistoryTimestamp(timestamp);

  state.scanner.history.unshift({
    id: timestamp,
    content: content,
    time: dateStr,
  });

  if (state.scanner.history.length > MAX_SCAN_HISTORY) state.scanner.history.pop();
  if (!persistScannerHistory()) {
    console.warn("[QR] scan history persist failed (likely quota).");
    // Drop the oldest entry and try once more so the latest scan survives.
    if (state.scanner.history.length > 1) state.scanner.history.pop();
    persistScannerHistory();
  }
  renderHistoryList();
}
