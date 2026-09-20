# UX / UI Audit

## CRITICAL

### U1. No loading state during QR generation for complex configs (generator.js:334-530)
The QR generation is async (uses `await` for SVG blob). For complex configs
(large modules, frames, masks), this can take 500ms–2s. The `qr-loading`
spinner is shown, but it's inside `#qr-preview-container` which has
`aspect-ratio: 1/1` and `min-height: 260px`. The spinner is centered but
there's no progress indication — just an indeterminate spinner.

**Fix:** Add a cancel button or a "generating..." message that updates with
the current step (e.g., "Rendering QR...", "Applying mask...", "Exporting...").

### U2. No way to reorder history items (both scanner and generator)
History is purely chronological (newest first). Users who scan/generate
frequently must scroll through many items to find a particular one. No search
or filter exists.

**Fix:** Add a simple text filter input above each history list.

### U3. Scanner webcam shows "FRONT"/"BACK" select before camera access granted (scanner.js:361-416)
The camera select initially shows "FRONT" / "BACK" (facingMode values). After
`populateCameras()` runs, it's replaced with actual device labels. But
`populateCameras()` is only called after `startWebcamScan()` succeeds (line
348). If the user denies camera permission, the select stays at
"FRONT"/"BACK" but no camera is active — confusing.

**Fix:** Show the actual camera list immediately via `enumerateDevices()` (which
doesn't require permission) before attempting `getUserMedia`.

## HIGH

### U4. Color picker hex input doesn't validate on blur (color-picker.js:369-375)
The hex input validates on `input` event. If the user types an invalid hex
(e.g., "#GGGGGG") and presses Enter, nothing happens. If they close the popup,
the bad value is silently discarded and the previous color is restored. The
user has no feedback about why their value was rejected.

**Fix:** Show a brief error state on the hex input (red border, shake anim)
when the value is invalid.

### U5. Export filename input doesn't show the default name (export.js:402)
Line 402: `const filename = DOM.exportFilename.value.trim() || getDefaultFilename()`
The input is blank by default. Users don't know what filename will be used.
The default filename (`{type}-{timestamp}`) is generated but never displayed.

**Fix:** Set the input's placeholder or value to the default filename on
generation.

### U6. Margin warning shown but no suggested fix (generator.js:394-406)
When margin is too large, the warning text is "MARGIN TOO LARGE FOR THIS SIZE".
The user has to guess what margin would work. The actual maximum is
`dataW / 2` (line 395) which depends on the module count and width — not
obvious.

**Fix:** Include the maximum allowed margin in the warning message (e.g.,
"MARGIN TOO LARGE — MAX IS 47").

### U7. Keyboard shortcut for copy (Ctrl+C) interferes with system copy (main.js:120-127)
When the generator tab is active and no input is focused, Ctrl+C copies the QR
code image. But if the user _wants_ to copy a different element's text (e.g., a
filename), they can't because the handler captures Ctrl+C globally. The check
`isTyping` only covers `<input>` and `<textarea>`, not contenteditable or
elements with `tabindex`.

**Fix:** Check for any element that supports text selection, or make the
shortcut opt-in via a button tooltip.

### U8. Frame text maxlength 15 is not enforced in JS (HTML line 486, generator.js:301)
The HTML input has `maxlength="15"` but the JS handler
(`DOM.qrFrameText.addEventListener("input", ...)`) does not enforce this.
If a user pastes a longer string via JS, it would be accepted. The share URL
encoding enforces it (`g.frameText.slice(0, 15)`), but the live preview
doesn't.

**Fix:** Truncate in the input handler: `state.generator.frameText =
e.target.value.toUpperCase().slice(0, 15)`.

### U9. History "LOAD" button doesn't show any feedback (history.js:105-114)
Clicking LOAD applies the saved config silently. The user sees the QR preview
update but gets no toast or announcement. If the config was complex and the
QR takes a moment to regenerate, the user might think nothing happened.

**Fix:** Announce "Config loaded from history" via `announce()` or show a brief
pulsing border on the QR preview.

### U10. Scanner video reticle has no visual feedback during scan (HTML line 610-612)
The reticle is a static white border box. When a QR code is detected, the
status badge changes to "OK" but the reticle doesn't change. Users scanning
dynamically (e.g., moving the camera around) have no confirmation that the
scan is working.

**Fix:** Animate the reticle (color flash, brief scale pulse) on successful
scan, and show a faint grid/target overlay when scanning is active.

## MEDIUM

### U11. "SIMPLE" complexity mode still shows some full-only elements
The class `full-only` is used to hide advanced options. But some elements
inside the color section, parameter section, etc., may not have the `full-only`
class. Review each element.

### U12. No confirmation before clearing generator history (main.js:171-184)
Scanner history uses `window.confirm()` before clearing. Generator history
(`DOM.btnClearGeneratorHistory` handler in history.js:118-126) also uses
`window.confirm()`. This is inconsistent with the more polished toast-based
undo pattern used for individual item deletion.

**Fix:** Use the undo-toast pattern for "clear all" as well, with a brief
undo window.

### U13. Mobile: tab buttons wrap text on small screens (HTML lines 133-141)
The tab buttons have `px-2 sm:px-4`. On very small screens (< 360px), the text
"GENERATE" / "SCAN" / "HISTORY" may overflow. The buttons use
`text-xs font-bold` which at 12px with uppercase padding may be fine, but the
HISTORY tab has 7 characters — the longest.

**Fix:** Use shorter text or `overflow-hidden text-ellipsis` on the smallest
breakpoints.

### U14. No undo for scanner "CLEAR ALL" (scanner.js:171-184)
Individual scan history items can be undone via toast. But the "CLEAR" button
for the entire scan history uses `window.confirm()` with no undo. Inconsistent.

**Fix:** Apply the undo-toast pattern for batch deletions too.

### U15. WiFi password input has `type="password"` by default but hidden toggle only affects visibility (HTML line 178)
The eye toggle shows/hides the password, which is standard. But the toggle
button's `aria-pressed` is initialized as "false" even though the password
field starts hidden — meaning the button's state and the actual visibility are
in sync, which is correct only if `aria-pressed` means "currently showing
password". The toggle inverts on click but the initial state is misleading.

**Fix:** Initialize `aria-pressed` appropriately or use `aria-label="Show
password"` / "Hide password" text toggle.

### U16. No visual feedback for "HIDDEN: NO/YES" toggle (HTML line 199-202)
The WiFi hidden checkbox is hidden (`class="hidden"`) and the label text
changes between "HIDDEN: NO" and "HIDDEN: YES". There's no visual indicator
besides the text change — no border change, no icon swap. Low-contrast or
small-screen users may miss the change.

**Fix:** Add a brief text color animation (e.g., flash yellow on change) or
swap an icon.

### U17. No "clear input" button on any text field
All text inputs lack a clear/× button. Users must manually select and delete
text. On mobile, this is friction.

**Fix:** Add a clear button that appears when input has value
(`<input type="search">` with `::-webkit-search-cancel-button` or a custom
button).
