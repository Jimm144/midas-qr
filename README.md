# Midas QR

[![Deploy to GitHub Pages](https://github.com/Jimm144/midas-qr/actions/workflows/pages.yml/badge.svg)](https://github.com/Jimm144/midas-qr/actions/workflows/pages.yml)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](./LICENSE)

**A free QR code generator and scanner that runs entirely in your browser.** No account, no ads, no tracking — nothing you type or scan ever leaves your device, and it keeps working with no internet connection.

### [Open Midas QR →](https://jimm144.github.io/midas-qr/)

| Desktop | Mobile |
| --- | --- |
| <img src="docs/screenshots/generator-desktop.png" width="620" alt="Midas QR on desktop: content options on the left, live preview on the right"> | <img src="docs/screenshots/generator-mobile.png" width="230" alt="Midas QR on a phone"> |

## Make a code for anything

URLs, plain text, Wi‑Fi logins, contact cards (vCard), crypto addresses, locations, calendar events, SMS, phone numbers, and email.

## Design it your way

- **Dot shapes** — square, rounded, extra rounded, classy, or dots
- **Corner styles** — pick how the three finder squares and their centres are shaped
- **Colors** — solid colors or smooth linear/radial gradients, with presets and a hue slider
- **Overall shapes** — circle, heart, triangle, star, diamond, hexagon, shield, or your own SVG path
- **Frames** — label, badge, dashed, or rounded, with a caption of your choice
- **Background images** and **logo overlays** that keep the code scannable

## Get it out

Download as **PNG, SVG, JPEG, WebP**, or **TXT** (Unicode block art), copy it straight to the clipboard, or make hundreds at once from a **CSV / TSV / TXT** file — one code per row.

## Scan as easily as you generate

Point your camera at a code or drop in an image. Scanning runs in the background, so the app stays smooth, and results appear with quick actions (open, copy, search). Your recent scans and designs live in a local history you can search and re-run.

## Nice touches

- Seven color themes, in light, dark, or auto
- Simple, Medium, and Full layouts — show only as many options as you want
- Share links that reopen the exact same design
- Keyboard shortcuts: `Ctrl/⌘+S` save, `Ctrl/⌘+C` copy, `R` re-render
- Installable as an app and fully offline after the first visit

## Privacy

No accounts, no analytics, no third-party CDNs, and no network requests. Your text, Wi‑Fi passwords, addresses, logos, and scans stay in your browser; history is kept in local storage and is never uploaded anywhere.

## Install it like an app

Open [the app](https://jimm144.github.io/midas-qr/) in a modern browser and choose **Install** / **Add to Home Screen**. On desktop, look for the install icon in the address bar. After that it opens like any other app and works offline.

Camera scanning needs a secure (`https`) connection — the hosted app provides one.

## Run it yourself

```bash
npm install
npm run build   # bundles the app and checks the offline layer
npm start       # serves it at http://localhost:5000
```

| Command                 | What it does                                         |
| ----------------------- | ---------------------------------------------------- |
| `npm start`             | Serve the built app on port 5000                     |
| `npm run dev`           | Build, then serve                                    |
| `npm run build`         | Bundle JS/CSS and validate the offline layer         |
| `npm test`              | Run the test suite                                   |
| `npm run lint`          | Lint the source                                      |
| `npm run typecheck`     | Type-check the typed modules                         |

Contributions are welcome — run `npm run lint`, `npm run typecheck`, and `npm test` before opening a pull request.

## License

GPL-3.0 — see [LICENSE](./LICENSE). Bundled typefaces are SIL OFL 1.1; frame icons are Lucide (ISC). Full notices: [THIRD-PARTY-NOTICES.txt](./THIRD-PARTY-NOTICES.txt) and the in-app **Credits** dialog.
