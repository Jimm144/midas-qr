# QR Code Studio — Consolidated Priorities

This file ranks all findings across bugs, accessibility, UX/UI, SEO, code
quality, security, and performance by estimated impact × effort.

## P0: SHIP-BLOCKING (fix before next deploy)

| ID | Finding | Domain | File | Effort |
|----|---------|--------|------|--------|
| B2 | cameraSwitchPending never resets on error | Bug | scanner.js:63 | 15min |
| B4 | Margin block never unblocks when margin reduced | Bug | generator.js:394 | 10min |
| B1 | Undo toast accumulates click listeners | Bug | history.js:66 | 15min |
| B3 | Upload image timeout can race with onload | Bug | scanner.js:497 | 10min |
| B5 | ECC tooltip off-screen on mobile | Bug | generator.js:397 | 15min |

## P1: HIGH IMPACT (next iteration)

| ID | Finding | Domain | File | Effort |
|----|---------|--------|------|--------|
| A2 | Skip link targets wrong/absent heading | A11y | main.js:75 | 15min |
| A1 | Theme contrast may fail WCAG AA | A11y | state.ts | 30min |
| A4 | ECC tooltip not touch-accessible | A11y | style.css:203 | 30min |
| U1 | No loading cancel for long generations | UX/UI | generator.js:334 | 1hr |
| U2 | No history search/filter | UX/UI | scanner/generator | 2hr |
| C1 | No TypeScript for 14/15 JS files | Quality | all JS | 4hr+ |
| C4 | main.js 744 lines, too many concerns | Quality | main.js | 2hr |
| P2 | SVG blob created/discarded on every generation | Perf | generator.js:450 | 2hr |
| P3 | Canvas buffer re-queried from DOM every frame | Perf | scanner.js:433 | 15min |
| SEC4 | javascript: URLs not stripped in scan history — RESOLVED (06-SECURITY.md) | Security | scanner.js:274 | 15min |
| SEC2 | CSP `unsafe-inline` weakens XSS protection — RESOLVED (06-SECURITY.md) | Security | index.html | 1hr |

## P2: MEDIUM IMPACT (next milestone)

| ID | Finding | Domain | File | Effort |
|----|---------|--------|------|--------|
| B6 | Scanner webcam mirror check fragile | Bug | scanner.js:341 | 30min |
| B7 | QR instance caches stale config | Bug | generator.js:21 | 30min |
| B8 | Large logo history items silently removed | Bug | history.js:9 | 15min |
| A3 | aria-describedby points to hidden warnings | A11y | HTML | 30min |
| A5 | Drop zone focus lost after file picker | A11y | scanner.js | 15min |
| A7 | Color picker closes on any document click | A11y | color-picker.js:482 | 30min |
| U4 | Hex input no validate feedback on blur | UX/UI | color-picker.js:369 | 15min |
| U5 | Export filename doesn't show default | UX/UI | export.js:402 | 10min |
| U6 | Margin warning no suggested fix | UX/UI | generator.js:394 | 10min |
| U10 | Scanner reticle no visual feedback | UX/UI | scanner.js | 1hr |
| S1 | Canonical URL has placeholder domain | SEO | index.html + everywhere | build-time |
| S2 | Screenshot is app icon not UI | SEO | manifest.json | 30min |
| S3 | Meta description too long for mobile | SEO | index.html:6 | 5min |
| C5 | export.js 487 lines, too many concerns | Quality | export.js | 2hr |
| C10 | No global unhandledrejection handler | Quality | main.js | 10min |
| C16 | Cross-domain import between scanner/generator | Quality | scanner.js imports history.js | 15min |
| C12 | Multiple redundant QR generations during sync | Quality | generator.js:235 | 30min |
| C13 | Burst of generations on page load | Quality | state.ts:140 | 30min |
| P1 | text-xs font-bold on every element bloats HTML | Perf | HTML (~100 elements) | 1hr |
| P5 | Debounce 300ms is sluggish | Perf | generator.js:529 | 5min |
| P8 | scanTick runs in background tabs | Perf | scanner.js:427 | 30min |

## P3: LOWER IMPACT (backlog)

| ID | Finding | Domain | File | Effort |
|----|---------|--------|------|--------|
| B9 | prefers-reduced-motion kills all animations | Bug | style.css:265 | 30min |
| B10 | jsQR status check after lazy load | Bug | tabs.js:97 | 15min |
| B11 | historyItem idx accessed as string | Bug | scanner.js:229 | 5min |
| B12 | mouseup listener never removed | Bug | color-picker.js:321 | 10min |
| B13 | undoData stale reference after timeout | Bug | history.js:51 | 5min |
| B14 | fields object accumulates stale entries | Bug | state.ts:129 | 10min |
| B15 | Stale cachedG from old-format history | Bug | history.js:110 | 15min |
| A6 | Color preset focus invisible on light themes | A11y | HTML/color-picker.js | 15min |
| A8 | aria-hidden may drift from visible state | A11y | tabs.js:62 | 15min |
| A10 | Announcements region race condition | A11y | main.js:79 | 15min |
| A11 | Modal trap stack not maintained | A11y | modal.js:52 | 30min |
| A12 | Camera toggle button no aria-pressed | A11y | scanner.js:345 | 5min |
| A13 | QR SVG container no role="img" | A11y | HTML:535 | 5min |
| A14 | Body font-size 13px below recommended | A11y | style.css:13 | 5min |
| A15 | scan-result textarea no focus indicator | A11y | HTML:647 | 5min |
| U3 | Camera select shows fake options before grant | UX/UI | scanner.js:361 | 30min |
| U7 | Ctrl+C conflicts with system copy | UX/UI | main.js:120 | 15min |
| U8 | Frame text maxlength not enforced in JS | UX/UI | generator.js:301 | 5min |
| U9 | History LOAD no feedback | UX/UI | history.js:105 | 10min |
| U11 | SIMPLE mode may show full-only elements | UX/UI | generator.js | 15min |
| U12 | Clear all uses confirm() not undo toast | UX/UI | history.js:118 | 30min |
| U14 | Scanner CLEAR ALL no undo | UX/UI | scanner.js:171 | 15min |
| U15 | WiFi toggle aria-pressed initial state wrong | UX/UI | main.js:187 | 5min |
| U16 | Hidden toggle visual feedback poor | UX/UI | main.js:199 | 15min |
| U17 | No clear button on text inputs | UX/UI | HTML | 30min |
| S4-S10 | Various minor SEO issues | SEO | various | varies |
| C6 | generateQR manipulates UI directly | Quality | generator.js:344 | 4hr |
| C7 | configSignature deliberately excludes logo | Quality | generator.js:312 | 5min (doc) |
| C8 | Magic numbers scattered | Quality | ~10 files | 1hr |
| C9 | showUndoToast creates duplicate handlers | Quality | history.js:55 | 15min |
| C11 | Stale crossOrigin on QR instance | Quality | generator.js:33 | 15min |
| C14 | postMessage transferred buffer not nulled | Quality | scanner.js:460 | 5min |
| C15 | DOM object mutable without restriction | Quality | dom.js | 30min |
| C17 | ESLint rules weak | Quality | eslint.config.js | 30min |
| C18 | Test coverage gap for major files | Quality | vitest.config.js | 4hr+ |
| SEC1 | SVG bypass via case-insensitive extension — RESOLVED (06-SECURITY.md) | Security | main.js | 15min |
| SEC3 | Mask SVG path not sanitized — RESOLVED (06-SECURITY.md) | Security | generator.js:98 | 30min |
| SEC5-8 | Various minor security concerns — REVIEWED, no action required (06-SECURITY.md) | Security | various | varies |
| P4 | Export canvas loads SVG via Image() | Perf | export.js:341 | 1hr |
| P6 | No lazy update for history list | Perf | scanner.js:252 | 30min |
| P9 | Duplicate state save on tab close | Perf | state.ts:148 | 15min |
| P10 | Large logo serialized on every save | Perf | state.ts | 30min |
| P13 | Sequential library loading | Perf | HTML:792 | 5min |
| P14 | prefers-reduced-motion disables all transitions | Perf | style.css:265 | 15min |

## Summary

- **P0 items (5):** All bugs, estimated ~1 hour total
- **P1 items (13):** Mix of accessibility, UX, quality, performance, and
  security — estimated ~2-3 days
- **P2 items (18):** Broad improvements across all domains — estimated ~1 week
- **P3 items (30+):** Long tail of polish, testing, and hardening — estimated
  ~2-3 weeks

**Total estimated effort: ~4-6 weeks for a single developer working full-time.**
