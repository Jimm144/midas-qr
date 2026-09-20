# QR Code Studio — Agent Notes

## Persistent Mode (Token Saver)
When writing ANY artifacts, documentation, or lists, use the most compressed notation possible (shorthand, bullet-point mapping). No verbose sentences.

## Commands (run after every code change)
- Build: `npm run build` (esbuild JS → dist/bundle.js, tailwind → output.css)
- Lint: `npm run lint` (ESLint flat config, eslint.config.js). `npm run lint:fix` auto-fixes.
- Format: `npm run format:check` (Prettier, .prettierrc). `npm run format` writes.
- Typecheck: `npm run typecheck` (tsc --noEmit, tsconfig.json, allowJs, strict). Must exit 0.
- Tests: `npm test` (Vitest + jsdom). `npm run test:watch` / `npm run test:coverage`.
- Serve: `npm start` (port 5000).

## Stack
- Vanilla JS/TS SPA, esbuild bundle, Tailwind v4.
- TS migration incremental: state.ts converted; other modules still .js with allowJs.
- Ambient globals (QRCodeStyling, qrcode, jsQR) declared in src/types/globals.d.ts.
- Pure testable logic: src/js/utils.js, src/js/generator/formatters.js. Tests in tests/.

## File layout (key)
- src/js/state.ts — typed global state + themes + framesConfig.
- src/js/main.js — initApp() orchestrates cohesive init*() functions (module scope).
- src/js/generator/{generator,export,history,formatters}.js
- src/js/scanner/{scanner,worker}.js
- src/js/ui/{dom,components,tabs,color-picker,modal}.js
- src/js/utils.js — shared pure helpers (escapeHTML, escapeWifiStr, escapeVCard).
- sw.js — service worker (cache name bumped to v67).