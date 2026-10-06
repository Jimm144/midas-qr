// @ts-check
/**
 * Fail the build when placeholder URLs or REPLACE-ME markers survive in
 * shipped files, and when an absolute URL disagrees with tools/site-config.mjs.
 *
 * The old placeholder (https://midasqr.is-local.org/) shipped in canonical,
 * og:, twitter:, JSON-LD, robots, sitemap, manifest and 404 markers. Absolute
 * SEO URLs must all equal SITE_URL; nothing else may look like a placeholder.
 */
import fs from "node:fs";
import { SITE_URL } from "./site-config.mjs";

const SHIPPED = [
  "index.html",
  "404.html",
  "manifest.json",
  "robots.txt",
  "sitemap.xml",
  "serve.json",
  "README.md",
];

const FORBIDDEN = ["midasqr.is-local.org", "is-local.org", "REPLACE-ME", "__SITE_URL__", "_placeholder"];

// Absolute URLs that are intentionally third-party (never the placeholder).
const THIRD_PARTY_PREFIXES = [
  "https://analytics.open-domains.com",
  "https://schema.org",
  "http://www.sitemaps.org",
  "https://www.sitemaps.org",
  "https://github.com",
];

const problems = [];

for (const file of SHIPPED) {
  let src;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch (err) {
    problems.push(`${file}: cannot read (${err.message})`);
    continue;
  }
  for (const token of FORBIDDEN) {
    if (src.includes(token)) problems.push(`${file}: contains placeholder token "${token}"`);
  }
}

// Every absolute SEO URL (canonical, social, structured data, sitemap) must be
// the configured SITE_URL or a declared third-party origin. Plain content
// links (credits, docs) are out of scope: third-party references there are
// legitimate content, not deployment configuration.
const SEO_RE =
  /(?:rel="canonical"[^>]*href=|property="og:(?:url|image)"[^>]*content=|name="twitter:image"[^>]*content=|"(?:url|screenshot|item)"\s*:\s*|Sitemap:\s*|<loc>)"?(https?:\/\/[^"<\s]+)/g;
for (const file of ["index.html", "404.html", "robots.txt", "sitemap.xml"]) {
  const src = fs.readFileSync(file, "utf8");
  for (const match of src.matchAll(SEO_RE)) {
    const url = match[1].replace(/["',;]+$/, "");
    const ok = url.startsWith(SITE_URL) || THIRD_PARTY_PREFIXES.some((prefix) => url.startsWith(prefix));
    if (!ok) problems.push(`${file}: absolute URL is not SITE_URL (${SITE_URL}): ${url}`);
  }
}

if (problems.length) {
  console.error("placeholder check FAILED:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`site URL OK (${SITE_URL}, ${SHIPPED.length} files clean)`);
