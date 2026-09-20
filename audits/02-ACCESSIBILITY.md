# Accessibility Audit

## CRITICAL

### A1. Color contrast violations on theme switch (global)
The app allows arbitrary theme colors (`--bg` and `--accent`). When a user
selects a light theme (e.g., CATPPUCCIN light: `bg=#cba6f7`, `accent=#1e1e2e`),
the contrast between `--bg` and `--accent` may fall below 4.5:1 for text.
Specifically, the CATPPUCCIN light scheme has `bg: #cba6f7` (purple) and
`accent: #1e1e2e` (near-black) — the accent text on that background has
~3.2:1 contrast, failing WCAG AA for normal text.

**Fix:** Enforce a minimum contrast ratio in theme definitions, or compute
accessible accent colors dynamically.

### A2. Skip link targets heading that may not exist (main.js:75-84)
The skip link handler finds an `h2` inside the active tab panel. But the
history tab panel (`panel-history`) has `<h2>` elements inside the card divs
(not as direct children of the section). The scanner tab panel has
no `<h2>` at all — its heading is `<h2 class="text-xs...">Scanner Output</h2>`
which is inside a `qr-card`. The `target.querySelector("h2")` may return the
wrong heading or none at all.

**Fix:** Give each tabpanel a consistent heading with a known ID and focus
that directly.

### A3. `aria-describedby` points to hidden warning spans (HTML)
The warning spans (e.g., `url-warning`, `crypto-warning`, etc.) use
`aria-describedby` on their associated inputs. However, the warnings are
hidden (`class="hidden"`) by default. When a warning is shown, it's good.
But screen readers may not announce the description when it transitions from
hidden to visible, because `aria-describedby` is evaluated at focus time.

**Fix:** Use `aria-errormessage` with `role="alert"` for error states, or
ensure `aria-describedby` references are removed/updated when warnings are
hidden.

## HIGH

### A4. Tooltip only accessible on hover/focus of trigger (style.css:203-208, HTML line 397-404)
The ECC tooltip uses CSS `:hover` / `:focus` on the trigger to show the tooltip
content. The hidden `div` has `class="absolute hidden"`. This means:
- Touch users cannot access it (no hover on touch)
- Screen reader users never hear the tooltip content
- The tooltip disappears when trying to move the mouse to it (unless you happen
  to hit `#tooltip-content-ecc:hover`)

**Fix:** Use a proper expandable disclosure widget (`aria-expanded`) or make
the tooltip persistent on click.

### A5. Scanner drop zone has `role="button"` but is not focusable via tab (HTML line 589)
`<div id="drop-zone" role="button" tabindex="0">` is focusable, but when the
file input is opened via keyboard (`Enter`/`Space`), the focus moves to the
native file picker dialog. After closing the file picker, focus returns to
`<body>`, not back to the drop zone.

**Fix:** After file selection, restore focus to the drop zone or a logical
next element.

### A6. Color picker presets have no visible focus indicator in themes (HTML lines 76-83)
The `.cp-preset` buttons use `focus-visible:outline-2` but the outline color
is `focus-visible:outline-white`, which is `var(--accent)`. On light themes
where `--accent` is a dark color (e.g., `#000000` for MONO light), the white
outline is invisible on the white preset button.

**Fix:** Use `currentColor` or `var(--bg)` for focus outlines on color picker
presets.

### A7. Color picker closes on any document click (color-picker.js:482-486)
`document.addEventListener("click", ...)` closes the color picker when clicking
anywhere outside. This interferes with:
- Selecting text in the hex input
- Clicking inside the popup (which is stopped via `e.stopPropagation()` but
  only on the popup itself, not on child elements like the spectrum canvas)
- Using the color spectrum canvas (touch events)

**Fix:** Check `e.target` is not a child of the popup, rather than relying on
`stopPropagation()`.

## MEDIUM

### A8. Tab panel `aria-hidden` values not kept in sync with `hidden` class (tabs.js:62-69)
`setPanelVisibility` sets `aria-hidden="true"` on inactive panels and removes
it on the active one. But `aria-hidden` is never removed when panels are
initially rendered — the initial HTML has `aria-hidden="false"` for generator
and `aria-hidden="true"` for scanner/history, which is correct, but if a panel
is toggled via DOM manipulation outside `setPanelVisibility`, they drift.

**Fix:** Add a cleanup step in `setPanelVisibility` that ensures all panels
have the correct `aria-hidden` before setting the new state.

### A9. No `lang` attribute on 404.html `<html>` — wait, it has `lang="en"` (OK)
But the 404 page lacks a `<title>` that includes the site name — it has
`<title>404 — Page Not Found | QR Code Studio</title>` which is good.

### A10. Announcements region is `sr-only` but uses `role="status" aria-live="polite"` (HTML line 58)
This is correct for screen readers. However, `announce()` in main.js sets
`textContent = ""` in the same tick as the new message, which may cause some
screen readers to skip the announcement (empty string resets the live region
before the new content is appended). The `requestAnimationFrame(() => {...})`
double-buffer helps but not all screen readers handle this.

**Fix:** Use a dedicated announcer pattern: set `textContent` to a space, then
`requestAnimationFrame(() => textContent = message)`.

### A11. Modal focus trap only traps Tab, not Shift+Tab from first element (modal.js:37-49)
The handler correctly handles both `Tab` (wrap to first) and `Shift+Tab` (wrap
to last). But the `activeTrap` is a module-level singleton — calling
`openModal()` on a second modal while the first is still open overwrites
`activeTrap` without restoring the first modal.

**Fix:** Use a stack of traps, or ensure modals are always closed before
opening another.

### A12. Scanner camera button `btn-toggle-camera` uses text "START"/"STOP" but has no `aria-pressed` (HTML line 623)
The button toggles between "START" and "STOP" text but has no `aria-pressed`
or `aria-expanded` attribute. Screen readers only hear the text change, which
may not be interpreted as a state toggle.

**Fix:** Add `aria-pressed` or use `aria-label` with the current state.

### A13. The `qr-canvas-container` has no `role="img"` or `aria-label` (HTML line 535)
The generated QR code SVG is rendered into a div with no accessibility
attributes. Screen readers have no way to know the image is a QR code.

**Fix:** Add `role="img"` and `aria-label="Generated QR code"` to the SVG or
its container.

### A14. Font size 13px on `body` is below recommended minimum (style.css:13)
WCAG SC 1.4.4 requires text to be resizable up to 200% without loss of content.
A 13px base size is acceptable, but the app uses `text-xs` (Tailwind: 0.75rem =
12px) extensively. The `font-size: 13px` on body only affects elements that
don't have an explicit font-size class — which is almost none, since every
element uses `text-xs`.

**Fix:** Set body to at least `14px` (`0.875rem`) or adjust `text-xs` in
Tailwind config.

### A15. No visible focus indicator for `#scan-result` textarea (HTML line 647)
The readonly textarea has `focus:outline-none` and no `focus-visible` fallback.
Keyboard users navigating to this element see no focus ring.

**Fix:** Add `focus-visible:outline-2 focus-visible:outline-offset-2
focus-visible:outline-white`.
