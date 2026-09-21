// @ts-check
/**
 * Stage the runtime-only site into ./site for GitHub Pages.
 *
 * The deployed artifact must not contain tests, tools, audits, dev config or
 * node_modules, so this copies an explicit allow-list instead of the repo root.
 * Run after `npm run build` (dist/bundle.js and src/css/style.min.css are
 * build outputs and are not committed).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "site");

const FILES = [
  "index.html",
  "404.html",
  "manifest.json",
  "favicon.svg",
  "icon-192x192.png",
  "icon-512x512.png",
  "robots.txt",
  "sitemap.xml",
  "sw.js",
  "dist/bundle.js",
  "src/css/style.min.css",
  "src/js/scanner/worker.js",
];
const DIRS = ["src/fonts", "src/lib"];

fs.rmSync(OUT, { recursive: true, force: true });
let bytes = 0;
let count = 0;

/** @param {string} rel */
function copy(rel) {
  const from = path.join(ROOT, rel);
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  bytes += fs.statSync(to).size;
  count += 1;
}

for (const file of FILES) copy(file);
for (const dir of DIRS) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isFile()) copy(path.join(dir, entry.name));
  }
}

console.log(`pages artifact: ${count} files, ${(bytes / 1024 / 1024).toFixed(2)} MB -> site/`);
