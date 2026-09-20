# QR Code Studio — Full Codebase Audit Index

Generated: 2026-07-18
Files audited: 15 JS/TS source files, 1 HTML, 1 CSS, 1 SW, 1 manifest, 1 serve.json

## File Inventory

| # | File | Lines | Description |
|---|------|-------|-------------|
| 1 | `src/js/main.js` | 744 | App init, event wiring, keyboard shortcuts |
| 2 | `src/js/state.ts` | 359 | Global state, persistence, serialization |
| 3 | `src/js/share.js` | 159 | URL serialization/deserialization |
| 4 | `src/js/utils.js` | 38 | Pure utility functions |
| 5 | `src/js/generator/generator.js` | 530 | QR generation, sync, validation |
| 6 | `src/js/generator/export.js` | 487 | SVG/PNG export, masks, frames |
| 7 | `src/js/generator/formatters.js` | 227 | QR payload formatters |
| 8 | `src/js/generator/history.js` | 127 | Generator history CRUD |
| 9 | `src/js/scanner/scanner.js` | 635 | QR scanning (upload + webcam) |
| 10 | `src/js/scanner/worker.js` | N/A | Web Worker for jsQR |
| 11 | `src/js/ui/color-picker.js` | 495 | Color picker dialog |
| 12 | `src/js/ui/components.js` | 114 | Custom select/dropdown |
| 13 | `src/js/ui/dom.js` | 153 | DOM element cache |
| 14 | `src/js/ui/modal.js` | 69 | Modal focus trap |
| 15 | `src/js/ui/tabs.js` | 183 | Tab navigation |
| 16 | `index.html` | 877 | Main HTML document |
| 17 | `src/css/style.css` | 559 | Custom styles |
| 18 | `sw.js` | 108 | Service worker |
| 19 | `404.html` | 43 | 404 page |
| 20 | `manifest.json` | 62 | PWA manifest |

## Audit Files

| File | Focus |
|------|-------|
| `01-BUGS.md` | Runtime bugs, logic errors, edge-case crashes |
| `02-ACCESSIBILITY.md` | ARIA, keyboard nav, screen reader, focus management |
| `03-UX-UI.md` | Visual design, interaction patterns, mobile, usability |
| `04-SEO.md` | Structured data, meta tags, crawlability |
| `05-CODE-QUALITY.md` | Architecture, duplication, type safety, maintainability |
| `06-SECURITY.md` | XSS, CSP, input sanitization, data safety |
| `07-PERFORMANCE.md` | Rendering, memory, bundle size, caching |
| `08-PRIORITIES.md` | Consolidated ranked priorities across all audits |
