import { readFileSync } from "node:fs";
import path from "node:path";

const INDEX_HTML_PATH = path.join(process.cwd(), "index.html");

/** Body markup of the real index.html, scripts included but inert via innerHTML. */
export function indexBodyMarkup() {
  const html = readFileSync(INDEX_HTML_PATH, "utf8");
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return body ? body[1] : html;
}

/**
 * Boot the real markup into the jsdom document and populate a fresh DOM
 * registry from it. The same acquisition seam production uses, exercised in
 * tests: a missing or renamed id fails here instead of drifting silently.
 */
export async function bootRealDom() {
  document.body.innerHTML = indexBodyMarkup();
  const { DOM, initDOM } = await import("../../src/js/ui/dom.js");
  initDOM(document);
  return DOM;
}
