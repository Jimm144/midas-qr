import { DOM } from "../ui/dom.js";
import { state, persistAppState, sanitizeGeneratorConfig, repairLowVisibilityColors } from "../state";
import { generateQR, syncConfigToUI, renderOnce } from "./generator.js";
import { exportRenderedBlob, downloadBlob, sanitizeFilename } from "./export.js";
import { escapeHTML, snapshot, HEX_COLOR_RE, formatHistoryTimestamp } from "../utils.js";
import { ALLOWED_SHAPES } from "../constants.js";
import { parseGradient, gradientStops, diagonalSpan, linearEndpoints } from "./gradient.js";
import { applyGeneratorFields } from "../state";
import { showUndoToast } from "../ui/toast.js";
import { createUndoableList } from "../ui/undoable-list.js";
import { announce } from "../ui/announce.js";
import { t } from "../i18n.js";

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
      showUndoToast(t("history.trimmed"), () => {
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

/** Corner radius for a shape, as a fraction of its size. */
function shapeRadius(shape, size) {
  const factor =
    shape === "extra-rounded"
      ? 0.45
      : shape === "classy-rounded"
        ? 0.38
        : shape === "classy"
          ? 0.28
          : shape === "rounded"
            ? 0.2
            : 0.06;
  return Number((size * factor).toFixed(2));
}

/** Solid module glyph, used for the body block and a finder's centre. */
function previewBlock(shape, x, y, size, fill) {
  if (shape === "dot" || shape === "dots") {
    return `<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="${fill}"/>`;
  }
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${shapeRadius(shape, size)}" fill="${fill}"/>`;
}

/**
 * One finder pattern as a ring plus its centre — the shape a scanner actually
 * looks for. Drawn as a stroke rather than a solid block: with the two corner
 * colours usually identical, a solid outer block under a solid centre collapsed
 * into one plain square and the tile stopped reading as a QR.
 *
 * Ring, gap and centre follow the real 1/1/3 module proportions, or the two
 * inner parts merge into a blob at 40px.
 */
function previewRing(shape, x, y, size, stroke) {
  if (shape === "dot" || shape === "dots") {
    return `<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="none" stroke="${stroke}" stroke-width="1"/>`;
  }
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${shapeRadius(shape, size)}" fill="none" stroke="${stroke}" stroke-width="1"/>`;
}

/**
 * Design thumbnail for a saved config: four shapes — the three finder patterns
 * and one body block — in the saved colours, shapes and gradients.
 *
 * The earlier tile drew thirteen glyphs (three finders plus a 3x3 dot grid) and
 * read as a face at 40px. Four shapes is what a QR needs to be recognisable at a
 * glance, and nothing more: the overall mask is deliberately ignored so the tile
 * keeps its own square, and the shapes keep a quiet zone so nothing crowds the
 * tile edge.
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

  // 24-unit tile: a 3-unit quiet zone, three 7-unit finders (1-unit ring, 1-unit
  // gap, 3-unit centre) and the body block filling the fourth quadrant at the
  // same 7 units, so the four shapes read as one 2x2 grid.
  const FINDER = 7;
  const CENTRE = 3;
  const OFFSET = (FINDER - CENTRE) / 2;
  const finder = (x, y) =>
    previewRing(outer, x, y, FINDER, cornerSquarePaint) +
    previewBlock(inner, x + OFFSET, y + OFFSET, CENTRE, cornerDotPaint);

  return (
    `<span class="history-preview" aria-hidden="true"><svg viewBox="0 0 24 24">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    (bgPaint ? `<rect width="24" height="24" fill="${bgPaint}"/>` : "") +
    finder(3, 3) +
    finder(14, 3) +
    finder(3, 14) +
    previewBlock(body, 14, 14, FINDER, dotsPaint) +
    `</svg></span>`
  );
}

// Official Lucide artwork (lucide-static, ISC) for the two quiet row actions.
const ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="m6 7 1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';

/** Data type -> the label key that names it in every catalog. */
const TYPE_LABEL_KEYS = {
  url: "data.url",
  text: "data.text",
  wifi: "data.wifi",
  contact: "data.contact",
  crypto: "data.crypto",
  geo: "data.geolocation",
  event: "data.event",
  sms: "data.sms",
  phone: "data.phone",
  email: "data.email",
};

/** Field ids that best identify a payload, per data type. */
const TYPE_DETAIL_FIELDS = {
  url: ["input-url"],
  text: ["input-text"],
  wifi: ["wifi-ssid"],
  contact: ["contact-first", "contact-last", "contact-org", "contact-email"],
  crypto: ["crypto-coin", "crypto-address"],
  geo: ["geo-lat", "geo-lon"],
  event: ["event-title", "event-location"],
  sms: ["sms-phone", "sms-msg"],
  phone: ["phone-number"],
  email: ["email-to", "email-subject"],
};

/** Trim a payload fragment to something a row can show. */
function clipDetail(value, max = 48) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Host of a URL, without the scheme and any trailing slash. */
function hostOf(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw || /\s/.test(raw)) return "";
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  // Only real URLs: "12345" and "hello" are not hostnames to be salvaged.
  if (!hasScheme && !/^www\./i.test(raw)) return "";
  try {
    const host = new URL(hasScheme ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
    // A numeric host normalises into an IP form ("12345" -> "0.0.48.57"),
    // which is a worse name than the text it came from.
    return !host || /^[0-9.]+$/.test(host) ? "" : host;
  } catch {
    return "";
  }
}

/**
 * Name a saved design the way a person would: the payload's most identifying
 * field (host, SSID, contact name, address) as the title, the data type as the
 * quiet meta line. Raw payloads made poor titles — a saved URL showed as a
 * 60-character string and a short text code as a stray character.
 *
 * @param {Record<string, unknown>} config sanitized history config
 * @returns {{ title: string, meta: string }}
 */
export function historyEntryName(config) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const type = typeof source.dataType === "string" ? source.dataType : "text";
  const meta = t(TYPE_LABEL_KEYS[type] || "data.text");
  const fields =
    source.fields && typeof source.fields === "object" && !Array.isArray(source.fields) ? source.fields : {};
  const read = (id) => {
    const value = fields[id];
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  };

  let detail = "";
  if (type === "url") {
    const url = read("input-url");
    detail = hostOf(url) || clipDetail(url);
  } else {
    for (const id of TYPE_DETAIL_FIELDS[type] || []) {
      const part = clipDetail(read(id));
      if (part) {
        detail = part;
        break;
      }
    }
  }
  // Entries saved before the field bag existed have no per-type field to read,
  // so fall back to the payload — as a host when it is a URL, since
  // "https://example.com/a/very/long/path" is nobody's idea of a name.
  if (!detail) {
    detail = hostOf(source.dataString) || clipDetail(source.dataString, 40);
  }

  return { title: detail || t("history.emptyValue"), meta };
}

/** Filesystem-safe name for a downloaded code: the row title, slugged. */
function downloadName(config) {
  const { title } = historyEntryName(config);
  const slug = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  // sanitizeFilename dodges Windows device names ("nul.png" is silently
  // refused by the OS) and is the same guard the Download button uses.
  return `${sanitizeFilename(slug, "qr-code")}.png`;
}

function generatorHistoryRow(item, idx) {
  const config =
    item && item.config && typeof item.config === "object" && !Array.isArray(item.config)
      ? item.config
      : {};
  const rawContent = config.dataString == null ? "" : String(config.dataString);
  const safeContent = escapeHTML(rawContent || t("history.emptyValue"));
  // Re-derive from the id with the *current* locale, like the scanner list:
  // the stored string was formatted in whichever language was active at save
  // time, so a language switch left the two lists disagreeing.
  const derivedTime =
    item && item.id != null ? formatHistoryTimestamp(item.id) : "";
  const safeTime = escapeHTML(
    derivedTime || (item && item.time != null ? String(item.time) : "")
  );
  const loadLabel = escapeHTML(t("common.load"));
  const exportLabel = escapeHTML(t("common.export"));
  const deleteLabel = escapeHTML(t("common.delete"));
  const downloadLabel = escapeHTML(t("history.downloadAria"));
  const { title, meta } = historyEntryName(config);
  const safeTitle = escapeHTML(title);
  const safeMeta = escapeHTML(safeTime ? `${meta} · ${safeTime}` : meta);
  return `
      <div class="history-item flex items-center justify-between p-2 border border-white text-xs gap-3" data-idx="${idx}">
        ${designPreview(config)}
        <div class="flex-1 overflow-hidden">
          <p class="font-bold truncate text-white" title="${safeContent}">${safeTitle}</p>
          <p class="text-[10px] opacity-70 truncate">${safeMeta}</p>
        </div>
        <div class="history-row-actions">
          <button class="btn-load-history history-row-btn history-row-btn-label" data-idx="${idx}">${loadLabel}</button>
          <button class="btn-export-history history-row-btn history-row-btn-icon" data-idx="${idx}" title="${downloadLabel}" aria-label="${exportLabel}">${ICON_DOWNLOAD}</button>
          <button class="btn-delete-generator-history history-row-btn history-row-btn-icon" data-idx="${idx}" title="${deleteLabel}" aria-label="${deleteLabel}">${ICON_TRASH}</button>
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
      emptyMarkup: `<p class="history-empty">${t("history.emptyGenerated")}</p>`,
      undoLabels: { remove: t("history.itemDeleted"), clear: t("history.cleared") },
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
          announce(t("history.configLoaded"));
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
    btn.textContent = t("history.exporting");
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
      downloadBlob(blob, downloadName(items[i].config));
      downloaded++;
      if (i < items.length - 1) await sleep(BATCH_EXPORT_GAP_MS);
    }
    announce(t("history.downloadedCodes", { count: downloaded }));
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
  // The row's export button holds an icon, not a label: writing a busy string
  // into it replaces the SVG, and restoring the captured (empty) text leaves
  // the button blank. Disabled + aria-busy is the whole feedback; the toast
  // reports the outcome.
  if (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  }
  try {
    const blob = await exportHistoryConfigPng(item);
    if (blob) {
      downloadBlob(blob, downloadName(item.config));
      announce(t("history.downloadedOne"));
    } else {
      announce(t("history.exportFailed"));
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
    historyExportBusy = false;
  }
}
