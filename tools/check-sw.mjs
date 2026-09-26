// Validates the offline layer before a build ships: a syntactically broken
// service worker silently pins every open tab to a stale cache forever
// (the browser keeps running the last valid worker), so this must fail loudly.
// It also guards manifest.json (every icon/screenshot it references must exist
// on disk) and 404.html (its inline script hash must match its own meta CSP).
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const problems = [];
const read = (path) => {
  try {
    return fs.readFileSync(path, "utf8");
  } catch (err) {
    problems.push("cannot read " + path + ": " + err.message);
    return null;
  }
};

// ---------------------------------------------------------------- sw.js ---

const file = "sw.js";
const src = read(file) || "";

// 1. Syntax: parse with node (classic script, no DOM needed).
if (src) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    problems.push("syntax error: " + String(err.stderr || err.message).trim());
  }
}

// 2. Required structure.
for (const needle of [
  'addEventListener("install"',
  'addEventListener("fetch"',
  'addEventListener("activate"',
  "skipWaiting",
  "clients.claim",
  "CACHE_NAME",
]) {
  if (!src.includes(needle)) problems.push("missing: " + needle);
}

// 3. Every precache entry must exist on disk (ignoring ?v= cache busters).
const listMatch = src.match(/const PRECACHE = \[([\s\S]*?)\];/);
let precacheEntries = [];
if (!listMatch) {
  problems.push("PRECACHE array not found or not terminated");
} else {
  // Comments may mention paths in prose (e.g. 'precaching "./"'); strip them
  // before extracting entries or a quoted path turns into a phantom entry.
  const listBody = listMatch[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  precacheEntries = [...listBody.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (precacheEntries.length < 15) problems.push(`PRECACHE suspiciously small (${precacheEntries.length} entries)`);
  for (const entry of precacheEntries) {
    const path = entry.replace(/\?.*$/, "");
    if (path === "./") continue;
    if (!fs.existsSync(path)) problems.push("precache entry missing on disk: " + entry);
  }
  // 3b. Entries must be plain double-quoted strings and unique: a single-quoted
  // or computed entry would silently bypass the existence check above.
  const residue = listBody.replace(/"(?:[^"\\]|\\.)*"/g, "").replace(/[\s,]+/g, "");
  if (residue) problems.push("PRECACHE contains non-string entries: " + residue.slice(0, 80));
  const seenEntries = new Set();
  for (const entry of precacheEntries) {
    if (seenEntries.has(entry)) problems.push("duplicate PRECACHE entry: " + entry);
    seenEntries.add(entry);
  }
}

// 4. Every versioned asset must agree between the shell and the precache list.
// The stylesheet was the only pair checked; the favicon (and any future asset)
// could drift, and a `.match()`-once check silently ignored a second reference.
const html = read("index.html") || "";
const versionedAssets = new Map();
for (const match of html.matchAll(/([\w./-]+)\?v=(\d+)/g)) {
  const [, path, version] = match;
  const key = path.replace(/^\.\//, "");
  if (!versionedAssets.has(key)) versionedAssets.set(key, new Set());
  versionedAssets.get(key).add(version);
}
for (const [path, versions] of versionedAssets) {
  if (versions.size > 1) {
    problems.push(`${path}: conflicting ?v= versions in index.html (${[...versions].join(", ")})`);
  }
  for (const version of versions) {
    const wanted = `./${path}?v=${version}`;
    if (!precacheEntries.includes(wanted)) {
      problems.push(`index.html requests ${path}?v=${version} but PRECACHE has no matching entry`);
    }
  }
}

// 4a. A stale bundle ships silently: the service worker would keep serving the
// previous dist/bundle.js or style.min.css for two reloads while every check
// above stays green. Compare mtimes against the newest source file.
const newestMtime = (dir, exts) => {
  let newest = 0;
  const walk = (current) => {
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const path = current + "/" + dirent.name;
      if (dirent.isDirectory()) walk(path);
      else if (exts.some((ext) => dirent.name.endsWith(ext))) {
        newest = Math.max(newest, fs.statSync(path).mtimeMs);
      }
    }
  };
  walk(dir);
  return newest;
};
const builtArtifacts = [
  { built: "dist/bundle.js", source: newestMtime("src/js", [".js", ".ts"]) },
  { built: "src/css/style.min.css", source: fs.statSync("src/css/style.css").mtimeMs },
];
for (const artifact of builtArtifacts) {
  if (!fs.existsSync(artifact.built)) {
    problems.push(`built artifact missing: ${artifact.built} (run npm run build)`);
    continue;
  }
  if (fs.statSync(artifact.built).mtimeMs + 1000 < artifact.source) {
    problems.push(
      `${artifact.built} is older than its sources — run npm run build before shipping`
    );
  }
}

// 4b. Every local asset the shell pages reference must exist and be precached
// under exactly the requested URL (query included): an unprecached first-load
// asset is a guaranteed cache miss and a hole in the offline shell. Both HTML
// pages are checked; "/" navigations are exempt because the fetch handler
// serves them from the cached index.html fallback.
const pageAssetRefs = (src) => [
  ...[...src.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]),
  // Scripts the inline loader injects by string, not by tag attribute.
  ...[...src.matchAll(/loadScript\('([^']+)'\)/g)].map((m) => m[1]),
];
let shellRefs = 0;
for (const [page, pageSrc] of [
  ["index.html", html],
  ["404.html", read("404.html") || ""],
]) {
  for (const ref of pageAssetRefs(pageSrc)) {
    if (/^(#|data:|https?:|mailto:|\/\/|javascript:)/i.test(ref)) continue;
    const path = ref.replace(/[?#].*$/, "");
    if (!path || path === "/" || path === "./") continue;
    const disk = path.replace(/^\/+/, "");
    if (!fs.existsSync(disk)) problems.push(`${page} references missing file: ${ref}`);
    const wanted = [ref, "./" + ref, "./" + ref.replace(/^\/+/, "")];
    if (!wanted.some((candidate) => precacheEntries.includes(candidate))) {
      problems.push(`${page} asset not precached: ${ref}`);
    }
    shellRefs++;
  }
}

// 4c. Every precache entry must be requested by the shipped shell (markup,
// manifest, stylesheet or app JS) or be a documented offline fallback.
// index.html / 404.html are exempt: the navigation fallback serves them.
// An entry nothing fetches — a superseded URL, a crawler-only file — is dead
// install payload and must not sneak back in. References are resolved as real
// asset URLs, never by substring: placeholder prose in manifest.json
// ("mirrors ... robots.txt") must not count as a fetch.
function walkSources(dir) {
  let out = "";
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const source = dir + "/" + dirent.name;
    if (dirent.isDirectory()) out += walkSources(source);
    else if (/\.(js|ts)$/.test(dirent.name)) out += "\n" + fs.readFileSync(source, "utf8");
  }
  return out;
}
const referenced = new Set();
const addRef = (value, from) => {
  if (typeof value !== "string" || !value) return;
  if (/^(data:|https?:|#|\/\/|mailto:|javascript:)/i.test(value)) return;
  try {
    const url = new URL(value, new URL(from, "https://shell/"));
    if (url.origin !== "https://shell") return;
    const path = url.pathname.replace(/^\/+/, "") + url.search;
    if (path) referenced.add(path);
  } catch (_err) {}
};
const notFoundHtml = read("404.html") || "";
for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) addRef(match[1], "index.html");
for (const match of html.matchAll(/loadScript\('([^']+)'\)/g)) addRef(match[1], "index.html");
for (const match of notFoundHtml.matchAll(/(?:href|src)="([^"]+)"/g)) addRef(match[1], "404.html");
try {
  const manifest = JSON.parse((read("manifest.json") || "").replace(/^\uFEFF/, ""));
  const stack = [manifest];
  while (stack.length) {
    const value = stack.pop();
    if (typeof value === "string") {
      // Only whole-string paths count: placeholder sentences with spaces don't.
      if (/^[A-Za-z0-9_@%+.,~/()-]+\.[A-Za-z0-9]+$/.test(value)) addRef(value, "manifest.json");
    } else if (value && typeof value === "object") stack.push(...Object.values(value));
  }
} catch (_err) {}
const cssSrc = read("src/css/style.css") || "";
for (const match of cssSrc.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) addRef(match[1], "src/css/style.css");
const jsSources = walkSources("src/js");
const isFallbackPage = (path) => path === "index.html" || path === "404.html";
for (const entry of precacheEntries) {
  const path = entry.replace(/^\.\//, "");
  if (isFallbackPage(path)) continue;
  if (!path) {
    problems.push("precache entry never referenced by the app shell: " + entry);
    continue;
  }
  const quoted = [`"${path}"`, `'${path}'`];
  if (referenced.has(path) || quoted.some((needle) => jsSources.includes(needle))) continue;
  problems.push("precache entry never referenced by the app shell: " + entry);
}

// 4d. Self-hosted typography has two consumers: @font-face rules (theme UI)
// and FRAME_FONTS in src/js/frames.ts (fonts embedded into exported SVGs).
// A missing file breaks a theme at runtime with no build error, while an
// orphaned woff2 ships bytes nothing can use.
const fontFaces = [];
for (const block of cssSrc.match(/@font-face\s*\{[^}]*\}/g) || []) {
  const family = (block.match(/font-family:\s*"([^"]+)"/) || [])[1];
  const file = (block.match(/url\("?\.\.\/fonts\/([^")]+)"?\)/) || [])[1];
  if (family && file) fontFaces.push({ family, file: "src/fonts/" + file });
}
if (fontFaces.length === 0) problems.push("style.css: no self-hosted @font-face declarations found");
for (const face of fontFaces) {
  if (!fs.existsSync(face.file)) problems.push(`@font-face "${face.family}" missing font file: ${face.file}`);
}
const frameFonts = [...(read("src/js/frames.ts") || "").matchAll(/family:\s*"([^"]+)"[\s\S]{0,80}?file:\s*"([^"]+)"/g)].map(
  (m) => ({ family: m[1], file: m[2] })
);
for (const font of frameFonts) {
  if (!fs.existsSync(font.file)) problems.push(`frames.ts font "${font.family}" missing on disk: ${font.file}`);
  if (!fontFaces.some((face) => face.family === font.family)) {
    problems.push(`frames.ts font "${font.family}" has no @font-face in style.css`);
  }
}
const themeSrc = read("src/js/themes.ts") || "";
// Theme typography is declared per family in THEME_FONTS. Every family a
// theme names in its body/heading/display/code stack must have an @font-face:
// a themed family with no declaration silently falls back to the system font
// at runtime. Generic and system-only families are exempt.
const SYSTEM_FAMILIES = new Set(
  [
    "system-ui",
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "ui-monospace",
    "-apple-system",
    "BlinkMacSystemFont",
    "Segoe UI",
    "Roboto",
    "Helvetica",
    "Arial",
    "Georgia",
    "Times New Roman",
    "Times",
    "SF Mono",
    "Monaco",
    "Consolas",
    "Liberation Mono",
    "Courier New",
    "Manufacturing Consent",
    "Old English Text MT",
    "Segoe Script",
    "Comic Sans MS",
    "Impact",
    "Papyrus",
  ].map((name) => name.toLowerCase())
);
const themeFamilies = new Set();
const themeFontsAt = themeSrc.indexOf("THEME_FONTS");
if (themeFontsAt < 0) {
  problems.push("themes.ts: THEME_FONTS declaration not found");
} else {
  const fontsSrc = themeSrc.slice(themeFontsAt);
  for (const block of fontsSrc.matchAll(/^ {2}[a-z0-9]+:\s*\{([\s\S]*?)^ {2}\},/gm)) {
    for (const key of ["body", "heading", "display", "code"]) {
      const line = block[1].match(new RegExp("^\\s*" + key + ":\\s*(.+)$", "m"));
      if (!line) continue;
      for (const quoted of line[1].matchAll(/"([^"]+)"/g)) {
        if (!SYSTEM_FAMILIES.has(quoted[1].toLowerCase())) themeFamilies.add(quoted[1]);
      }
    }
  }
  if (themeFamilies.size === 0) problems.push("themes.ts: no self-hosted theme font families detected");
}
for (const family of themeFamilies) {
  if (!fontFaces.some((face) => face.family === family)) {
    problems.push(`theme typography uses "${family}" but style.css has no @font-face for it`);
  }
}
for (const face of fontFaces) {
  const usedByTheme = themeFamilies.has(face.family);
  const usedByFrames = frameFonts.some((font) => font.family === face.family);
  if (!usedByTheme && !usedByFrames) {
    problems.push(`@font-face "${face.family}" is not referenced by any theme or frame font`);
  }
}
const diskFonts = fs.existsSync("src/fonts")
  ? fs.readdirSync("src/fonts").filter((name) => name.endsWith(".woff2"))
  : [];
for (const file of diskFonts) {
  if (!fontFaces.some((face) => face.file === "src/fonts/" + file)) {
    problems.push("unreferenced font file on disk: src/fonts/" + file);
  }
}

// 5. The cache name must stay versioned, so caching behavior changes always
// ship under a fresh cache instead of mutating the one users already have.
const cacheVersion = (src.match(/const CACHE_NAME = "[a-z0-9-]+-v(\d+)"/) || [])[1];
if (!cacheVersion) problems.push('CACHE_NAME must match "<app-prefix>-v<number>"');
// 6. Stamp the visible build version in index.html from CACHE_NAME, so the
//    footer always shows the build that is actually being served.
const buildMarker = /(<span id="build-version"[^>]*>)([^<]*)(<\/span>)/;
if (!buildMarker.test(html)) {
  problems.push("index.html: #build-version marker not found");
} else {
  const stamped = html.replace(buildMarker, `$1v${cacheVersion}$3`);
  if (stamped !== html) {
    fs.writeFileSync("index.html", stamped, "utf8");
    console.log(`index.html build version stamped -> v${cacheVersion}`);
  }
}

// 6b. The bound/gating/cleanup behavior the cache relies on must survive edits:
// without them runtime storage grows without bound, cache errors or 404s enter
// the cache, or a previous version's entries are kept forever.
if (!/const RUNTIME_CACHE_LIMIT = \d+/.test(src)) {
  problems.push("sw.js: RUNTIME_CACHE_LIMIT must be a numeric constant");
}
if (!/networkResponse\.ok/.test(src)) {
  problems.push("sw.js: no network response.ok gating found");
}
if (!src.includes("caches.delete")) problems.push("sw.js: stale caches are never deleted");
if (!/new Request\([\s\S]{0,80}?cache:\s*"no-cache"/.test(src)) {
  problems.push('sw.js: precache fetches must revalidate with the HTTP cache (cache: "no-cache")');
}

// ----------------------------------------------------------- manifest.json ---

const manifestSrc = read("manifest.json");
let manifest = null;
if (manifestSrc !== null) {
  try {
    manifest = JSON.parse(manifestSrc.replace(/^\uFEFF/, ""));
  } catch (err) {
    problems.push("manifest.json is not valid JSON: " + err.message);
  }
}

let manifestRefs = 0;
function checkManifestPath(label, value) {
  if (typeof value !== "string" || value.length === 0) {
    problems.push(`manifest.json: ${label} is missing or not a string`);
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return; // external URL or data: URI
  const path = value.replace(/[?#].*$/, "");
  manifestRefs++;
  if (!fs.existsSync(path)) problems.push(`manifest.json: ${label} missing on disk: ${value}`);
}

if (manifest) {
  // Installability floor: without these Chromium refuses to offer installation.
  for (const key of ["name", "short_name", "start_url", "display", "background_color", "theme_color"]) {
    if (typeof manifest[key] !== "string" || manifest[key].length === 0) {
      problems.push(`manifest.json: ${key} is missing or not a string`);
    }
  }
  if (manifest.display && !["standalone", "fullscreen", "minimal-ui", "browser"].includes(manifest.display)) {
    problems.push(`manifest.json: unsupported display "${manifest.display}"`);
  }
  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    problems.push("manifest.json: icons[] is missing or empty");
  } else {
    manifest.icons.forEach((icon, i) => checkManifestPath(`icons[${i}].src`, icon && icon.src));
    const sizes = new Set(
      manifest.icons.flatMap((icon) => String((icon && icon.sizes) || "").split(/\s+/))
    );
    for (const required of ["192x192", "512x512"]) {
      if (!sizes.has(required)) problems.push(`manifest.json: no ${required} icon (install prompt requires it)`);
    }
  }
  if (manifest.screenshots !== undefined) {
    if (!Array.isArray(manifest.screenshots)) problems.push("manifest.json: screenshots must be an array");
    else manifest.screenshots.forEach((shot, i) => checkManifestPath(`screenshots[${i}].src`, shot && shot.src));
  }
  if (manifest.shortcuts !== undefined) {
    if (!Array.isArray(manifest.shortcuts)) problems.push("manifest.json: shortcuts must be an array");
    else {
      const tabsSrc = read("src/js/ui/tabs.js");
      const tabHashes = new Set((tabsSrc || "").match(/"(generator|scanner|history)"/g) || []);
      manifest.shortcuts.forEach((shortcut, i) => {
        const icons = shortcut && shortcut.icons;
        if (icons === undefined) return;
        if (!Array.isArray(icons)) problems.push(`manifest.json: shortcuts[${i}].icons must be an array`);
        else icons.forEach((icon, j) => checkManifestPath(`shortcuts[${i}].icons[${j}].src`, icon && icon.src));
        const hash = typeof shortcut.url === "string" ? (shortcut.url.match(/#([^#]*)$/) || [])[1] : "";
        if (hash && tabHashes.size > 0 && !tabHashes.has(`"${hash}"`)) {
          problems.push(`manifest.json: shortcuts[${i}].url targets unknown tab #${hash}`);
        }
      });
    }
  }
}

// ------------------------------------------------------------- serve.json ---

// The static host's global headers are the deployment's real security policy
// (meta CSPs can only tighten it). Guard the pieces the app itself depends on:
// the CSP header must not block the shell/export paths, and the scanner must
// stay allowed to request the camera.
const serveSrc = read("serve.json");
let serve = null;
if (serveSrc !== null) {
  try {
    serve = JSON.parse(serveSrc.replace(/^\uFEFF/, ""));
  } catch (err) {
    problems.push("serve.json is not valid JSON: " + err.message);
  }
}

let headerCsp = "";
let permissionsPolicy = "";
let swCacheControl = "";
const headerValues = new Map();
if (serve && Array.isArray(serve.headers)) {
  for (const rule of serve.headers) {
    if (!rule || !Array.isArray(rule.headers)) continue;
    const isSwRule = typeof rule.source === "string" && rule.source.includes("sw.js");
    for (const header of rule.headers) {
      if (!header || typeof header.key !== "string") continue;
      const key = header.key.toLowerCase();
      const value = String(header.value || "");
      headerValues.set(key, (headerValues.get(key) || "") + " " + value);
      if (key === "content-security-policy") headerCsp += " " + value;
      if (key === "permissions-policy") permissionsPolicy += " " + value;
      if (isSwRule && key === "cache-control") swCacheControl = value;
    }
  }
}
if (!headerCsp) {
  problems.push("serve.json: no Content-Security-Policy header");
} else {
  if (!/font-src[^;]*\bdata:/.test(headerCsp)) {
    problems.push("serve.json CSP: font-src must allow data: (embedded export fonts)");
  }
  if (!/img-src[^;]*\bdata:/.test(headerCsp) || !/img-src[^;]*\bblob:/.test(headerCsp)) {
    problems.push("serve.json CSP: img-src must allow data: and blob: (logo/background/clipboard images)");
  }
  if (!/style-src[^;]*'unsafe-inline'/.test(headerCsp)) {
    problems.push("serve.json CSP: style-src must allow 'unsafe-inline' (theme bootstrap inline styles)");
  }
}
if (!permissionsPolicy.includes("camera=(self)")) {
  problems.push("serve.json: Permissions-Policy must keep camera=(self) for the scanner");
}
// Baseline hardening headers must not silently disappear.
for (const [key, label] of [
  ["x-content-type-options", "X-Content-Type-Options: nosniff"],
  ["x-frame-options", "X-Frame-Options"],
  ["referrer-policy", "Referrer-Policy"],
  ["strict-transport-security", "Strict-Transport-Security"],
  ["cross-origin-opener-policy", "Cross-Origin-Opener-Policy"],
  ["cross-origin-resource-policy", "Cross-Origin-Resource-Policy"],
]) {
  if (!(headerValues.get(key) || "").trim()) problems.push(`serve.json: missing ${label} header`);
}
if (!headerValues.get("x-content-type-options")?.includes("nosniff")) {
  problems.push("serve.json: X-Content-Type-Options must be nosniff");
}
// The worker must revalidate so update checks are never answered from a stale
// HTTP cache entry.
if (!/no-cache|no-store/.test(swCacheControl)) {
  problems.push("serve.json: /sw.js must be served with Cache-Control no-cache");
}
const headerHashes = new Set(headerCsp.match(/sha256-[A-Za-z0-9+/=]+/g) || []);

// --------------------------------------------------------------- 404.html ---

// Every page that ships inline <script> blocks must list each block's hash in
// its own meta CSP — a stale hash silently disables the app (the browser blocks
// the script), which is exactly the kind of breakage this build must catch.
// The host header applies to every page too, and policies intersect: a hash the
// page allows but the header omits still blocks the script.
const cspChecks = [];
for (const page of ["404.html", "index.html"]) {
  const src = read(page);
  if (src === null) continue;
  const scripts = inlineScripts(page);
  const meta = src.match(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i);
  if (!meta) {
    problems.push(`${page}: Content-Security-Policy meta tag not found`);
    continue;
  }
  const allowed = new Set(meta[0].match(/sha256-[A-Za-z0-9+/=]+/g) || []);
  if (scripts.length === 0) problems.push(`${page}: no inline script found to hash-check`);
  for (const script of scripts) {
    if (!allowed.has(script.hash)) {
      problems.push(`${page}: inline script at line ${script.line} not allowed by its meta CSP (${script.hash})`);
    }
    if (headerCsp && !headerHashes.has(script.hash)) {
      problems.push(`${page}: inline script at line ${script.line} blocked by serve.json's CSP header (${script.hash})`);
    }
  }
  cspChecks.push(`${page} (${scripts.length} inline script hash${scripts.length === 1 ? "" : "es"} allowed by its meta CSP)`);
}

// ------------------------------------------------------- HTML tag balance ---

// A stray/unbalanced tag in the shell silently reparents everything after it
// (the browser repairs the tree), which moves whole UI blocks without any
// runtime error — exactly what happened once to the export block.
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function checkTagBalance(path, src) {
  const open = [];
  const tagRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
  const lineAt = (index) => src.slice(0, index).split("\n").length;
  let match;
  while ((match = tagRe.exec(src))) {
    const raw = match[0];
    if (raw.startsWith("<!--")) continue;
    const name = (match[1] || "").toLowerCase();
    if (name === "script" || name === "style") {
      // Skip element text so code containing markup can't confuse the parser.
      if (!raw.startsWith("</")) {
        const close = src.indexOf(`</${name}`, tagRe.lastIndex);
        if (close >= 0) tagRe.lastIndex = close;
      }
    }
    const closing = raw.startsWith("</");
    const selfClosing = /\/>$/.test(raw) || VOID_ELEMENTS.has(name);
    if (closing) {
      if (open.length === 0) {
        problems.push(`${path}: stray </${name}> at line ${lineAt(match.index)} (nothing open)`);
        continue;
      }
      const top = open.pop();
      if (top.name !== name) {
        problems.push(
          `${path}: </${name}> at line ${lineAt(match.index)} closes <${top.name}> opened at line ${top.line}`
        );
      }
    } else if (!selfClosing) {
      open.push({ name, line: lineAt(match.index) });
    }
  }
  for (const tag of open) problems.push(`${path}: unclosed <${tag.name}> opened at line ${tag.line}`);
  return open.length === 0 && !problems.some((p) => p.startsWith(path));
}

const balancedPages = [];
for (const page of ["index.html", "404.html"]) {
  const src = read(page);
  if (src === null) continue;
  const before = problems.length;
  if (checkTagBalance(page, src)) balancedPages.push(page);
  if (problems.length > before) {
    // already reported with file/line context above
  }
}

// Browsers hash inline script text after CRLF -> LF normalization.
function inlineScripts(path) {
  const buf = fs.readFileSync(path);
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
    const text = buf.slice(tagEnd + 1, close).toString("utf8").replace(/\r\n/g, "\n");
    if (text.trim().length === 0) continue;
    out.push({
      line: buf.slice(0, start).toString("utf8").split("\n").length,
      hash: "sha256-" + crypto.createHash("sha256").update(text, "utf8").digest("base64"),
    });
  }
  return out;
}

// ----------------------------------------------------------------- output ---

if (problems.length) {
  console.error("offline-layer check FAILED:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`sw.js OK (${src.length} bytes, ${precacheEntries.length} precache entries, cache v${cacheVersion})`);
console.log(`shell assets OK (${shellRefs} references across index.html/404.html exist and are precached)`);
console.log(`fonts OK (${fontFaces.length} @font-face files on disk, ${frameFonts.length} frame fonts verified)`);
console.log(`manifest.json OK (${manifestRefs} icon/screenshot paths verified on disk)`);
console.log(`serve.json OK (CSP header + hashes, Permissions-Policy camera=(self))`);
for (const line of cspChecks) console.log(line);
for (const page of balancedPages) console.log(`${page} tag balance OK`);
