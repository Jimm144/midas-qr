// @ts-check
/**
 * Single source for the Content-Security-Policy shipped in the HTML meta tags
 * and the serve.json header.
 *
 * The meta policy and the host header used to be hand-maintained in two
 * places, so the 4th inline-script hash lived in serve.json but not in
 * index.html's meta (and any rewording of an inline block silently desynced
 * them). This tool re-derives every inline <script> hash from the HTML files
 * and rewrites all three policies from one builder:
 *   - index.html meta: its own script hashes (+ analytics script origin)
 *   - 404.html meta: its own script hash (no analytics on the error page)
 *   - serve.json header: the union of both pages' hashes (+ analytics), the
 *     real enforcement policy wherever the host honors serve.json headers
 *     (GitHub Pages ignores serve.json — see the _note field there — so the
 *     meta tags are the enforced policy on Pages).
 *
 * Notes baked into the builder:
 *   - `object-src 'none'` (no plugins/embeds anywhere in the app).
 *   - `frame-ancestors 'none'` lives ONLY in the header: browsers ignore
 *     frame-ancestors in <meta>, so shipping it there is dead weight.
 *
 * Usage: `node tools/csp-hashes.mjs` rewrites; `--check` exits 1 on drift
 * (used by CI so a stale policy fails instead of shipping).
 */
import crypto from "node:crypto";
import fs from "node:fs";

const CHECK_ONLY = process.argv.includes("--check");

const ANALYTICS = "https://analytics.open-domains.com";

function inlineHashes(page) {
  const buf = fs.readFileSync(page);
  const out = [];
  let pos = 0;
  while (true) {
    const start = buf.indexOf(Buffer.from("<script"), pos);
    if (start < 0) break;
    const tagEnd = buf.indexOf(Buffer.from(">"), start);
    if (tagEnd < 0) break;
    const close = buf.indexOf(Buffer.from("</script>"), tagEnd);
    if (close < 0) break;
    const tag = buf.slice(start, tagEnd).toString("utf8");
    pos = close + 9;
    if (/\bsrc\s*=/.test(tag)) continue;
    // Hash the EXACT bytes the browser sees. Do NOT normalise CRLF -> LF here:
    // the CSP hash is computed over the raw script text as served, so
    // normalising makes the declared hash disagree with a CRLF working tree
    // (silently blocking every inline script).
    const bytes = buf.slice(tagEnd + 1, close);
    if (bytes.toString("utf8").trim().length === 0) continue;
    out.push("sha256-" + crypto.createHash("sha256").update(bytes).digest("base64"));
  }
  return out;
}

function scriptSrc(hashes, withAnalytics) {
  const parts = ["'self'", ...hashes.map((h) => `'${h}'`)];
  if (withAnalytics) parts.push(ANALYTICS);
  return `script-src ${parts.join(" ")}`;
}

/** Shared directives; frame-ancestors only where a header can enforce it. */
function policy(hashes, { analytics, header }) {
  const directives = [
    "default-src 'self'",
    scriptSrc(hashes, analytics),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    `connect-src 'self'${analytics ? " " + ANALYTICS : ""}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (header) directives.push("frame-ancestors 'none'");
  return directives.join("; ");
}

const indexHashes = inlineHashes("index.html");
const notFoundHashes = inlineHashes("404.html");
if (!indexHashes.length) throw new Error("index.html: no inline scripts found");
if (!notFoundHashes.length) throw new Error("404.html: no inline scripts found");

const indexPolicy = policy(indexHashes, { analytics: true, header: false });
const notFoundPolicy = policy(notFoundHashes, { analytics: false, header: false });
const headerPolicy = policy([...indexHashes, ...notFoundHashes], { analytics: true, header: true });

const problems = [];

// Guard: CSP hash sources MUST be single-quoted ('sha256-...'). An unquoted
// hash is treated as an invalid source and silently dropped, which blocks
// every inline <script> (the app then never boots). This exact mistake shipped
// once - keep the regression test cheap and loud.
for (const [name, pol] of [
  ["index.html", indexPolicy],
  ["404.html", notFoundPolicy],
  ["serve.json", headerPolicy],
]) {
  const bareHashes = pol.match(/(?<!')sha256-/g);
  if (bareHashes) {
    problems.push(
      `${name}: ${bareHashes.length} unquoted hash source(s) - every 'sha256-...' must be wrapped in single quotes`,
    );
  }
}

/** Replace one meta CSP tag's content attribute; report drift in --check. */
function syncMeta(page, wanted) {
  const src = fs.readFileSync(page, "utf8");
  const re = /(<meta[^>]+http-equiv="Content-Security-Policy"[^>]*content=")([^"]*)(")/;
  const match = src.match(re);
  if (!match) {
    problems.push(`${page}: Content-Security-Policy meta tag not found`);
    return;
  }
  if (match[2] === wanted) return;
  if (CHECK_ONLY) {
    problems.push(`${page}: meta CSP drifted — run node tools/csp-hashes.mjs`);
    return;
  }
  fs.writeFileSync(page, src.replace(re, `$1${wanted}$3`), "utf8");
  console.log(`${page}: meta CSP synced (${wanted.match(/sha256-/g).length} script hashes)`);
}

syncMeta("index.html", indexPolicy);
syncMeta("404.html", notFoundPolicy);

const servePath = "serve.json";
const serve = JSON.parse(fs.readFileSync(servePath, "utf8"));
let headerRule = null;
for (const rule of serve.headers || []) {
  for (const h of rule.headers || []) {
    if (h.key === "Content-Security-Policy" && rule.source === "**") headerRule = h;
  }
}
if (!headerRule) {
  problems.push("serve.json: global Content-Security-Policy header rule not found");
} else if (headerRule.value !== headerPolicy) {
  if (CHECK_ONLY) {
    problems.push("serve.json: CSP header drifted — run node tools/csp-hashes.mjs");
  } else {
    headerRule.value = headerPolicy;
    fs.writeFileSync(servePath, JSON.stringify(serve, null, 2) + "\n", "utf8");
    console.log("serve.json: CSP header synced");
  }
}

if (problems.length) {
  console.error("csp check FAILED:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
if (CHECK_ONLY) console.log("csp OK (meta + header agree with inline scripts)");
