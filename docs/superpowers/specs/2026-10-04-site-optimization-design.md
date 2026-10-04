# Spec: Full-Site Optimization (Efficiency, Payload, Accessibility, Functionality)
Date: 2026-10-04
Status: Approved

## 1. Scope & Goals
- Target: Full site overhaul (`midas-qr`) across 4 pillars.
- Zero regressions: exit 0 on `npm run lint`, `npm run typecheck`, `npm test` (58/58 suites), `npm run format:check`, `npm run build`, `node tools/check-sw.mjs`.
- PWA / CSP invariant: precache integrity, exact sha256 inline script sync in `index.html` & `serve.json`.

## 2. Pillar 1: Efficiency & Runtime Performance
- **Generator Coalescing**:
  - File: `src/js/generator/generator.js`
  - Mechanism: Coalesce rapid input/slider changes via `requestAnimationFrame` (`rafId` handle) to avoid synchronous DOM thrashing.
  - SVG & Layout Cache: Memoize frame font signature & text dimensions; skip layout recalc when inputs are unchanged.
- **Scanner CPU & Battery Throttling**:
  - Files: `src/js/scanner/scanner.js`, `src/js/scanner/decoder.js`
  - Throttled detection loop: Sample webcam frames at ~18-20 fps (interval clamp ~50ms) instead of uncapped 60 fps `requestAnimationFrame`.
  - Lifecycle teardown: Stop stream tracks immediately on `visibilitychange` (tab hidden) and panel switch (`#panel-scanner` hidden).
  - Worker Transfer: Pass `ImageData` buffer via transferable objects where available (`postMessage(..., [buffer])`).
- **History & Batch List Operations**:
  - Files: `src/js/generator/history.js`, `src/js/scanner/history.js`, `src/js/generator/batch.js`
  - Bulk DOM mutation via `DocumentFragment`.
  - Batch generation: Chunk processing with `scheduler.yield()` or microtask slicing (`setTimeout(0)`) to maintain 60 fps UI responsiveness.

## 3. Pillar 2: Lightweight Payload & Resource Diet
- **CSS Consolidation**:
  - File: `src/css/style.css`
  - Audit & refactor duplicate component selectors across buttons (`.btn-primary`, `.btn-secondary`, `.header-icon-btn`, `.icon-btn`), inputs, and cards.
  - Consolidate modal backdrop rules and repetitive focus-ring declarations.
  - Goal: 10-15% reduction in CSS rules with zero visual regression.
- **Resource Hygiene & Memory Diet**:
  - Files: `src/js/generator/export.js`, `src/js/generator/batch.js`, `src/js/scanner/scanner.js`
  - Explicit `URL.revokeObjectURL(url)` on all created blobs/images.
  - Teardown canvas contexts & listeners on unmount.
  - Keep vendor libraries (`qrcode.min.js`, `jsqr.min.js`) deferred via lazy single-flight loader.

## 4. Pillar 3: Accessibility (a11y) Overhaul
- **Keyboard Navigation & Focus Management**:
  - Tab navigation: `src/js/ui/tabs.js` — WAI-ARIA tab pattern with Arrow Left/Right/Home/End and roving `tabindex`.
  - Custom Selects: `src/js/ui/components.js` — Arrow keys, Home/End, Enter/Space, `aria-activedescendant`, `aria-expanded`.
  - Modals: `src/js/ui/modal.js` — Focus trap, escape key handling, return focus to trigger on close.
- **Screen Reader & Live Regions**:
  - Files: `src/js/ui/announce.js`, `src/js/ui/toast.js`
  - Live regions: `polite` announcements for QR generation, copy success, download alerts, and scanner outputs.
  - Form validation: Every invalid input bound via `aria-describedby` to its warning element, with `aria-invalid="true"`.
- **Sensory & Visual Adaptations**:
  - 2px high-contrast focus rings with `outline-offset: 2px` across dark and light themes.
  - Minimum 44x44px touch targets on mobile for interactive elements.
  - Complete `@media (prefers-reduced-motion: reduce)` coverage: suppress radar animations, accordion slides, and modal transitions.
  - Complete `@media (forced-colors: active)` support: explicit borders on buttons, cards, and dropdown triggers.

## 5. Pillar 4: Functional Excellence & Robustness
- **Generator Hardening**:
  - File: `src/js/generator/data-types.js`
  - Edge-case validation: multi-line vCard, special WiFi SSID/passwords, E.164 phone formats, Geo coordinate bounds.
  - Clean empty states without layout shift.
- **Scanner Ergonomics**:
  - File: `src/js/scanner/scanner.js`
  - Clipboard paste: Listen for global `paste` events containing image files when Scanner tab is active.
  - Drag & drop: Highlight drop zone on `dragenter` / `dragleave` counter without flickering.
  - Friendly error feedback for camera permissions (`NotAllowedError`, `NotFoundError`, `NotReadableError`).
- **Batch & History Resilience**:
  - Files: `src/js/generator/batch.js`, `src/js/generator/history.js`
  - Non-blocking batch processing with row-level error collection.
  - Quota-safe `localStorage` handling: auto-prune oldest non-favorite items if quota is exceeded.

## 6. Verification & Test Strategy
- Lint: `npm run lint` (0 errors).
- Typecheck: `npm run typecheck` (0 errors).
- Tests: `npm test` (all 58 files, 2184+ tests passing; add new tests for keyboard navigation, clipboard paste, throttled loop).
- Format: `npm run format:check` (0 issues).
- Build: `npm run build` (esbuild JS + CSS).
- PWA / CSP Check: `node tools/check-sw.mjs` (0 errors).
