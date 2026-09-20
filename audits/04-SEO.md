# SEO Audit

## HIGH

### S1. Canonical URL references placeholder domain (index.html line 10, 404.html line 10, sitemap.xml passim)
`<link rel="canonical" href="https://qr-code-studio.example/">` — the domain
`qr-code-studio.example` is a placeholder. All OG tags, Twitter tags, JSON-LD,
sitemap, and robots.txt reference this domain. If the app is deployed to a
different domain, every SEO signal will point to the wrong location.

**Fix:** Set the canonical domain at build time or inject via environment
variable.

### S2. Screenshot in JSON-LD and manifest is the app icon (512x512 PNG)
The `screenshot` field in JSON-LD and the manifest's `screenshots[0]` both
point to `icon-512x512.png`. This is just the app icon, not a meaningful
screenshot of the UI. Google Play / Chrome Web Store require actual app
screenshots for rich install prompts.

**Fix:** Add real UI screenshots (e.g., `screenshot-generator.png`,
`screenshot-scanner.png`) at 1280x720 or 1920x1080.

### S3. Meta description is cut off in search results (HTML lines 6, 18, 24)
The meta description is 219 characters for the primary description: "QR Code
Studio — a free, offline, privacy-first QR code generator and scanner. Create
custom QR codes with colors, shapes, frames, logos, and error correction. Scan
QR codes via webcam or image upload. No data collection, no ads, no tracking."
The OG description is 158 chars. The Twitter description is 141 chars. All are
within Google's limits (~160 chars for desktop, ~120 chars for mobile).
However, the primary meta description at 219 chars _will_ be truncated on
mobile.

**Fix:** Trim the primary meta description to 150 characters. Put the most
important keywords first: "Free offline QR code generator and scanner with
custom colors, shapes, logos, and webcam scanning. No ads, no tracking,
no data collection."

## MEDIUM

### S4. No `hreflang` tags for international users
The app is English-only and has `lang="en"` on `<html>`. If the app ever
supports multiple languages, `hreflang` tags will be needed. Not a current
issue, but worth noting for future.

### S5. JSON-LD `featureList` is an array in string form, not schema.org `featureList` (HTML lines 814-823)
`featureList` is not a standard schema.org property for `WebApplication`. The
correct property would be `featureList` (used by Google) or described via
`description`. However, Google does seem to recognize `featureList` on
`WebApplication` — this might work but is non-standard.

**Fix:** Move features into `description` or use the `featureList` property
as intended but verify with Schema.org validator.

### S6. Sitemap has only one URL (sitemap.xml)
The sitemap contains only the root URL. For a single-page application, this
is acceptable. But if the app relies on hash fragments for navigation
(`#generator`, `#scanner`, `#history`), those are not indexed by search engines.
Consider using the History API for real URLs if SEO for sub-pages matters.

### S7. No `article:` or `profile:` OG tags for content sharing
When users share a generated QR code config via the "COPY SHARE LINK" button,
the shared URL has no OG tags. Social media crawlers see only the generic
`og:image` (icon-512x512.png) and generic description. The shared URL could
benefit from dynamic OG tags that describe the QR code type.

**Fix:** Generate dynamic OG meta tags in the shared URL's HTML via
server-side rendering or a proxy service (complex). For now, this is a known
limitation of a purely client-side SPA.

## LOW

### S8. `<title>` uses `&amp;` entity (HTML line 12)
"Free Offline QR Code Generator &amp; Scanner" — the `&amp;` is correct HTML
and renders as `&`. No issue, just noting.

### S9. No `keywords` meta tag (intentional, Google ignores it)
This is correct — `keywords` meta tag is not used by Google and is omitted
intentionally. Good.

### S10. 404 page has `noindex,follow` but no sitemap entry
Correct — 404 pages should not be indexed.
