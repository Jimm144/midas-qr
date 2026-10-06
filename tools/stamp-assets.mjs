// @ts-check
/**
 * Stamp every versioned asset's `?v=` with a hash of its own bytes.
 *
 * A `?v=` query is what stops a deploy from pairing the fresh HTML with a stale
 * cached file: navigations are network-first, while everything else is served
 * from the previous precache. That only holds if the query changes whenever the
 * file does — and a hand-bumped counter is exactly the step that gets forgotten.
 * The release that crashed on first load shipped a bundle whose URL never moved,
 * so the new markup was handed the previous bundle.
 *
 * Deriving the version from the content removes the step. check-sw.mjs
 * re-derives the same hash independently, so a skipped stamp or a hand-edited
 * value fails the build rather than shipping.
 *
 * Run after the build (dist/bundle.js and src/css/style.min.css are outputs).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every asset the shell requests with a `?v=`, and the files that must quote the
 * same value: index.html asks for each one, sw.js precaches the exact URL.
 * @type {{ asset: string, files: string[] }[]}
 */
const ASSETS = [
  { asset: "favicon.svg", files: ["index.html", "404.html", "sw.js"] },
  { asset: "dist/bundle.js", files: ["index.html", "sw.js"] },
  { asset: "src/css/style.min.css", files: ["index.html", "sw.js"] },
];

/** @param {string} asset */
function versionOf(asset) {
  const bytes = fs.readFileSync(path.join(ROOT, asset));
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

/** @param {string} value */
function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const stamped = [];
for (const { asset, files } of ASSETS) {
  if (!fs.existsSync(path.join(ROOT, asset))) {
    console.error(`stamp-assets: ${asset} is missing — run the build first`);
    process.exit(1);
  }
  const version = versionOf(asset);
  // Match with or without a leading "./" and replace only the version, so the
  // surrounding markup (attribute quotes, PRECACHE string) is untouched.
  const pattern = new RegExp(`(\\./)?${escapeRe(asset)}\\?v=[0-9a-z]+`, "g");
  // A new reference without any ?v= would otherwise ship (and pass checks)
  // with no cache buster at all: stamp bare refs too. Only quoted references
  // are stamped, so prose mentions in comments are left alone; versioned URLs
  // (followed by `?`) never match the lookahead.
  const barePattern = new RegExp(`(["'(])((?:\\./)?${escapeRe(asset)})(?=["')])`, "g");
  for (const file of files) {
    const filePath = path.join(ROOT, file);
    const before = fs.readFileSync(filePath, "utf8");
    const moved = before.replace(pattern, (_match, prefix) => `${prefix || ""}${asset}?v=${version}`);
    const after = moved.replace(barePattern, (_match, lead, ref) => `${lead}${ref}?v=${version}`);
    if (after !== before) {
      fs.writeFileSync(filePath, after);
      stamped.push(`${file}: ${asset} -> ?v=${version}`);
    }
  }
}

if (stamped.length > 0) console.log(`stamped asset versions:\n  ${stamped.join("\n  ")}`);
else console.log("asset versions already current");
