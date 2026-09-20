# Bug Audit

## CRITICAL

### B1. Undo toast dispatches duplicate event listeners (history.js:66)
`showUndoToast()` creates a new button HTML (`innerHTML`) every call, then calls
`getElementById("undo-toast-btn")` and adds a `click` listener. If the function
is called multiple times (e.g. two rapid deletes), the old button element is
replaced in the DOM but the new listener is added on top. Repeated calls lead
to multiple listeners on the same button, executing the undo callback N times.

**Fix:** Use event delegation or remove old listener before adding new one.

### B2. cameraSwitchPending never resets on error (scanner.js:57-63)
If `stopWebcamScan()` or `startWebcamScan()` throws/rejects, the `finally` block
never runs, leaving `cameraSwitchPending = true` permanently. Subsequent camera
switches are silently ignored.

**Fix:** Move `.finally()` to the `startWebcamScan()` call chain properly, or
wrap both in a try-finally.

### B3. Scanner upload image timeout can fire after success (scanner.js:497)
A 30-second `setTimeout` is set for image load timeout. If `img.onload` fires,
`clearTimeout(loadTimeout)` runs. But if an `img.onerror` fires first, the
timeout is cleared there too. However, if `img.src` assignment triggers a
synchronous error (unlikely but possible in some envs), `loadTimeout` leaks.
More critically, if both `onload` and the timeout fire in the same event loop
tick, the timeout handler could set `img.src = ""` after `onload` starts
processing.

**Fix:** Guard the timeout handler with a boolean flag (`loaded = true`).

### B4. Margin warning blocks QR but never unblocks on margin reduction (generator.js:394-406)
When `userMarginPx > dataW / 2`, the warning shows and `qrCanvasContainer` is
hidden. If the user then reduces the margin below the threshold, the warning
hides but `qrCanvasContainer.style.display` is never restored to `"flex"` — it
stays `"none"` permanently until the next full generation cycle. The user sees
a blank area with no explanation.

**Fix:** Set `DOM.qrCanvasContainer.style.display = "flex"` when clearing the
margin warning.

### B5. ECC tooltip positioned off-screen on mobile (generator.js:397-404 and style.css:203-208)
The ECC tooltip uses `left: 100%; top: 0; transform: translateX(12px)` which
positions it to the right of the trigger. On narrow screens (mobile), this
pushes the tooltip well beyond the viewport's right edge, making it unreadable.
There's no `max-width` or `right` constraint.

**Fix:** Add responsive positioning — use `left: auto; right: 0` on small
screens, or `max-width: 90vw` with negative margin adjustment.

## HIGH

### B6. Scanner webcam mirroring checks wrong element after camera enumeration (scanner.js:341-343)
The `isFront` check reads `DOM.cameraSelect?.selectedOptions?.[0]?.text` to
detect front cameras. But after `populateCameras()` runs (line 348), the select
options are replaced with actual device IDs, meaning the selected option's text
could be something like "Integrated Camera" rather than "FRONT" or "BACK". The
regex `/front|user/i` partially mitigates this but is fragile.

**Fix:** Track selected camera facing mode separately instead of relying on
option text.

### B7. qr-code-styling instance caches stale config on first use (generator.js:21-58)
`getQrCode()` creates a singleton `QRCodeStyling` instance with initial config
from `state`. Subsequent `getQrCode().update(options)` calls pass new options.
However, if the initial state has some unexpected values (e.g. during legacy
state migration), the instance is created with those values and `update()` may
not override all properties (some libs merge rather than replace).

**Fix:** Call `update()` immediately after construction with the full current
state, or recreate the instance on first meaningful config change.

### B8. License validation drops history items with large logos silently (history.js:9-17)
When `persistAppState` returns `false` (quota exceeded),
`saveGeneratorHistory()` filters out items whose `logoDataUrl` exceeds 64 KB.
This is reasonable, but there is no user notification — items disappear silently
from history. The user may rely on history items that are quietly purged.

**Fix:** At minimum, log a console warning. Consider showing a toast:
"HISTORY TRIMMED — SOME LARGE LOGOS REMOVED TO STAY UNDER STORAGE LIMIT".

### B9. `prefers-reduced-motion` overrides ALL animations, including useful ones (style.css:265-272)
The media query sets `transition-duration: 0.001ms !important` on all elements.
This breaks animations that provide essential feedback (e.g., the color picker
popup opening, the tab indicator animation, modal entrance). Users with
`prefers-reduced-motion: reduce` get no visual feedback at all.

**Fix:** Use a more targeted approach — either scope to decorative-only
animations, or keep the override but ensure functional animations use CSS
`animation: none` exclusion list.

### B10. Scanner webcam tab init race: jsQR loaded but not attached to window (tabs.js:97-107)
The scanner lazy-loads `jsqr.min.js` via script tag. The `onload` handler
checks `typeof jsQR === "undefined"` but `jsQR` might already be defined from
a previous tab switch. The `jsqrLoaded` flag only tracks whether the script
was _ever_ loaded, not whether the current initScanner call succeeded.

**Fix:** Check `typeof jsQR !== "undefined"` after the script loads to confirm
it's available, rather than just the load event firing.

## MEDIUM

### B11. `historyList` delegation uses `dataset.idx` as string index (scanner.js:229)
Line 229: `const item = state.scanner.history[historyItem.dataset.idx]` — this
uses a string `"0"` as an array index. While JS coerces this correctly for
arrays, it fails for `Int32Array` or custom-proxy objects. The delete handler
(line 215) correctly uses `parseInt`.

**Fix:** Use `const idx = parseInt(historyItem.dataset.idx, 10)` for consistency.

### B12. Color picker `mouseup` listener never removed (color-picker.js:321-323)
`window.addEventListener("mouseup", ...)` is added once in `initColorPicker()`
but never removed. Over the lifetime of a long-running SPA this is fine, but if
`initColorPicker` could ever be called again (e.g., hot reload), duplicate
listeners stack.

**Fix:** Store the handler reference and remove before re-adding, or guard with
a boolean.

### B13. `undoData` from history deletion becomes stale after toast timeout (history.js:51-82)
When the undo toast auto-hides after 5 seconds, `undoData` is set to `null`.
But the `removed` item in the closure (history.js:93-100) was spliced from the
original array — if the user manually modifies history items via direct state
mutation (e.g., a future feature), the `removed` reference could be stale.

**Fix:** Clone the `removed` item with `JSON.parse(JSON.stringify(removed))`.

### B14. `serializeAppState` captures input fields from DOM on beforeunload, but `fields` key is never cleaned (state.ts:129-136)
The `fields` property on `state.generator` is populated during serialization
and loaded back during `loadState()`, but never cleared after load. Over time,
the `fields` object accumulates stale entries from previously-active data
types.

**Fix:** Clear `state.generator.fields = {}` at the start of `serializeAppState`
before populating.

### B15. `cachedG` and `cachedLayoutKey` are stored in serialized state but stripped (state.ts:156-158)
The `serializableGenerator` function strips these fields, but they're sent
through `JSON.parse(JSON.stringify(...))` during history save (`main.js` line
in save button handler), which drops non-serializable values anyway. Not a bug
per se, but the `Object.assign(state.generator, item.config)` in history load
(history.js:110) could re-hydrate stale `cachedG` / `cachedLayoutKey` from
old-format history entries.

**Fix:** Guard the `Object.assign` with explicit exclude of `cachedG` and
`cachedLayoutKey`.

### B16. `DOM.fontSizeTiny` / `DOM.fontSizeXs` / `DOM.fontSizeSm` inline styles (all HTML)
The HTML has repetitive inline `text-xs font-bold` on virtually every element
(100+ occurrences). This bloats the HTML by ~15 KB and makes theme changes
painful.

**Fix:** Set these styles on parent containers and rely on CSS inheritance.

### B17. Scanner `clearScannerOutput` called on webcam start before init (scanner.js:315)
`startWebcamScan()` calls `clearScannerOutput()` at line 315, which sets
`DOM.btnVisitResult.href = "#"`. If the user switches to webcam after having
scanned something, the "OPEN" link is lost until the next successful scan.
Minor UX issue.

**Fix:** Save and restore the result state, or only clear when a new scan
actually begins producing results.
