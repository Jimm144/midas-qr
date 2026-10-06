# Midas QR

A QR code generator and scanner that runs entirely in the browser. It works offline and sends nothing to a server.

### [Open the app](https://jimm144.github.io/midas-qr/)

| Desktop                                                                                                                                                | Mobile                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| <img src="docs/screenshots/generator-desktop.png" width="620" alt="Generator view with content options on the left and the live preview on the right"> | <img src="docs/screenshots/generator-mobile.png" width="230" alt="The same app on a phone"> |

## Features

**Content types** — URL, text, Wi-Fi, contact (vCard), crypto address, geolocation, calendar event, SMS, phone number, email.

**Styling** — dot shapes (square, rounded, extra rounded, classy, dots); corner styles for the finder squares and their centres; solid colors or linear/radial gradients; overall shapes (circle, heart, triangle, star, diamond, hexagon, shield, or a custom SVG path); frames (label, badge, dashed, rounded) with captions; background images; logo overlays.

**Output** — PNG, SVG, JPEG, WebP, and TXT (Unicode block art); copy to clipboard; batch generation from a CSV, TSV, or TXT file, one code per row.

**Scanning** — webcam or image upload, decoded in a Web Worker. Results can be opened, copied, or searched, and scanned codes are kept in a local history.

**App** — seven color themes (light, dark, or auto); share links that reopen the current configuration; keyboard shortcuts (`Ctrl/⌘+S` save, `Ctrl/⌘+C` copy, `R` re-render); installable PWA that works offline.

## Privacy

No accounts, no cookies, no third-party CDNs. Page views are counted by Open Domains analytics, which sets no cookies and honours Do Not Track — that is the only network request. Text, Wi-Fi passwords, addresses, logos, and scans stay in the browser, and history is stored in local storage.

## Install

Open the app in a browser and choose **Install** / **Add to Home Screen**. Camera scanning requires a secure (`https`) connection.

## Development

```bash
npm install
npm run build   # bundles JS and CSS, validates the offline layer
npm start       # serves the app on http://localhost:5000
```

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm start`         | Serve the built app on port 5000             |
| `npm run dev`       | Build, then serve                            |
| `npm run build`     | Bundle JS/CSS and validate the offline layer |
| `npm test`          | Run the test suite                           |
| `npm run lint`      | Lint the source                              |
| `npm run typecheck` | Type-check the typed modules                 |

Run `npm run lint`, `npm run typecheck`, and `npm test` before opening a pull request.

## Deployment

Deploys to GitHub Pages from `main` (`.github/workflows/pages.yml`): lint, typecheck, tests, placeholder/CSP checks, `npm run build`, then `tools/build-pages.mjs` stages the runtime-only `site/` artifact (tests, tools, configs and `node_modules` never ship).

Notes:

- `serve.json` headers apply only to hosts that honour them (local `serve`, Vercel-style static hosting). **GitHub Pages ignores `serve.json` entirely**, so the `<meta>` Content-Security-Policy in `index.html` / `404.html` is the enforced policy on Pages — keep all three in agreement with `node tools/csp-hashes.mjs` (CI verifies with `--check`).
- Absolute SEO URLs (canonical, `og:`, `twitter:`, JSON-LD, sitemap, robots) use the single `SITE_URL` in `tools/site-config.mjs` (default `https://jimm144.github.io/midas-qr/`, overridable via the `SITE_URL` env var). `node tools/check-placeholders.mjs` fails the build on placeholder leftovers.
- Versioned assets (`dist/bundle.js`, `src/css/style.min.css`, `favicon.svg`) ship `?v=<content-hash>` stamped by `tools/stamp-assets.mjs` and served immutable; `index.html` / `404.html` are short-cached. The service worker (`sw.js`) precaches the shell + versioned bundle and lazily caches fonts/libraries at runtime.

## License

GPL-3.0 — see [LICENSE](./LICENSE). Bundled typefaces are SIL OFL 1.1; frame icons are Lucide (ISC). Full notices: [THIRD-PARTY-NOTICES.txt](./THIRD-PARTY-NOTICES.txt) and the in-app **Credits** dialog.
