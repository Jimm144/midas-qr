import { DOM } from "../ui/dom.js";
import { state, persistScannerHistory } from "../state";
import { t, getIntlLocale } from "../i18n.js";
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

// Official Lucide artwork (lucide-static, ISC) for the quiet delete action.
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="m6 7 1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';

function scanHistoryRow(item, idx) {
  const rawContent = item && typeof item.content === "string" ? item.content : "";
  const safeContent = escapeHTML(rawContent);
  const itemId = item != null ? item.id : null;
  const formattedTime = itemId != null ? formatHistoryTimestamp(itemId) : "";
  const safeTime = escapeHTML(formattedTime || (item != null && item.time != null ? String(item.time) : ""));
  const safeCopy = escapeHTML(t("common.copy"));
  const safeDelete = escapeHTML(t("common.delete"));
  return `
      <div class="history-item flex items-center justify-between p-2 border border-white text-xs gap-3" data-idx="${idx}">
        <span class="truncate max-w-[22ch]" title="${safeContent}">${safeContent}</span>
        <div class="history-row-actions text-inherit">
          <span class="text-[10px] text-inherit">${safeTime}</span>
          <button class="btn-copy-scan history-row-btn history-row-btn-label text-xs border border-current hover:bg-white hover:text-black transition-colors cursor-pointer" data-idx="${idx}">${safeCopy}</button>
          <button class="btn-delete-scan history-row-btn history-row-btn-icon border border-white hover:bg-red-500 hover:text-white transition-colors" data-idx="${idx}" title="${safeDelete}" aria-label="${safeDelete}">${ICON_TRASH}</button>
        </div>
      </div>
    `;
}

let scanHistoryListInstance = null;
let scanHistoryListLocale = null;

function getScanHistoryList() {
  const locale = getIntlLocale();
  if (scanHistoryListInstance && scanHistoryListLocale !== locale) {
    scanHistoryListInstance = null;
  }
  if (!scanHistoryListInstance) {
    scanHistoryListInstance = createUndoableList({
      container: () => DOM.historyList,
      getItems: () => state.scanner.history,
      setItems: (items) => {
        state.scanner.history = items;
      },
      renderRow: scanHistoryRow,
      emptyMarkup: `<p id="history-empty" class="history-empty">${escapeHTML(t("history.emptyScanned"))}</p>`,
      undoLabels: {
        remove: t("scanner.historyItemDeleted"),
        clear: t("scanner.historyCleared"),
      },
      persist: persistScannerHistory,
      onRender: (items) => {
        DOM.btnClearHistory.disabled = items.length === 0;
      },
    });
    scanHistoryListLocale = locale;
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
