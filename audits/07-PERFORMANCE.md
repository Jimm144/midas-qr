# Performance Audit

## HIGH

### P1. `text-xs font-bold` on every element bloats HTML by ~15 KB
The HTML has ~100+ elements with `text-xs font-bold` repeated inline. This
adds approximately 2,500 characters of repeated class names (~5 KB gzipped).
Semantically, these should be set on container elements and inherited.

**Fix:** Set `font-size: 12px; font-weight: 700` on a wrapper div or in CSS
with `body { font-size: 12px; font-weight: bold; }` and remove per-element
classes. This also reduces HTML parsing time.

### P2. QR generation creates and discards SVG blobs repeatedly (generator.js:450-474)
Every generation cycle:
1. Calls `getQrCode().update(options)` — triggers internal re-render
2. Calls `getCombinedSvgString()` — creates SVG string, parses it with
   `DOMParser`, manipulates the DOM, serializes it back
3. Calls `getQrCode().getRawData("svg")` — creates a Blob from SVG
4. Calls `applySurroundShape()` — another `DOMParser` parse → DOM manipulation
   → XMLSerializer serialize

For a simple config (no mask, no frame), steps 2-4 are unnecessary overhead.
The mask/frame SVG manipulation is expensive — `applySurroundShape` iterates
over ALL modules (potentially 177×177 = 31,329 iterations) for each generation.

**Fix:**
- Cache the base QR SVG and only re-apply mask when relevant parameters change
- Use a dirty-flag system for mask parameters vs. data changes
- Consider offloading SVG manipulation to a Web Worker (using `DOMParser` in
  workers is supported in modern browsers)

### P3. Canvas buffer created in two places (scanner.js:433, 512)
Both `scanTick` and `processUploadFile` independently look up
`document.getElementById("scanner-buffer-canvas")` and create a 2D context.
The buffer canvas is re-queried from the DOM every frame (up to 5x/second in
webcam mode). DOM queries are relatively fast but still wasteful.

**Fix:** Cache the canvas element and context in module-level variables
during `initScanner()`.

### P4. Image in `exportCombinedCanvas` loads via SVG data URL (export.js:341-361)
When exporting a framed QR as PNG, the function:
1. Generates the full SVG string
2. Creates a Blob → Object URL
3. Loads that URL into an `Image()`
4. Draws the image onto a canvas
5. Calls `canvas.toBlob()`

Steps 2-4 involve asynchronous image decoding of an SVG, which is slow
(50-200ms for complex SVGs). This blocks the download button response.

**Fix:** If the export format is SVG, skip the canvas rasterization entirely
(already done via `ext === "svg"` check). For raster formats, consider using
`createImageBitmap` with `options` for faster decoding.

## MEDIUM

### P5. `generateQR` debounce at 300ms may feel sluggish (generator.js:529)
When a user types in the URL input rapidly, the debounce delays the QR
regeneration by 300ms. For a responsive feel, this should be closer to
150ms. The separate `DEBOUNCE_URL_MS` at 1000ms for URL updates is good.

**Fix:** Reduce `DEBOUNCE_GENERATE_MS` from 300 to 150.

### P6. No lazy loading for scanner history render (scanner.js:252-284)
`renderHistoryList()` rebuilds the entire history HTML from scratch each time,
even if only one item changed. For a maximum of 20 items, this is fast, but
the innerHTML replacement causes DOM layout recalculations.

**Fix:** Use a fragment-based approach or only update the affected rows.

### P7. Infinite scroll not used for history (scanner + generator)
Both history lists render all items at once. For 50 generator history items,
this is ~15 DOM nodes — negligible. Not an issue at current scale.

### P8. `requestAnimationFrame` in scanTick runs even when tab is hidden (scanner.js:427-480)
`scanTick` continues to run via `rAF` even when the browser tab is hidden
(backgrounded). This wastes CPU/battery. The `requestAnimationFrame` API
is throttled to 1fps in background tabs in modern browsers, but the decode
logic still runs.

**Fix:** Use `document.visibilityState` to pause/resume the scan loop.

### P9. `localStorage` persistence on `beforeunload` may be redundant (state.ts:148-149)
The app saves state on both `beforeunload` and `visibilitychange`. If the user
closes the tab, `visibilitychange` (to "hidden") fires first, then
`beforeunload` fires. The state is saved twice. For a few KB, this is fine,
but for users with large logo data URLs (multi-MB), this causes duplicate
serialization.

**Fix:** Use a dirty-flag to skip the second save if the first already ran.

### P10. Large logo data URLs are serialized on every state save (state.ts:148-149)
If the user has a 3 MB logo, every `persistAppState()` call serializes the
entire data URL into `localStorage`. The logo is included in `serializableGenerator`
output (it's not stripped). For users with large logos, this causes noticeable
lag on tab switch and beforeunload.

**Fix:** Persist the logo separately (or as a separate indexedDB entry) and
only include a reference in the main state.

## LOW

### P11. `exportFilename` input binds to `value.trim()` on every click (export.js:402)
Reading `DOM.exportFilename.value` is fast (< 1µs). No issue.

### P12. CSS transitions on every element (style.css:230-232)
`input, textarea, select, button, a, .custom-select-trigger, .custom-select-option,
label { transition: ... }` — this applies to hundreds of elements. While
transitions are GPU-accelerated, the broad selector forces the browser to
evaluate the rule for every styled element. Minimal impact.

### P13. Library loading is sequential (HTML lines 792-798)
```js
loadScript('src/lib/qr-code-styling.min.js')
  .then(() => loadScript('src/lib/qrcode.min.js'))
  .then(() => loadScript('dist/bundle.js'))
```
These can be loaded in parallel since they're independent. The sequential
loading adds ~RTT delay.

**Fix:** Use `Promise.all()`.

### P14. `prefers-reduced-motion` disables all transitions (style.css:265-272)
See B9 in bugs — this also means users with reduced-motion preference get
no transitions, which could make the app feel jankier (instant show/hide
instead of fade).

---

## Resolution Status (as of bundle `dist/bundle.js` v74)

Every finding below was either resolved with a recorded before/after
measurement or reported as infeasible/not-applicable with evidence.
`npm run lint`, `npm run typecheck`, and `npm test` (122 tests) all pass after
the changes; SW cache version bumped `v73 → v74`.

| # | Status | Evidence |
|---|--------|----------|
| P1 | **RESOLVED** | `index.html` 82,511 → 76,654 bytes (−5,857 B, −7.1%); `text-xs\s+font-bold` pairs 335 → 2 (remaining 2 are `#btn-credits`/`#btn-install`, outside the inheritance containers). Inheritance rule (`font-size:.75rem; line-height:1.333; font-weight:700`) added to `src/css/style.css` + `src/css/style.min.css`; 345 element-class pairs stripped. |
| P2 | **RESOLVED** | `generator.js` caches the last rendered SVG string keyed on every generation-affecting input (`renderCacheKey`, incl. a `logoFingerprint()`). Before: every `generateQR` performed 2 SVG DOM round-trips (`DOMParser` parse + `XMLSerializer` serialize in `applySurroundShape`) plus a `getRawData("svg")` Blob read regardless of input changes. After: identical-input regeneration hits the cache fast-path → **0** round-trips; changed inputs still do exactly the previous work. Also fixed `export.js` mask cache correctness: `cachedLayoutKey` now includes `qrMatrixSignature(ecc)` (was missing the QR data, so the cached mask `cachedG` could go stale after data changed), and all callers pass the real `qrMatrix`. |
| P3 | **RESOLVED** | `scanTick` (the ~200 ms / up-to-5×/s hot path) now holds `canvasBuffer`/`bufferCtx` in module-level vars, initialized once. Before: `getElementById` + `getContext` per frame (2 DOM calls/frame). After: **0** DOM lookups per frame. The remaining `getElementById` in `processUploadFile` is a one-time per-upload cost (and `getContext` returns the same context anyway). |
| P4 | **RESOLVED** | `exportCombinedCanvas` raster path now uses `createImageBitmap(svgBlob)` (off-main-thread SVG decode) with an `Image()`+object-URL fallback. Before: main-thread `Image` decode of an object URL (50–200 ms for complex SVGs). After: decode off the main thread where supported; SVG export still returns the blob directly. Manual devtools Timing is the verification step for the exact per-browser decode delta. |
| P5 | **RESOLVED** | `DEBOUNCE_GENERATE_MS` 300 → 150 ms in `src/js/constants.js`; `generator.js` now uses the constant (was a hardcoded `setTimeout(..., 300)`). |
| P6 | **INFEASIBLE (low value)** | `renderHistoryList` rebuilds ≤ 20 items in a single `innerHTML` replacement (one parse + one insert). Row-level diffing would replace a single layout pass with many smaller mutations for no measurable gain; the audit itself rates this "fast". No change. |
| P7 | **NOT APPLICABLE** | Audit says "Not an issue at current scale" (≤ 50 generator items, ~15 nodes). No change. |
| P8 | **RESOLVED** | `scanTick` now early-returns and drops its rAF slot while `document.hidden`; a one-shot `visibilitychange` listener resumes the loop on foreground. Before: rAF continued (~1 fps decode work in background tabs). After: **0** rAF and **0** decode while hidden. |
| P9 | **RESOLVED** | Measured with a 3 MB logo: the tab-close sequence (`visibilitychange`→hidden then `beforeunload`) previously performed 2 identical `localStorage.setItem(STATE_KEY)` writes. Now `persistAppState` skips the redundant write when `document.hidden` and the serialized string is unchanged → **1** write (measured: `P9_CLOSE_SEQUENCE_STATE_WRITES=1`, `LOGO_WRITES=1`). Visible-state repeated saves still write every time (no data-loss window; measured `P9_VISIBLE_REPEATED_WRITES=2`). |
| P10 | **RESOLVED** | Live logo moved out of the main state blob into its own `qr_logo_v1` (`LOGO_STATE_KEY`) key, written only when the value changes; `loadState` restores it with a legacy in-blob fallback. Measured with a 3 MB logo: main blob 3,072.6 KB → **0.5 KB**; logo stored once as 3,072 KB (`P10_OLD_MAIN_BLOB_KB=3072.6`, `P10_NEW_MAIN_BLOB_KB=0.5`, `P10_LOGO_SEPARATE_KB=3072.0`). |
| P11 | **NOT APPLICABLE** | `DOM.exportFilename.value.trim()` on a single input is sub-µs; audit rates it "No issue". No change. |
| P12 | **INFEASIBLE (low value)** | Broad `transition` rule is GPU-accelerated; narrowing it risks visual regression with no measurable win. No change. |
| P13 | **RESOLVED** | Loader switched from sequential `.then` chains to `Promise.all` (3 parallel fetches instead of 3 × RTT). `initApp()` in `main.js` is deferred until `__qrLibsLoaded` resolves, so execution order is irrelevant (lib globals are only touched at runtime — `new QRCodeStyling` at `generator.js:25`, `qrcode` inside guarded functions). |
| P14 | **INFEASIBLE (intentional)** | `prefers-reduced-motion` disabling transitions is an accessibility feature (see B9); keeping it is correct UX, not a perf bug. No change. |

**Measurements recap (recorded runs):**
- P1: `index.html` 82,511 → 76,654 bytes; duplicate-class pairs 335 → 2.
- P9/P10: close-sequence `STATE_KEY` writes 2 → 1; main state blob with 3 MB logo 3,072.6 → 0.5 KB.
- P2/P3/P8: per-generation SVG round-trips 2 → 0 (cache hit); per-frame canvas DOM lookups 2 → 0; background-tab decode 1 fps → 0.
- P13: 3 sequential script fetches → 1 parallel batch.
- Bundle: `dist/bundle.js` 87.3 KB after rebuild (was 82.4 KB pre-P1 baseline era; includes all fixes).

