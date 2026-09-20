# Code Quality / Architecture Audit

## CRITICAL

### C1. No TypeScript for JS files — type safety gaps
Only `state.ts` is TypeScript. All other 14 JS files are plain JS with
occasional `@param` JSDoc annotations. The `@ts-check` pragma in `utils.js` is
the only type-checked file. This means:
- `DOM` properties can be accessed with typos (no autocomplete)
- Function parameters are unchecked across module boundaries
- Refactoring (e.g., renaming a state property) requires manual grep

**Fix:** Migrate to TypeScript incrementally, starting with `dom.js` and
`state.ts` (already TS).

### C2. `DOM` is a plain object, not typed (dom.js)
`export const DOM = {}` with `Object.assign(DOM, {...})` in `initDOM()`.
Every property access (`DOM.foo`) can silently be `undefined`. The
`safeGetElementById` throws on missing elements, but only for properties that
are listed in `initDOM()`. Any property accessed before `initDOM()` or
misspelled returns `undefined` without warning.

**Fix:** Define an interface/type for DOM and enforce with TypeScript, or at
minimum add runtime guards.

### C3. `generateQR()` is both sync and async internally (generator.js:334-530)
The function uses `async/await` (line 452: `const svgStr = await
getCombinedSvgString(...)`) but is called synchronously in many places
(e.g., `generateQR(true)` after setting a value). The function itself is not
`async` — it returns `void`/`Promise<void>`. Callers don't `await` it, so
errors in the async path are silently swallowed unless caught inside.

**Fix:** Make `generateQR` `async` and either `await` it or handle errors at
each call site. Alternatively, keep the fire-and-forget pattern but ensure all
errors are caught internally (they are, via try/catch in `triggerUpdate`).

## HIGH

### C4. `main.js` is 744 lines — violates single responsibility
`main.js` handles:
- App initialization and orchestration
- Theme system
- Global keyboard shortcuts
- Credits modal
- Data input panels
- Color controls
- Dimension controls
- Shape/frame controls
- Logo controls
- Save button
- Share link button
- Section toggles
- SW update banner
- PWA install prompt
- Fatal error UI

At minimum, the theme system, keyboard shortcuts, section toggles, and SW
update banner should be extracted into their own modules under `src/js/ui/`.

### C5. `export.js` is 487 lines — too many responsibilities
`export.js` handles:
- SVG surround shape / mask rendering
- Frame composition
- Export to PNG/SVG/JPEG/WEBP/TXT
- Unicode QR generation
- Filename generation
- Copy to clipboard
- Download trigger

The surround shape and frame composition logic is extremely complex (200+ lines
of SVG path math) and tightly coupled with the QR rendering. The clipboard and
download logic is separate concern.

### C6. `generateQR()` modifies UI directly (generator.js:344-526)
The function directly manipulates `DOM.qrCanvasContainer`, `DOM.qrLoading`,
`DOM.emptyStateQr`, `DOM.btnDownload`, `DOM.btnCopy`, `DOM.btnSave`,
`DOM.btnShareLink`, `DOM.marginWarning`, and the announcements element. This
makes it impossible to test the generation logic without a full DOM.

**Fix:** Return a result object from `generateQR()` and let the caller handle
UI updates, or at minimum inject a render callback.

### C7. Dead code: `configSignature` ignores logo data URL (generator.js:312-319)
The `configSignature` function deliberately excludes `logoDataUrl` from the
signature, meaning two configs that differ only in their logo are considered
identical for "is current config saved?" checks. This is intentional but
should be documented.

### C8. Magic numbers and strings scattered throughout
- `300` (default width/height) appears in ~10 places
- `50` (max history items) appears in `main.js` and `constants.js`
- `0.4` (default logo size) appears in `main.js`, `state.ts`, `constants.js`
- `4` (default margin) appears in generators
- `240` (HSL range) appears in color-picker.js at least 8 times

**Fix:** Use the constants defined in `constants.js` consistently.

## MEDIUM

### C9. `initUndoHandler` clocked every `showUndoToast` call (history.js:55-75)
Each call to `showUndoToast` creates a new button element and registers a new
click handler without removing the old one. See B1 in bugs audit.

### C10. No error boundary for async operations
The app has no global unhandled rejection handler. If an `await` fails outside
a try/catch (e.g., in `exportCombinedCanvas` image loading), the error is
silent or crashes the app.

**Fix:** Add `window.addEventListener("unhandledrejection", ...)` in `main.js`.

### C11. `getQrCode()` returns singleton that may have stale `crossOrigin` (generator.js:21-58)
The `QRCodeStyling` instance is created once with `crossOrigin: "anonymous"`.
If the user uploads a logo via URL, the crossOrigin setting is appropriate. But
if the QR code is exported as SVG and then opened in a browser, the
`crossOrigin` attribute on the embedded image could cause CORS issues.

### C12. Multiple `dispatchEvent(new Event("change"))` calls during sync (generator.js:211, 235)
`syncConfigToUI()` dispatches `change` events on select elements, which
triggers the wired change handlers that call `generateQR()`. This means
`syncConfigToUI()` can trigger multiple redundant QR generations during a
single sync cycle (e.g., changing data type triggers compilation → generation,
then changing ECC triggers generation again). The debounce at `generateQR()`
mitigates this, but it's still wasteful.

**Fix:** Batch state changes and call `generateQR()` once after all values
are set, or use a dirty flag.

### C13. `loadState()` restores input fields by dispatching `change` events (state.ts:140-145)
`loadState()` iterates `fields` and dispatches `change` on each input element.
If the form input handlers rely on `change`, this triggers validation and
generation for every field during page load. For users with many saved fields,
this can cause a burst of QR generations.

**Fix:** Set values directly and suppress generation until all fields are
restored, then trigger once.

### C14. `scannerWorker.postMessage` transfers buffer but reuses it (scanner.js:460)
The `postMessage` call transfers `imageData.data.buffer`, which neuters the
original buffer. The code then continues to use `canvasBuffer` for the next
frame — but `canvasBuffer` still has the old dimensions, so a new buffer is
created on the next allocation. However, the `getImageData` call at line 448
creates a new buffer each time, so this is safe in practice. Still, the
transferred buffer is never nulled, creating a potential use-after-transfer.

**Fix:** Set `imageData = null` after transfer to avoid confusion.

### C15. `dom.js` uses `safeGetElementById` but the `DOM` object allows arbitrary extension (dom.js)
Because `DOM` is exported as a mutable object, any module can add properties
at runtime. This makes it hard to track where DOM references come from.

**Fix:** Consider freezing `DOM` after initialization, or use a Map.

### C16. Import cycle risk: `scanner.js` imports `showUndoToast` from `history.js` (scanner.js:5)
`history.js` is in the `generator/` directory, `scanner.js` is in `scanner/`.
Cross-domain imports between scanner and generator create a subtle coupling.
If `history.js` ever imports from `scanner.js`, a circular dependency emerges.

**Fix:** Move `showUndoToast` and the undo toast logic to a shared module
(e.g., `src/js/ui/toast.js`).

### C17. `eslint.config.js` rules not enforced (no output on current lint run)
The ESLint config allows many things. At minimum, `no-unused-vars` should be
enabled (there are several unused params like `_cachedG`, `_logo`, `_fields`)
and `no-console` should warn.

### C18. Tests only cover 8 of 15 source files (vitest.config.js:11-24)
Coverage excludes: `main.js`, `scanner/scanner.js`, `scanner/worker.js`,
`dom.js`, `components.js`, `constants.js`. These files contain the most
complex UI logic. `main.js` at 744 lines has zero test coverage.
