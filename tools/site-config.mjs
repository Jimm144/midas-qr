// @ts-check
/**
 * Canonical public URL of the deployed app — the single source every
 * absolute URL (canonical, og:, twitter:, JSON-LD, sitemap, robots) must use.
 *
 * Default: the GitHub Pages project site for this repo. Override per
 * environment with SITE_URL, e.g. `SITE_URL=https://example.com/ npm run build`.
 * tools/check-placeholders.mjs fails the build when a shipped file disagrees.
 */
const fromEnv = (process.env.SITE_URL || "").trim();
const base = fromEnv || "https://jimm144.github.io/midas-qr/";
export const SITE_URL = base.endsWith("/") ? base : base + "/";
