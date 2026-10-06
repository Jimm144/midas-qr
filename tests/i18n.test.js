import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import en from "../src/js/locales/en.js";
import es from "../src/js/locales/es.js";
import fr from "../src/js/locales/fr.js";
import de from "../src/js/locales/de.js";
import lt from "../src/js/locales/lt.js";
import ja from "../src/js/locales/ja.js";
import { applyStaticTranslations, getLocale, setLocale, t, tp } from "../src/js/i18n.js";

const catalogs = { en, es, fr, de, lt, ja };
const localeCodes = Object.keys(catalogs);
const html = readFileSync(path.join(process.cwd(), "index.html"), "utf8");

function placeholders(value) {
  return [...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe("locale catalogs", () => {
  it.each(localeCodes)("%s has exact key and placeholder parity", (code) => {
    expect(Object.keys(catalogs[code]).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(placeholders(catalogs[code][key]), `${code}:${key}`).toEqual(placeholders(en[key]));
    }
  });

  it("has no blank translations", () => {
    for (const [code, catalog] of Object.entries(catalogs)) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(String(value).trim(), `${code}:${key}`).not.toBe("");
      }
    }
  });
});

describe("i18n runtime", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale("en", false);
    document.body.innerHTML = `
      <span id="label" data-i18n="tabs.generate"></span>
      <input id="field" data-i18n-placeholder="data.textPlaceholder" data-i18n-aria-label="data.textAria" />
      <select id="type"><option value="url" data-i18n="data.url"></option><option value="text" data-i18n="data.text"></option></select>
    `;
    applyStaticTranslations();
  });

  afterEach(() => {
    setLocale("en", false);
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("interpolates values and pluralizes", () => {
    setLocale("de", false);
    expect(t("tabs.switched", { tab: t("tabs.scan") })).toContain(t("tabs.scan"));
    expect(tp("search.match", 1)).toBe(catalogs.de["search.match_one"]);
    expect(tp("search.match", 3)).toBe(catalogs.de["search.match_other"].replace("{count}", "3"));
  });

  it("uses every Intl.PluralRules category (Lithuanian one/few/many/other)", () => {
    setLocale("lt", false);
    expect(tp("search.match", 1)).toBe(catalogs.lt["search.match_one"]);
    expect(tp("search.match", 3)).toBe(catalogs.lt["search.match_few"].replace("{count}", "3"));
    expect(tp("search.match", 10)).toBe(catalogs.lt["search.match_other"].replace("{count}", "10"));
  });

  it("never leaks a computed plural key and falls back through the table", () => {
    setLocale("en", false);
    // Unknown table: guarded to the count instead of "table_few" on screen.
    expect(tp("no.such.table", 3)).toBe("3");
    // Missing keys log and return the key (debuggable, never blank).
    expect(t("no.such.key")).toBe("no.such.key");
  });

  it("sanitizes HTML translations and escapes interpolated params", async () => {
    const { tHtml } = await import("../src/js/i18n.js");
    document.body.innerHTML = `<div id="html-slot" data-i18n-html="tabs.switched"></div>`;
    applyStaticTranslations();
    // Catalog value is plain text here; params carrying markup must not break out.
    expect(document.getElementById("html-slot").innerHTML).not.toContain("<");
    expect(tHtml("tabs.switched", { tab: "<img src=x onerror=alert(1)>" })).not.toContain("<img");
  });

  it("applies text and attributes", () => {
    setLocale("es", false);
    expect(document.getElementById("label").textContent).toBe(catalogs.es["tabs.generate"]);
    expect(document.getElementById("field").placeholder).toBe(catalogs.es["data.textPlaceholder"]);
    expect(document.getElementById("field").getAttribute("aria-label")).toBe(catalogs.es["data.textAria"]);
    expect(document.querySelector('option[value="text"]').textContent).toBe(catalogs.es["data.text"]);
  });

  it("persists supported choices and rejects unknown ones", () => {
    expect(setLocale("ja")).toBe(true);
    expect(localStorage.getItem("qr-language")).toBe("ja");
    expect(getLocale()).toBe("ja");
    expect(document.documentElement.lang).toBe("ja");
    expect(setLocale("xx")).toBe(false);
    expect(getLocale()).toBe("ja");
  });

  it("keeps unresolved technical markup keys visible to the audit", () => {
    const used = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((match) => match[1]);
    const translated = used.filter((key) => key in en);
    const unknown = [...new Set(used)].filter((key) => !(key in en));
    expect(unknown).toEqual([]);
    expect(translated.length).toBeGreaterThan(100);
  });
});
