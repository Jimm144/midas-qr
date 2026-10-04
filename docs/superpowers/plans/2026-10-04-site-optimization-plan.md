# Implementation Plan: Full-Site Optimization Overhaul
Date: 2026-10-04
Spec: docs/superpowers/specs/2026-10-04-site-optimization-design.md

## Phase 1: Efficiency & Runtime Performance
- [x] Task 1.1: Scanner Lifecycle & Throttling
  - Target: `src/js/scanner/scanner.js`, `src/js/scanner/decoder.js`
  - Changes:
    - Add interval gate in `requestAnimationFrame` scanner loop to cap decode rate at ~18-20 fps (~50ms delta).
    - Attach `document.addEventListener("visibilitychange")` to pause/stop camera tracks when tab is hidden, resume when visible.
    - Stop camera stream cleanly when switching away from `#panel-scanner`.
    - Use transferable buffer for `ImageData.data.buffer` in decode messages when available.
  - Verification: `npm test tests/scanner.test.js tests/scanner-worker.test.js`.

- [x] Task 1.2: Generator Coalesced Render Scheduler
  - Target: `src/js/generator/generator.js`
  - Changes:
    - Coalesce rapid input updates via `requestAnimationFrame` before calling `getQrCode().update()` and `renderSvg()`.
    - Defensively guard all DOM container references against undefined/unmounted states.
  - Verification: `npm test tests/generator.test.js tests/pipeline.test.js`.

- [x] Task 1.3: History & Batch Chunking
  - Target: `src/js/generator/history.js`, `src/js/scanner/history.js`, `src/js/generator/batch.js`
  - Changes:
    - Multi-element rendering with `DocumentFragment` to eliminate reflow thrashing.
    - Batch export row-by-row microtask yielding to prevent UI lockup.
  - Verification: `npm test tests/batch-init.test.js tests/history.test.js`.

## Phase 2: Lightweight Payload & Resource Diet
- [x] Task 2.1: CSS Pruning & Consolidation
  - Target: `src/css/style.css`
  - Changes:
    - Consolidate button base classes and redundant focus ring declarations.
    - Unify dialog overlay/backdrop utility rules.
    - Clean duplicate selectors while strictly preserving visual presentation.
  - Verification: `npm run build:css` (check size reduction) and `npm test tests/section-animation-css.test.js`.

- [x] Task 2.2: Memory & Blob URL Cleanup
  - Target: `src/js/generator/export.js`, `src/js/generator/batch.js`, `src/js/scanner/scanner.js`
  - Changes:
    - Revoke temporary Object URLs after download click triggers.
    - Clear preview canvas backing buffers when clearing scan or reset.
  - Verification: `npm test tests/export-click.test.js`.

## Phase 3: Accessibility (a11y) Overhaul
- [x] Task 3.1: WAI-ARIA Navigation & Controls
  - Target: `src/js/ui/tabs.js`, `src/js/ui/components.js`
  - Changes:
    - Tab bar arrow key navigation (ArrowLeft/ArrowRight, Home/End) + roving tabindex.
    - Custom select arrow keys (ArrowUp/ArrowDown, Enter, Space, Escape, Home, End) + `aria-activedescendant`.
  - Verification: `npm test tests/tabs.test.js tests/markup-a11y.test.js`.

- [x] Task 3.2: Modal Focus & Escape Traps
  - Target: `src/js/ui/modal.js`
  - Changes:
    - Focus restoration to opener element on close.
    - Initial focus on primary action button or dialog container.
  - Verification: `npm test tests/popover.test.js`.

- [x] Task 3.3: Form Validation Hints & Live Announcements
  - Target: `src/js/generator/inputs.js`, `src/js/generator/data-types.js`, `src/js/ui/announce.js`
  - Changes:
    - Ensure input warnings set `aria-describedby="[warning-id]"` dynamically when `aria-invalid="true"`.
    - Live region announcements for QR ready, copied, and exported.
  - Verification: `npm test tests/data-types.test.js`.

- [x] Task 3.4: Motion & High Contrast Media Queries
  - Target: `src/css/style.css`
  - Changes:
    - `@media (prefers-reduced-motion: reduce)`: zero out transitions, transforms, radar sweep animation.
    - `@media (forced-colors: active)`: visible borders on custom buttons, tabs, inputs, and dropdown triggers.
  - Verification: `npm test tests/theme-contrast.test.js`.

## Phase 4: Functional Excellence & Polish
- [x] Task 4.1: Scanner Clipboard Image Paste & Drag-Drop State
  - Target: `src/js/scanner/scanner.js`
  - Changes:
    - Window-level `paste` handler when scanner tab is active to decode clipboard images directly.
    - Drag-and-drop counter to avoid flickering dragleave events on children.
  - Verification: `npm test tests/scanner.test.js`.

- [x] Task 4.2: Data Types Robustness & Bounds
  - Target: `src/js/generator/data-types.js`, `src/js/generator/formatters.js`
  - Changes:
    - Ensure E.164 phone formatting handles leading +, brackets, and spaces gracefully.
    - WiFi SSID/password special char escaping validation.
    - Geo latitude/longitude numeric boundary clamping (-90..90, -180..180).
  - Verification: `npm test tests/formatters.test.js tests/data-types.test.js`.

- [x] Task 4.3: History Quota Auto-Prune
  - Target: `src/js/generator/history.js`, `src/js/scanner/history.js`
  - Changes:
    - On `QuotaExceededError`, prune oldest non-favorite entries and retry save once.
  - Verification: `npm test tests/history.test.js`.

## Phase 5: Verification & Full Quality Gate
- [x] Task 5.1: Pipeline Validation
  - Commands:
    - `npm run lint` (0 errors)
    - `npm run typecheck` (0 errors)
    - `npm test` (58/58 test files passed, 2186 tests passed)
    - `npm run format:check` (0 issues)
    - `npm run build` (esbuild JS + CSS bundled cleanly, asset stamps synced)
    - `node tools/check-sw.mjs` (precache + CSP hashes verified)
