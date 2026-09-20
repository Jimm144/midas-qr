import { DOM } from "../ui/dom.js";
import { state, persistAppState, sanitizeGeneratorConfig, repairLowVisibilityColors } from "../state";
import { generateQR, syncConfigToUI, renderOnce } from "./generator.js";
import { exportRenderedBlob, downloadBlob } from "./export.js";
import { escapeHTML, snapshot, HEX_COLOR_RE } from "../utils.js";
import { ALLOWED_SHAPES } from "../constants.js";
import { parseGradient, gradientStops, diagonalSpan, linearEndpoints } from "./gradient.js";
import { applyGeneratorFields } from "../state";
import { showUndoToast } from "../ui/toast.js";
import { createUndoableList } from "../ui/undoable-list.js";
import { announce } from "../ui/announce.js";

export function saveGeneratorHistory() {
  if (!persistAppState(false)) {
    const before = state.generatorHistory.length;
    const snapshot = state.generatorHistory.slice();
    state.generatorHistory = state.generatorHistory.filter((item) => {
      const config = item && item.config && typeof item.config === "object" ? item.config : undefined;
      const tooBig = (image) => typeof image === "string" && image.length >= 64 * 1024;
      return config ? !tooBig(config.logoDataUrl) && !tooBig(config.bgImageDataUrl) : true;
    });
    if (state.generatorHistory.length !== before) {
      const trimmedCount = before - state.generatorHistory.length;
      console.warn(
        `[history] Removed ${trimmedCount} large-image history item(s) to stay under the storage limit.`
      );
      persistAppState(false);
      renderGeneratorHistory();
      showUndoToast("HISTORY TRIMMED — LARGE IMAGES REMOVED", () => {
        state.generatorHistory = snapshot;
        renderGeneratorHistory();
      });
    }
  }
}

let previewSeq = 0;

/** One preview gradient def; null when the spec is unusable. */
function previewGradient(id, spec, baseColor) {
  const parsed = parseGradient(spec);
  if (!parsed) return null;
  const stops = gradientStops(baseColor, parsed.color2)
    .map(({ offset, color }) => `<stop offset="${offset}" stop-color="${color}"/>`)
    .join("");
  if (parsed.type === "radial") {
    return {
      paint: `url(#${id})`,
      def: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="12" cy="12" r="17">${stops}</radialGradient>`,
    };
  }
  const len = diagonalSpan(24, 24, parsed.rotation);
  const { x1, y1, x2, y2 } = linearEndpoints(12, 12, len, parsed.rotation);
  const n = (value) => Number(value.toFixed(2));
  return {
    paint: `url(#${id})`,
    def: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}">${stops}</linearGradient>`,
  };
}

/** Miniature body/corner glyph for one shape, drawn at the requested size. */
function previewGlyph(shape, x, y, size, fill) {
  if (shape === "dot" || shape === "dots") {
    return `<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="${fill}"/>`;
  }
  const rx =
    shape === "extra-rounded"
      ? size * 0.45
      : shape === "classy-rounded"
        ? size * 0.38
        : shape === "classy"
          ? size * 0.28
          : shape === "rounded"
            ? size * 0.2
            : size * 0.06;
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${Number(rx.toFixed(2))}" fill="${fill}"/>`;
}

/**
 * One finder eye: the outer shape in the corner colour and the inner shape in
 * the corner-dot colour — two shapes, readable at thumbnail size.
 */
function previewFinder(x, y, outerShape, innerShape, outerPaint, innerPaint) {
  return (
    previewGlyph(outerShape, x, y, 7, outerPaint) + previewGlyph(innerShape, x + 2, y + 2, 3, innerPaint)
  );
}

/**
 * Mini design preview for a saved config: the chosen colours, shapes, gradients
 * and overall mask — deliberately never the whole QR code.
 */
function designPreview(config) {
  const source =
    config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const hex = (value, fallback) =>
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const shape = (value, fallback) =>
    typeof value === "string" && ALLOWED_SHAPES.includes(value) ? value : fallback;
  const bg = hex(source.bgColor, "#ffffff");
  const dots = hex(source.dotsColor, "#000000");
  const cornerSquare = hex(source.cornersSquareColor, "#000000");
  const cornerDot = hex(source.cornersDotColor, "#000000");
  const body = shape(source.shapeBody, "square");
  const outer = shape(source.shapeOuter, "square");
  const inner = shape(source.shapeInner, "square");
  const transparent = Boolean(source.bgTransparent);

  const prefix = `hp${++previewSeq}`;
  const defs = [];
  const resolve = (name, base, spec) => {
    const gradient = previewGradient(`${prefix}-${name}`, spec, base);
    if (gradient) {
      defs.push(gradient.def);
      return gradient.paint;
    }
    return base;
  };
  const bgPaint = transparent ? "" : resolve("bg", bg, source.bgGradient);
  const dotsPaint = resolve("dots", dots, source.dotsGradient);
  const cornerSquarePaint = resolve("cs", cornerSquare, source.cornersSquareGradient);
  const cornerDotPaint = resolve("cd", cornerDot, source.cornersDotGradient);

  const bgRect = transparent ? "" : `<rect width="24" height="24" fill="${bgPaint}"/>`;
  const content =
    `<g>` +
    previewFinder(1, 1, outer, inner, cornerSquarePaint, cornerDotPaint) +
    previewFinder(16, 1, outer, inner, cornerSquarePaint, cornerDotPaint) +
    previewFinder(1, 16, outer, inner, cornerSquarePaint, cornerDotPaint) +
    [10, 15, 20]
      .flatMap((x) => [10, 15, 20].map((y) => previewGlyph(body, x, y, 4, dotsPaint)))
      .join("") +
    `</g>`;

  return (
    `<span class="history-preview" aria-hidden="true"><svg viewBox="0 0 24 24">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    bgRect +
    content +
    `</svg></span>`
  );
}

function generatorHistoryRow(item, idx) {
  const config =
    item && item.config && typeof item.config === "object" && !Array.isArray(item.config)
      ? item.config
      : {};
  const rawContent = config.dataString == null ? "" : String(config.dataString);
  const safeContent = escapeHTML(rawContent || "EMPTY");
  const safeTime = escapeHTML(item && item.time != null ? String(item.time) : "");
  return `
      <div class="history-item flex items-center justify-between p-2 border border-white text-xs gap-3" data-idx="${idx}">
        ${designPreview(config)}
        <div class="flex-1 overflow-hidden">
          <p class="font-bold truncate text-white" title="${safeContent}">${safeContent}</p>
          <p class="text-[10px] opacity-70">${safeTime}</p>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0 text-inherit">
          <button class="btn-load-history border border-white hover:bg-white hover:text-black w-16 h-7 flex items-center justify-center transition-colors font-medium text-inherit" data-idx="${idx}">Load</button>
          <button class="btn-export-history border border-white hover:bg-white hover:text-black w-16 h-7 flex items-center justify-center transition-colors font-medium text-inherit" data-idx="${idx}" title="Download this QR code" aria-label="Export">Export</button>
          <button class="btn-delete-generator-history border border-white hover:bg-red-500 hover:text-white transition-colors flex-shrink-0 w-16 h-7 flex items-center justify-center text-xs" data-idx="${idx}" title="Delete" aria-label="Delete">✕</button>
        </div>
      </div>
    `;
}

let generatorHistoryListInstance = null;

// Last list fingerprint seen by onRender. Delete/clear/undo mutate the list
// and re-render it without any other render pass, so the Save button's
// saved/unsaved label would stay stale; the signature keeps plain repaints
// from kicking off a full render while changed lists re-evaluate it.
let lastHistorySignature = null;

/** Cheap id fingerprint of the history list. */
function historySignature(items) {
  return (items || []).map((item) => (item && item.id != null ? item.id : "?")).join("\u0001");
}

function getGeneratorHistoryList() {
  if (!generatorHistoryListInstance) {
    generatorHistoryListInstance = createUndoableList({
      container: () => DOM.generatorHistoryList,
      getItems: () => state.generatorHistory,
      setItems: (items) => {
        state.generatorHistory = items;
      },
      renderRow: generatorHistoryRow,
      emptyMarkup: '<p class="history-empty">No saved codes yet.</p>',
      undoLabels: { remove: "HISTORY ITEM DELETED", clear: "HISTORY CLEARED" },
      persist: () => saveGeneratorHistory(),
      onRender: (items) => {
        const hasItems = items.length > 0;
        if (DOM.btnClearGeneratorHistory) DOM.btnClearGeneratorHistory.disabled = !hasItems;
        if (DOM.btnExportHistoryAll) DOM.btnExportHistoryAll.disabled = !hasItems;
        const signature = historySignature(items);
        if (signature !== lastHistorySignature) {
          lastHistorySignature = signature;
          generateQR(true);
        }
      },
    });
  }
  return generatorHistoryListInstance;
}

export function renderGeneratorHistory() {
  getGeneratorHistoryList().render();
}

/**
 * Read one gradient field from a saved config with local validation: loading a
 * saved code must neither lose its gradient nor leave the live session's
 * gradient bleeding into a saved solid config. `null` means "explicitly none".
 */
function readFrameGradient(rawConfig, key = "frameGradient") {
  const value = rawConfig && rawConfig[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const { type, rotation, color2 } = value;
  if (
    (type === "linear" || type === "radial") &&
    typeof rotation === "number" &&
    Number.isFinite(rotation) &&
    rotation >= 0 &&
    rotation <= 360 &&
    typeof color2 === "string" &&
    HEX_COLOR_RE.test(color2)
  ) {
    return { type, rotation, color2 };
  }
  return null;
}

/**
 * Apply a saved/history config to the live state. `sanitizeGeneratorConfig`
 * keeps valid gradient objects, but a config that predates a gradient field
 * (or stores a malformed one) must still clear the live value instead of
 * inheriting it, so both frame gradient fields are resolved explicitly.
 */
function applyHistoryConfig(rawConfig) {
  const raw = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig) ? rawConfig : {};
  Object.assign(state.generator, sanitizeGeneratorConfig(raw));
  state.generator.frameGradient = readFrameGradient(raw);
  state.generator.frameTextGradient = readFrameGradient(raw, "frameTextGradient");
  repairLowVisibilityColors(state.generator);
  return raw;
}

let generatorHistoryInitialized = false;

export function initGeneratorHistory() {
  // Idempotent: stacked delegation would run delete/load/export twice, which
  // is exactly the double-fire class of bug this list used to have.
  if (generatorHistoryInitialized) return;
  generatorHistoryInitialized = true;
  if (DOM.generatorHistoryList) {
    DOM.generatorHistoryList.addEventListener("click", (e) => {
      if (!(e.target instanceof Element)) return;
      const btnLoad = e.target.closest(".btn-load-history");
      const btnDelete = e.target.closest(".btn-delete-generator-history");
      const btnExport = e.target.closest(".btn-export-history");

      if (btnExport) {
        const idx = parseInt(btnExport.getAttribute("data-idx"), 10);
        if (!isNaN(idx)) exportHistoryItem(idx, btnExport);
        return;
      }

      if (btnDelete) {
        const idx = parseInt(btnDelete.getAttribute("data-idx"), 10);
        if (!isNaN(idx)) getGeneratorHistoryList().removeAt(idx);
        return;
      }

      if (btnLoad) {
        const idx = parseInt(btnLoad.getAttribute("data-idx"), 10);
        if (isNaN(idx)) return;
        const item = state.generatorHistory[idx];
        if (item) {
          const rawConfig = applyHistoryConfig(item.config);
          const config = sanitizeGeneratorConfig(rawConfig);
          // Repopulate the raw form fields when the snapshot carried them so
          // the recompiles below don't blank out the payload.
          applyGeneratorFields(config.fields);
          syncConfigToUI();
          // syncConfigToUI dispatches change events that recompile from the
          // form fields; restore the saved payload as the source of truth so
          // the rebuilt QR matches the history entry.
          state.generator.dataString = typeof config.dataString === "string" ? config.dataString : "";
          state.generator.isValid = config.isValid !== false;
          generateQR();
          announce("Config loaded from history");
        }
      }
    });
  }

  if (DOM.btnClearGeneratorHistory) {
    DOM.btnClearGeneratorHistory.addEventListener("click", () => {
      getGeneratorHistoryList().clear();
    });
  }

  if (DOM.btnExportHistoryAll) {
    DOM.btnExportHistoryAll.addEventListener("click", () => {
      exportHistoryBatch().catch((e) => console.error("[history] batch export failed:", e));
    });
  }
}

/** Gap between batch downloads so browsers don't drop back-to-back saves. */
const BATCH_EXPORT_GAP_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Download every saved config as its own PNG, newest first, with a short gap
 * between files (no zip: no archive library ships in this offline bundle).
 * Single-flight with the per-item export so renders never interleave.
 */
async function exportHistoryBatch() {
  if (historyExportBusy || state.generatorHistory.length === 0) return;
  historyExportBusy = true;
  const btn = DOM.btnExportHistoryAll;
  const label = btn ? btn.textContent : "";
  if (btn) {
    btn.textContent = "Exporting…";
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  }
  let downloaded = 0;
  try {
    // Snapshot the order, but re-check every entry against the live list so an
    // item deleted mid-export is skipped rather than exported from a stale copy.
    const items = state.generatorHistory.slice();
    for (let i = 0; i < items.length; i++) {
      if (!state.generatorHistory.includes(items[i])) continue;
      const blob = await exportHistoryConfigPng(items[i]);
      // Re-check after the async render: don't ship a file for an entry the
      // user deleted while it was being prepared.
      if (!blob || !state.generatorHistory.includes(items[i])) continue;
      downloadBlob(blob, `qr-code-${items[i].id || Date.now()}.png`);
      downloaded++;
      if (i < items.length - 1) await sleep(BATCH_EXPORT_GAP_MS);
    }
    announce(`Downloaded ${downloaded} codes`);
  } finally {
    if (btn) {
      btn.textContent = label;
      btn.disabled = state.generatorHistory.length === 0;
      btn.removeAttribute("aria-busy");
    }
    historyExportBusy = false;
  }
}

let historyExportBusy = false;

/**
 * Render one saved config and return its PNG blob. The config is sanitized
 * onto an override set, then rendered through renderOnce — the live config is
 * never overwritten and completion is awaited instead of polled.
 * Shared by the per-item button and the batch handler.
 */
export async function exportHistoryConfigPng(item) {
  if (!item || !item.config || typeof item.config !== "object") return null;
  const restore = snapshot(state.generator);
  let overrides;
  try {
    // Same coherence as the Load button: absent/malformed gradients clear the
    // live values instead of bleeding into the exported file.
    applyHistoryConfig(item.config);
    overrides = snapshot(state.generator);
  } finally {
    Object.assign(state.generator, restore);
  }
  try {
    await renderOnce(overrides);
  } catch {
    return null;
  }
  try {
    return await exportRenderedBlob("png", null, {
      dataString: overrides.dataString,
      ecc: overrides.ecc,
      bgTransparent: overrides.bgTransparent,
      bgColor: overrides.bgColor,
    });
  } finally {
    // The exported render is still published; repaint the live preview.
    generateQR(true);
  }
}

/** Export one saved config from the list, with per-button busy feedback. */
async function exportHistoryItem(idx, btn) {
  const item = state.generatorHistory[idx];
  if (!item || !item.config || typeof item.config !== "object" || historyExportBusy) return;
  historyExportBusy = true;
  const label = btn ? btn.textContent : null;
  if (btn) {
    btn.textContent = "…";
    btn.disabled = true;
  }
  try {
    const blob = await exportHistoryConfigPng(item);
    if (blob) {
      downloadBlob(blob, `qr-code-${item.id || Date.now()}.png`);
      announce("QR code downloaded from history");
    } else {
      announce("Could not export that saved code");
    }
  } finally {
    if (btn) {
      btn.textContent = label;
      btn.disabled = false;
    }
    historyExportBusy = false;
  }
}
