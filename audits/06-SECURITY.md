# Security Audit

Re-audited: 2026-09-19. This supersedes the 2026-07-18 snapshot, whose line
references predate the module refactor into `src/js/generator/`,
`src/js/scanner/`, and `src/js/ui/`.

Scope: the full codebase — this project is not a git repository, so there is
no branch diff; all current source was audited as-is (`src/js/**`,
`index.html`, `sw.js`, `manifest.json`, `serve.json`, `tools/*.mjs`).
Excluded: `dist/` build output, `src/lib/` vendored libraries, `tests/`,
`audits/`, font assets.

Method: seven parallel category passes (input validation & injection;
authentication & authorization; crypto & secrets; code execution & XSS; data
exposure; concurrency & state; trust boundaries). Each candidate had to pass
a false-positive filter (>=8/10 confidence) and a concrete exploit-scenario
pass before being reported.

## Result

No CRITICAL, HIGH, or MEDIUM vulnerabilities found. Two candidates were
raised during the passes and rejected by validation:

### C1. Share URLs carry the QR payload in the query string — share.js:101-102, 169
`encodeStateToUrl` percent-encodes `dataString` — which can be a Wi-Fi
password (`WIFI:S:...;P:...;;`), vCard PII, or a crypto address — into
`?type=...&data=...`, then assigns it to `url.search`. Opening the link sends
the payload to the static host. Rejected: a link that reopens the exact
design inherently carries the QR content, and a recipient can read the same
data by scanning the QR, so this is a privacy hardening gap rather than an
exploitable vulnerability. Hardening implemented 2026-09-19: `encodeStateToUrl`
writes every param to the URL fragment and clears the query (`share.js`), so
payloads no longer reach the static host's access logs; the decoder still
falls back to the query for older links.

### C2. Shared-link `logo` parameter accepts a remote https URL — share.js:339
Decoded logos allow `allowHttp: true` (`utils.js:209-212`), are persisted in
state, and render as an SVG `<image href>` (`generator/logo.js:83`) inserted
via `generator/generator.js:905`, so opening a crafted link issues a blind
cross-origin GET (victim IP/UA/referer) and re-fires from persisted state.
Rejected: remote logo URLs are an intentional, user-facing feature
(`controls.js:266-275`) with an explicit "Remote logo" warning when entered
manually (`controls.js:382-383`), CSP permits `img-src https:` by design
(`index.html:6`), and the primitive yields no response access, script
execution, or allow-list bypass. Hardening implemented 2026-09-19: a remote
logo decoded from a shared link is applied only after the recipient confirms
(`confirmRemoteLogo`, `share.js`); bitmap data URLs still apply without
prompting, and when a prompt cannot be shown the fetch is denied by default.

## Prior findings — current status

| ID | Finding | Status |
|----|---------|--------|
| SEC1 | SVG logo bypass via MIME/extension spoofing | Fixed — `controls.js:344-356` rejects `.svg` case-insensitively, `image/svg+xml`, and re-validates the data URL after read (`isSafeLogoDataUrl`, `controls.js:266-275`) |
| SEC2 | CSP `script-src 'unsafe-inline'` | Fixed — `index.html:6` pins the three inline scripts with SHA-256 hashes; scripts no longer allow `'unsafe-inline'` |
| SEC3 | Custom mask path injected into SVG | Fixed — `sanitizeMaskPath` (`utils.js:60-65`) strips everything except path-data tokens; applied at `share.js:302` and `generator/mask.js:190` |
| SEC4 | `javascript:` URLs in scan history/result links | Fixed — `getSafeHttpUrl` (`scanner/history.js:6-17`) returns only parsed http(s) URLs; used by history (`history.js:34`) and result (`result.js:67`) |
| SEC5 | `encodeURIComponent` on crypto address | No action — correct URL encoding for the address formats supported |
| SEC6 | No generation rate limiting | Excluded — resource-exhaustion class, out of scope |
| SEC7 | Plaintext `localStorage` for user data | Accepted — local-only storage of the user's own data, standard for client-side apps |
| SEC8 | No MIME validation for uploaded scan images | Fixed — `scanner/scanner.js:839-843` enforces `ALLOWED_SCAN_IMAGE_TYPES` plus the 15 MB size cap |

## Hardening verified in place

- CSP: hashed `script-src`, `frame-ancestors 'none'`, `base-uri 'self'`,
  `connect-src 'self'` (`index.html:6`)
- Scanned content is assigned via `textContent`/`value` and escaped in history
  markup (`escapeHTML`, `utils.js:19-21`); `Visit`/`Open` links go through
  `getSafeHttpUrl`
- Uploads: logo bitmap allow-list plus post-read data-URL check; scan images
  MIME- and size-capped
- Share decode: enum allow-lists, single-value params to block parameter
  pollution (`share.js:199-210`), numeric clamping, `sanitizeMaskPath`,
  bitmap/http image allow-list
- Frame text is escaped before SVG interpolation
  (`generator/frame.js:53, 141`)
- No `eval`, `new Function`, or string-argument timers; vendored scripts load
  only fixed local paths (`lib-loader.js`; callers `ui/tabs.js:12`,
  `generator/encoder.js:5`)
