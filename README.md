# Midas QR

A premium, **offline-first**, privacy-respecting QR code generator and scanner. It runs in the browser, installs as a PWA, collects no data, and works without a network connection once loaded.

## Features

- **Generate** QR codes from URLs, text, Wi-Fi, contacts (vCard), crypto addresses, geolocation, calendar events, SMS, phone numbers, and email (mailto).
- **Customize** colors (solid or linear/radial gradient with a hue slider and presets), dot/corner shapes, overall masks (circle, heart, triangle, star, diamond, hexagon, shield, custom SVG path), frames (scanner, dashed, rounded, bubble, label, badge, arrow), background images, and logo overlays.
- **Batch** generate one QR code per row from a CSV file — the first column of each non-empty row is encoded and exported in the currently selected format.
- **Export** to PNG, SVG, JPEG, WebP, and TXT (Unicode block art), or download the whole generator history at once.
- **Scan** via webcam or image upload — decoding runs in a Web Worker so the UI stays responsive.
- **History** of generated and scanned codes (filterable, persisted to `localStorage`).
- **Themes**: neutral, stone, matcha, gothic, y2k, butter, chocolate — in auto/dark/light modes.
- **Shareable URLs**: any configuration can be encoded into the URL bar.
- **Keyboard shortcuts**: Ctrl/⌘+S saves the design, Ctrl/⌘+C copies the QR, R re-renders the preview (a hint is shown in the footer).
- **PWA**: installable, offline service worker, app shortcuts.

## Quick start

```bash
npm install
npm run build   # check-sw + produces dist/bundle.js and src/css/style.min.css
npm start       # serves on http://localhost:5000
```

For development with watch mode:

```bash
npm run dev
```

## Scripts

| Script                  | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| `npm run build`         | Validate the offline layer, then bundle/minify JS (esbuild) and minify CSS. |
| `npm run check:sw`      | Run `tools/check-sw.mjs` alone (SW syntax, precache paths, CSP hashes).     |
| `npm start`             | Serve the built site on port 5000.                                          |
| `npm run dev`           | Build, then serve on port 5000.                                             |
| `npm test`              | Run the vitest suite (jsdom environment).                                   |
| `npm run test:watch`    | Run vitest in watch mode.                                                   |
| `npm run test:coverage` | Run tests with V8 coverage.                                                 |
| `npm run lint`          | ESLint on `src/js`.                                                         |
| `npm run lint:fix`      | ESLint with `--fix`.                                                        |
| `npm run typecheck`     | `tsc --noEmit` — checks `state.ts` and any `// @ts-check` files.            |
| `npm run format`        | Prettier write over JS/TS and root JSON/Markdown.                           |
| `npm run format:check`  | Prettier check (CI-equivalent).                                             |

## Architecture

The app is a single-page vanilla-JS/TS module graph, bundled by esbuild into `dist/bundle.js`. Three vendored libraries ship locally under `src/lib/` (no CDN) so the app is genuinely offline:

- `qr-code-styling.min.js` — styled QR rendering.
- `qrcode.min.js` — low-level QR matrix (lazily loaded for masks, frames, and TXT export).
- `jsqr.min.js` — QR decoding, loaded inside a Web Worker.

Module layout under `src/js/`:

- `state.ts` — single source of truth for state + persistence (schema-versioned under `qr_state_v1`, logo under `qr_logo_v1`). `frames.ts` and `themes.ts` are typed config modules; the rest of the graph is plain JS with `// @ts-check` where it matters.
- `generator/` — `generator.js` (render orchestration), `formatters.js` (pure payload builders), `inputs.js`, `controls.js`, `background.js` (background image), `mask.js` (overall shape masks), `frame.js`, `batch.js` (CSV batch export), `export.js` (SVG/canvas export), `history.js`, `qr-instance.js`, `encoder.js`, `render-info.js`.
- `scanner/` — `scanner.js` (UI + worker bridge, lazily initialized on first scanner-tab open), `worker.js`, `result.js`, `history.js`.
- `ui/` — `dom.js`, `components.js` (custom selects), `tabs.js`, `modal.js` (focus traps), `color-picker.js` (spectrum + hue slider + gradients), `datetime-picker.js`, `searchable-select.js`, `shell.js` (section accordions), `announce.js`, `toast.js`.
- `theme-runtime.js`, `themes.ts`, `frames.ts`, `constants.js` — theming, frame definitions, and shared limits.
- `share.js` — URL encode/decode with validation + clamping.
- `pwa.js`, `lib-loader.js`, `utils.js`, `main.js` — bootstrap, install prompt, and offline library loading.

### Complexity modes

The header has a **SIMPLE / MEDIUM / FULL** selector (`complexity-select`) that toggles how many configuration options are visible. FULL exposes every option; SIMPLE hides the entire config panel.

## Persistence & privacy

State is written to `localStorage` under `qr_state_v1` (key is versioned so it can be migrated). The schema includes:

- `generatorHistory` (max 50 items), `scanner.history` (max 20 items).
- A snapshot of the generator config + input field values.

Logo data URLs can be large; the persistence layer auto-evicts oversized logo-bearing history entries on quota failure. **No telemetry, no network requests, no third-party CDNs.**

## Offline layer & cache versions

`sw.js` precaches the app shell and serves same-origin assets stale-while-revalidate. Two version markers must move together on every shipped change:

- `CACHE_NAME` in `sw.js` (for example `midas-qr-v150`) — a fresh cache name makes the service worker install as a new version instead of mutating the cache users already have.
- The stylesheet query in **both** `index.html` and `sw.js` (`src/css/style.min.css?v=73`) — versioned precache entries guarantee the first controlled load gets the new CSS.

`npm run build` runs `tools/check-sw.mjs` first, which fails the build if the two stylesheet versions drift, a precache path is missing on disk, an inline script hash no longer matches its meta CSP, or the HTML tags no longer balance. Always bump the cache name and the CSS query together, then re-run the build.

## Security notes

- A strict CSP is shipped both as a `<meta>` tag and via `serve.json` headers.
- Logo inputs accept only bitmap images — `data:image/svg` and SVG file uploads are rejected to prevent script execution via exported SVG QR codes.
- All share-URL parameters are validated and clamped on decode; crafted URLs can't push the generator into a broken state.
- Crypto addresses are validated against per-coin shape rules (`bitcoin`, `ethereum`, `litecoin`, `bitcoincash`, `dash`, `monero`) to catch wrong-coin mistakes before a QR is generated. Validation is a sanity check, **not** a guarantee of address validity — always double-check before sending funds.

## Browser support

Requires a modern browser with ES2020, Web Workers, `ClipboardItem`, and `MediaDevices`. iOS Safari install is supported via the manifest; iOS doesn't follow `display_override`.

## Contributing

Run `npm run lint`, `npm run typecheck`, and `npm test` before submitting changes — CI-equivalent checks. `npm run build` additionally validates the service worker, manifest paths, and CSP hashes. Keep the brutalist visual identity; don't re-add a global `text-transform: uppercase` (it breaks case-sensitive fields like crypto addresses and Wi-Fi passwords).

## License

GPL-3.0 — see [LICENSE](./LICENSE). Third-party library notices are in [THIRD-PARTY-NOTICES.txt](./THIRD-PARTY-NOTICES.txt) and the in-app Credits dialog.

### Bundled typefaces

All self-hosted typefaces used by the themes and the frame-text font picker — Figtree, Montserrat, DM Sans, Playwrite US Trad, Fustat, Poppins, Outfit, Albert Sans, Fraunces, JetBrains Mono, UnifrakturMaguntia, Inter, Space Grotesk, Bebas Neue, Anton, Archivo Black, Merriweather, Lora, and Space Mono — are licensed under the SIL Open Font License 1.1 (latin subsets only, no italics). License texts ship with the fonts under `src/fonts/licenses/` (Figtree's is `src/fonts/OFL.txt`), and the same families are listed in the in-app Credits dialog.

### Frame artwork licensing

The built-in frame styles are drawn as SVG geometry in `src/js/frames.ts`; the arrow is a straight shaft (a `<rect>`) and a solid triangular head (a `<path>` of straight segments) placed beside the QR area. The frame-style picker icons in `index.html` vend Lucide artwork **verbatim** (for example `panel-bottom` for Label, `panel-top` for Badge, and `arrow-right` for Arrow). Lucide is licensed under the [ISC License](https://github.com/lucide-icons/lucide/blob/main/LICENSE), Copyright (c) Lucide Contributors (portions derived from Feather are MIT, Copyright (c) Cole Bemis); the in-app Credits dialog carries the same notice. When adding icons or frame artwork, the same rule applies: vendor the original SVG paths unchanged, record the source repository, license, and author in the Credits dialog, and never use artwork whose license is unclear or restricted to personal use.
