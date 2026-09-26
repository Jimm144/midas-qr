import { state } from "../state";
import { BUILT_IN_MASK_PATHS } from "../frames";
import { sanitizeMaskPath } from "../utils.js";
import { innerPaddingForMask, maskVerticalShift, moduleSizeFor } from "./layout.js";
import { parseGradient, gradientStops, diagonalSpan, linearEndpoints } from "./gradient.js";

export const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_MIME = "image/svg+xml";

// The mask-fit table and its two readers live in layout.js so the render
// pipeline, the mask pass and the exporter can't drift apart. Re-exported
// here for the existing mask geometry tests.
export { innerPaddingForMask, maskVerticalShift };

const RECT_MERGE_EPSILON = 1e-6;
const IDENTITY_ROTATE_RE = /^rotate\(\s*0(?:[,\s)]|$)/;

/** Parse an SVG string, returning null when the input is not valid SVG. */
export function parseSvgDocument(svgText) {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(svgText, SVG_MIME);
  if (doc.querySelector("parsererror")) return null;
  return doc;
}

/**
 * Merge equal-sized, axis-aligned rects into maximal horizontal/vertical runs.
 * Sources that share an edge become one rect covering the exact same union
 * (outer edges are reused verbatim), so the clipped paint is pixel-identical.
 * Pure data-in/data-out — no DOM touch.
 */
function mergeRectRuns(sources) {
  // Horizontal runs: rects sharing a row (exact y + height) and touching in x.
  const rows = new Map();
  for (const r of sources) {
    const key = `${r.y}|${r.h}`;
    let list = rows.get(key);
    if (!list) rows.set(key, (list = []));
    list.push(r);
  }
  const runs = [];
  for (const list of rows.values()) {
    list.sort((a, b) => a.x - b.x);
    let run = null;
    for (const r of list) {
      if (run && Math.abs(r.x - (run.x + run.w)) <= RECT_MERGE_EPSILON) {
        run.w = r.x + r.w - run.x;
        continue;
      }
      run = { x: r.x, y: r.y, w: r.w, h: r.h };
      runs.push(run);
    }
  }

  // Vertical runs: horizontal runs sharing a column (exact x + width) and
  // touching in y.
  const columns = new Map();
  for (const r of runs) {
    const key = `${r.x}|${r.w}`;
    let list = columns.get(key);
    if (!list) columns.set(key, (list = []));
    list.push(r);
  }
  const merged = [];
  for (const list of columns.values()) {
    list.sort((a, b) => a.y - b.y);
    let run = null;
    for (const r of list) {
      if (run && Math.abs(r.y - (run.y + run.h)) <= RECT_MERGE_EPSILON) {
        run.h = r.y + r.h - run.y;
        continue;
      }
      run = { x: r.x, y: r.y, w: r.w, h: r.h };
      merged.push(run);
    }
  }
  return merged;
}

const RECT_TAG_RE = /<rect\b[^>]*\/>/g;
const RECT_ATTR_RE = /\b(x|y|width|height|rx|ry|transform)="([^"]*)"/g;
const DOT_CLIP_RE = /<clipPath\b[^>]*id="clip-path-dot-color[^"]*"[^>]*>[\s\S]*?<\/clipPath>/g;

/** Merge the rects inside one dot clipPath's markup; null when unchanged. */
function mergeClipMarkup(content) {
  const segments = [];
  const rects = [];
  let last = 0;
  let match;
  RECT_TAG_RE.lastIndex = 0;
  while ((match = RECT_TAG_RE.exec(content))) {
    const token = match[0];
    const attrs = {};
    let attr;
    RECT_ATTR_RE.lastIndex = 0;
    while ((attr = RECT_ATTR_RE.exec(token))) attrs[attr[1]] = attr[2];
    const w = Number(attrs.width);
    const h = Number(attrs.height);
    const rounded = (attrs.rx && attrs.rx !== "0") || (attrs.ry && attrs.ry !== "0");
    const transform = attrs.transform || "";
    const rotatable = transform && !IDENTITY_ROTATE_RE.test(transform);
    segments.push(content.slice(last, match.index));
    last = match.index + token.length;
    if (rounded || rotatable || !(w > 0 && h > 0)) {
      segments.push(token);
    } else {
      rects.push({ x: Number(attrs.x) || 0, y: Number(attrs.y) || 0, w, h });
    }
  }
  if (rects.length < 2) return null;
  const merged = mergeRectRuns(rects);
  segments.push(content.slice(last));
  return segments.join("") + `<path d="${runsToPathData(merged)}"/>`;
}

/**
 * Serialize the merged runs as ONE path. Multiple shapes inside a clipPath are
 * rasterized separately and double-blend their antialiasing where they share
 * an edge — on fractional display scales that reads as hairline seams between
 * modules. A single path has no interior edges, so the union rasterizes clean.
 */
function runsToPathData(runs) {
  let d = "";
  for (const r of runs) d += `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}z`;
  return d;
}

/**
 * Merge the vendored library's one-rect-per-module dot clip into a single path,
 * purely as a string transform: no DOMParser/XMLSerializer round-trip. This
 * cuts the SVG size and DOM node count by ~3x, keeps the painted union
 * pixel-identical and removes the AA seams between adjacent modules.
 * Returns the input untouched when there is nothing to convert.
 */
export function optimizeSvgRects(svgText) {
  if (typeof svgText !== "string" || svgText.indexOf("clip-path-dot-color") === -1) return svgText;
  let changed = false;
  const out = svgText.replace(DOT_CLIP_RE, (clipMarkup) => {
    const openEnd = clipMarkup.indexOf(">") + 1;
    const closeStart = clipMarkup.lastIndexOf("</clipPath>");
    if (openEnd <= 0 || closeStart < openEnd) return clipMarkup;
    const merged = mergeClipMarkup(clipMarkup.slice(openEnd, closeStart));
    if (merged === null) return clipMarkup;
    changed = true;
    return clipMarkup.slice(0, openEnd) + merged + clipMarkup.slice(closeStart);
  });
  return changed ? out : svgText;
}

export const HEART_PATH_D =
  "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";

/** Argument counts for the SVG path commands, keyed by lower-case letter. */
const PATH_COMMAND_ARITY = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
/** Commands that repeat implicitly when more numbers follow. */
const PATH_REPEATABLE = new Set(["l", "h", "v", "c", "s", "q", "t", "a"]);
const PATH_TOKEN_RE = /[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;

/**
 * Sanitize and validate a user-supplied custom mask path.
 *
 * Returns the sanitized path only when it is complete, well-formed path data
 * starting with a moveto. Anything else returns "" so a malformed or partial
 * path can never silently erase the mask background (an invalid `d` renders
 * nothing) or slip stray tokens into the `d` attribute.
 */
export function safeMaskPathD(path) {
  const sanitized = sanitizeMaskPath(path || "").trim();
  if (!/^[Mm]/.test(sanitized)) return "";
  PATH_TOKEN_RE.lastIndex = 0;
  let match;
  let cursor = 0;
  let command = "";
  let pending = 0;
  let seenCommand = false;
  let movetos = 0;
  while ((match = PATH_TOKEN_RE.exec(sanitized))) {
    if (sanitized.slice(cursor, match.index).trim() !== "") return "";
    cursor = match.index + match[0].length;
    const token = match[0];
    if (/[a-zA-Z]/.test(token)) {
      // A new command may not interrupt one that still needs arguments.
      if (pending !== 0) return "";
      const next = token.toLowerCase();
      if (!(next in PATH_COMMAND_ARITY)) return "";
      command = next;
      pending = PATH_COMMAND_ARITY[next];
      seenCommand = true;
      if (command === "m") movetos++;
      continue;
    }
    if (!seenCommand) return "";
    if (pending === 0) {
      if (!PATH_REPEATABLE.has(command)) return "";
      pending = PATH_COMMAND_ARITY[command];
    }
    pending--;
    // Extra pairs after a moveto are implicit linetos.
    if (pending === 0 && command === "m") command = "l";
  }
  if (sanitized.slice(cursor).trim() !== "") return "";
  return movetos > 0 && pending === 0 ? sanitized : "";
}


/**
 * Paint every figure group (dots, corner squares, corner dots) with ONE shared
 * gradient so they register perfectly. The vendored library defines corner
 * gradients per corner box, which visibly mismatches the canvas-wide dots
 * gradient; this pass replaces all of them with a single canvas-wide gradient
 * (same geometry as the library's dot gradient: direction (cos θ, sin θ) in
 * SVG space, radial centred on the canvas).
 */
/** Append a canvas-wide gradient definition; returns its id (or null). */
function addGradientDef(doc, defs, id, gradient, baseColor, w, h) {
  const spec = parseGradient(gradient);
  if (!spec) return null;
  if (defs.querySelector(`#${id}`)) return id;
  const grad = doc.createElementNS(SVG_NS, spec.type === "radial" ? "radialGradient" : "linearGradient");
  grad.setAttribute("id", id);
  grad.setAttribute("gradientUnits", "userSpaceOnUse");
  if (spec.type === "radial") {
    grad.setAttribute("cx", String(w / 2));
    grad.setAttribute("cy", String(h / 2));
    grad.setAttribute("r", String(Math.max(w, h) / 2));
  } else {
    const len = diagonalSpan(w, h, spec.rotation);
    const { x1, y1, x2, y2 } = linearEndpoints(w / 2, h / 2, len, spec.rotation);
    grad.setAttribute("x1", String(x1));
    grad.setAttribute("y1", String(y1));
    grad.setAttribute("x2", String(x2));
    grad.setAttribute("y2", String(y2));
  }
  for (const { offset, color } of gradientStops(baseColor, spec.color2)) {
    const stop = doc.createElementNS(SVG_NS, "stop");
    stop.setAttribute("offset", String(offset));
    stop.setAttribute("stop-color", color);
    grad.appendChild(stop);
  }
  defs.appendChild(grad);
  return id;
}

/** One gradient target per figure group, paired with its clip-path needle. */
function globalGradientSpecs() {
  const g = state.generator;
  return [
    { clip: "clip-path-dot-color", id: "qr-global-grad", gradient: g.dotsGradient, base: g.dotsColor },
    {
      clip: "clip-path-corners-square-color",
      id: "qr-corners-square-grad",
      gradient: g.cornersSquareGradient,
      base: g.cornersSquareColor,
    },
    {
      clip: "clip-path-corners-dot-color",
      id: "qr-corners-dot-grad",
      gradient: g.cornersDotGradient,
      base: g.cornersDotColor,
    },
  ];
}

/** True when at least one figure group has a gradient to apply. */
export function needsGlobalGradientPass() {
  return globalGradientSpecs().some((s) => s.gradient && typeof s.gradient === "object");
}

/** Doc-level gradient pass; returns true when the tree was modified. */
export function applyGlobalDotGradientToDoc(doc, w, h) {
  const active = globalGradientSpecs().filter((s) => s.gradient && typeof s.gradient === "object");
  if (active.length === 0) return false;

  const root = doc.documentElement;
  let defs = root.querySelector("defs");
  if (!defs) {
    defs = doc.createElementNS(SVG_NS, "defs");
    root.insertBefore(defs, root.firstChild);
  }

  const fills = new Map();
  for (const spec of active) {
    const id = addGradientDef(doc, defs, spec.id, spec.gradient, spec.base, w, h);
    if (id) fills.set(spec.clip, `url(#${id})`);
  }
  if (fills.size === 0) return false;

  // Repaint only the groups that actually have a gradient of their own; the
  // rest keep the solid colour the library was given. The needles are full
  // clip-path prefixes because "corners-dot-color" also contains "dot-color".
  let changed = false;
  doc.querySelectorAll("rect[clip-path]").forEach((rect) => {
    const clip = rect.getAttribute("clip-path") || "";
    for (const [needle, fill] of fills) {
      if (!clip.includes(needle)) continue;
      const current = rect.getAttribute("fill") || "";
      if (current === "transparent" || current === "none") return;
      rect.setAttribute("fill", fill);
      changed = true;
      return;
    }
  });
  return changed;
}

/**
 * Paint each figure group (dots, corner squares, corner dots) with its OWN
 * gradient — the dots gradient is canvas-wide so all its modules register
 * perfectly, while the corner groups keep their own gradient/solid colour.
 * (They used to share the dots gradient, which silently ignored the corner
 * colour controls whenever a dots gradient was set.)
 */

const OUTER_CORNER_STYLES = {
  rounded: { radii: [1.5, 1.5, 1.5, 1.5], hole: [1, 1, 1, 1] },
  // classy: big radius on two opposite corners, sharp on the others
  classy: { radii: [2.5, 0, 2.5, 0], hole: [1.6, 0, 1.6, 0] },
  // classy-rounded: same leaf shape, slightly softened remaining corners
  "classy-rounded": { radii: [2.5, 0.9, 2.5, 0.9], hole: [1.6, 0.7, 1.6, 0.7] },
};

/** Build a rounded-rect path with per-corner radii (0 = sharp), all in px. */
function roundedRectPath(x, y, w, h, radii) {
  const [tl, tr, br, bl] = radii;
  let d = `M ${x + tl} ${y}`;
  d += `h ${w - tl - tr}`;
  if (tr) d += `a ${tr} ${tr} 0 0 1 ${tr} ${tr}`;
  d += `v ${h - tr - br}`;
  if (br) d += `a ${br} ${br} 0 0 1 ${-br} ${br}`;
  d += `h ${-(w - br - bl)}`;
  if (bl) d += `a ${bl} ${bl} 0 0 1 ${-bl} ${-bl}`;
  d += `v ${-(h - bl - tl)}`;
  if (tl) d += `a ${tl} ${tl} 0 0 1 ${tl} ${-tl}`;
  return d + "z";
}

/** Resolve the active extended outer/inner corner styles from state. */
function cornerStyleConfig() {
  const inner = state.generator.shapeInner;
  return {
    outerStyle: OUTER_CORNER_STYLES[state.generator.shapeOuter] || null,
    // Ratio matched to the ring's hole radius (see OUTER_CORNER_STYLES:
    // rounded hole is 1/5 modules; the library's extra-rounded hole is
    // 1.5/5), so the inner dot's corners read as the same style as the
    // square's inner corners instead of over-rounding.
    innerRx: inner === "rounded" ? 0.2 : inner === "extra-rounded" ? 0.3 : null,
    innerLeaf: inner === "classy" || inner === "classy-rounded",
  };
}

/** True when the configured corner styles need the SVG rewrite pass. */
export function needsCornerStylePass() {
  const { outerStyle, innerRx, innerLeaf } = cornerStyleConfig();
  return Boolean(outerStyle) || innerRx !== null || innerLeaf;
}

/**
 * Rewrite the vendored library's corner geometry to our extended styles:
 * - outer corner squares gain rounded / classy / classy-rounded by rebuilding
 *   the even-odd ring the library clips its corner rect with (the library
 *   itself always emits the same box, whatever corner type we ask for);
 * - inner corner dots gain rounded / extra-rounded / classy / classy-rounded
 *   (the library renders "square" as a clip rect we can restyle in place).
 * Geometry is validated before touching anything; parse failures bail out.
 * Doc-level pass; returns true when the tree was modified.
 */
export function applyCornerStylesToDoc(doc) {
  const { outerStyle, innerRx, innerLeaf } = cornerStyleConfig();
  if (!outerStyle && innerRx === null && !innerLeaf) return false;
  let changed = false;

  // ---- outer: rewrite the clip-path ring of every corner square ----
  // The library draws the ring as an even-odd path inside
  // <clipPath id="clip-path-corners-square-..."> and paints a plain rect with
  // it, so the box comes from that rect. Rebuilding both subpaths from the box
  // keeps working regardless of how the library serializes its own path.
  if (outerStyle) {
    // Prefetch the defs id map once: the ring lookup below used to run a
    // full-document querySelector for every corner.
    const defs = doc.querySelector("defs");
    const defsById = new Map();
    if (defs) {
      defs.querySelectorAll("[id]").forEach((el) => {
        const id = el.getAttribute("id");
        if (id && !defsById.has(id)) defsById.set(id, el);
      });
    }
    doc.querySelectorAll('rect[clip-path*="corners-square"]').forEach((rect) => {
      const ref = (rect.getAttribute("clip-path") || "").match(/#([^)'"]+)/);
      if (!ref) return;
      // Map first (ids live in defs); fall back to the document-wide query
      // only when the id is not under defs.
      const clip = defsById.get(ref[1]) || doc.querySelector(`[id="${ref[1]}"]`);
      if (!clip) return;
      const x = +rect.getAttribute("x");
      const y = +rect.getAttribute("y");
      const w = +rect.getAttribute("width");
      const h = +rect.getAttribute("height");
      if (!(w > 0 && h > 0)) return;
      const n = Math.min(w, h) / 7;
      const hole = { x: x + n, y: y + n, w: w - 2 * n, h: h - 2 * n };
      if (!(hole.w > 0 && hole.h > 0)) return;
      const path = doc.createElementNS(SVG_NS, "path");
      const previous = clip.querySelector("path");
      const transform = previous && previous.getAttribute("transform");
      if (transform) path.setAttribute("transform", transform);
      path.setAttribute("clip-rule", "evenodd");
      path.setAttribute(
        "d",
        roundedRectPath(
          x,
          y,
          w,
          h,
          outerStyle.radii.map((k) => n * k)
        ) +
          roundedRectPath(
            hole.x,
            hole.y,
            hole.w,
            hole.h,
            outerStyle.hole.map((k) => n * k)
          )
      );
      clip.replaceChildren(path);
      changed = true;
    });
  }

  // ---- inner: clip rect restyle ----
  if (innerRx !== null || innerLeaf) {
    doc.querySelectorAll("clipPath").forEach((clip) => {
      const id = clip.getAttribute("id") || "";
      if (!id.includes("corners-dot")) return;
      clip.querySelectorAll("rect").forEach((rect) => {
        const x = +rect.getAttribute("x");
        const y = +rect.getAttribute("y");
        const w = +rect.getAttribute("width");
        const h = +rect.getAttribute("height");
        if (!(w > 0 && h > 0)) return;
        if (innerLeaf) {
          const r = Math.min(w, h) / 2;
          const path = doc.createElementNS(SVG_NS, "path");
          const transform = rect.getAttribute("transform");
          if (transform) path.setAttribute("transform", transform);
          // leaf: rounded top-left + bottom-right, sharp on the other diagonal
          path.setAttribute(
            "d",
            `M ${x} ${y + r}A ${r} ${r} 0 0 1 ${x + r} ${y}H ${x + w}V ${y + h - r}A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}H ${x}z`
          );
          rect.replaceWith(path);
        } else {
          rect.setAttribute("rx", String(w * innerRx));
        }
        changed = true;
      });
    });
  }

  return changed;
}

/** Set the standard 24x24-to-shape scaling transform on a mask path element. */

/** Move every non-background child of a parsed SVG into a translated group. */
function prepareDocForMask(svgEl, w, h, targetDx, targetDy) {
  if (!svgEl.getAttribute("viewBox")) {
    svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }

  let bgRect = null;
  const childrenToMove = [];
  for (const child of Array.from(svgEl.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "defs") continue;
    if (!bgRect && tag === "rect") {
      bgRect = child;
      continue;
    }
    childrenToMove.push(child);
  }
  if (!bgRect) return null;

  const contentGroup = document.createElementNS(SVG_NS, "g");
  const gMove = document.createElementNS(SVG_NS, "g");
  // Marked so later passes (the logo overlay) can find the code's transform
  // and stay over the code's actual centre instead of the canvas centre.
  gMove.setAttribute("class", "qr-mask-content");
  gMove.setAttribute("data-qr-dx", String(targetDx));
  gMove.setAttribute("data-qr-dy", String(targetDy));
  if (targetDx !== 0 || targetDy !== 0) {
    gMove.setAttribute("transform", `translate(${targetDx}, ${targetDy})`);
  }
  childrenToMove.forEach((c) => gMove.appendChild(c));
  contentGroup.appendChild(gMove);

  return { contentGroup, gMove, bgRect };
}

/**
 * Containment probe for the active mask: a predicate over lattice centres.
 * Both the surround fill and the stepped silhouette use it, so they always
 * agree on which module cells lie inside the shape.
 */
function createMaskProbe({ w, h, userMarginPx, moduleSize, shapeW, shapeH }) {
  const maskType = state.generator.maskType;
  const scaleX = shapeW / 24;
  const scaleY = shapeH / 24;
  const pathD =
    maskType === "heart"
      ? HEART_PATH_D
      : maskType === "custom"
        ? safeMaskPathD(state.generator.maskCustom)
        : BUILT_IN_MASK_PATHS[maskType];
  let path2d = null;
  let canvasCtx = null;
  if (pathD && typeof Path2D !== "undefined") {
    try {
      path2d = new Path2D(pathD);
      const cvs = document.createElement("canvas");
      cvs.width = shapeW;
      cvs.height = shapeH;
      canvasCtx = cvs.getContext("2d");
    } catch {}
  }
  // The ±moduleSize edge probes are the neighbouring cells' own centre probes,
  // so the same lattice point is tested up to 5 times per render. Cache the
  // (expensive) isPointInPath verdict per exact coordinate. Only the Path2D
  // branch is cached — the analytic circle/triangle checks are already cheap.
  const cache = path2d && canvasCtx ? new Map() : null;
  return (cx, cy) => {
    if (maskType === "circle") {
      const r = shapeW / 2;
      const dx = cx - w / 2;
      const dy = cy - h / 2;
      return dx * dx + dy * dy <= (r - moduleSize * 0.15) ** 2;
    }
    if (maskType === "triangle") {
      const topY = userMarginPx;
      const botY = h - userMarginPx;
      if (cy < topY || cy > botY) return false;
      const prog = (cy - topY) / (botY - topY);
      return Math.abs(cx - w / 2) <= (shapeW / 2) * prog - moduleSize * 0.15;
    }
    if (path2d && canvasCtx) {
      const px = (cx - userMarginPx) / scaleX;
      const py = (cy - userMarginPx) / scaleY;
      if (!cache) return canvasCtx.isPointInPath(path2d, px, py);
      let row = cache.get(cx);
      if (row === undefined) cache.set(cx, (row = new Map()));
      let hit = row.get(cy);
      if (hit === undefined) {
        hit = canvasCtx.isPointInPath(path2d, px, py);
        row.set(cy, hit);
      }
      return hit;
    }
    return false;
  };
}

/**
 * Stepped silhouette: one subpath per module cell whose centre is inside the
 * mask, so the background edge follows the module grid instead of a smooth
 * analytic curve. Returns "" when no cell qualifies (invalid custom path).
 */
function buildSteppedMaskPath({ w, h, moduleSize, totalMarginPx, targetDx, targetDy, probe }) {
  const startX = (totalMarginPx + targetDx) % moduleSize;
  const startY = (totalMarginPx + targetDy) % moduleSize;
  let d = "";
  for (let y = startY; y < h; y += moduleSize) {
    for (let x = startX; x < w; x += moduleSize) {
      if (!probe(x + moduleSize / 2, y + moduleSize / 2)) continue;
      d += `M${x} ${y}h${moduleSize}v${moduleSize}h${-moduleSize}z`;
    }
  }
  return d;
}

/**
 * Resolve the surround ring's fill: the solid dots colour, or the same
 * canvas-wide gradient the dots use (so the ring registers with the code).
 * Reuses the shared gradient helper instead of duplicating its geometry.
 */
function surroundRingFill(svgEl, w, h) {
  const doc = svgEl.ownerDocument;
  let defs = svgEl.querySelector("defs");
  if (!defs) {
    defs = doc.createElementNS(SVG_NS, "defs");
    svgEl.insertBefore(defs, svgEl.firstChild);
  }
  const id = addGradientDef(doc, defs, "qr-global-grad", state.generator.dotsGradient, state.generator.dotsColor, w, h);
  return id ? `url(#${id})` : state.generator.dotsColor;
}

/** One surround tile as a plain rect; rx 0 keeps it square. */
function surroundTileRect(x, y, size, rx) {
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", x);
  rect.setAttribute("y", y);
  rect.setAttribute("width", size);
  rect.setAttribute("height", size);
  if (rx > 0) {
    rect.setAttribute("rx", String(rx));
    rect.setAttribute("ry", String(rx));
  }
  return rect;
}

/**
 * Body glyphs for surround tiles, mirroring the vendored library's
 * neighbour-aware dot drawing so the ring matches the code modules exactly.
 * The library picks a primitive from the tile's orthogonal neighbours, then
 * rotates it around the tile centre; this returns that same decision.
 * @param {"square"|"rounded"|"extra-rounded"|"classy"|"classy-rounded"|"dot"|"dots"} shape
 * @param {{ left: boolean, right: boolean, top: boolean, bottom: boolean }} neighbors
 * @returns {{ primitive: "square"|"side"|"corner"|"corner-extra"|"corners"|"dot", rotation: number }}
 */
export function surroundTilePlan(shape, neighbors) {
  const { left: l, right: r, top: t, bottom: b } = neighbors;
  const count = (l ? 1 : 0) + (r ? 1 : 0) + (t ? 1 : 0) + (b ? 1 : 0);
  if (shape === "classy" || shape === "classy-rounded") {
    const leaf = shape === "classy-rounded" ? "corner-extra" : "corner";
    if (count === 0) return { primitive: "corners", rotation: 90 };
    if ((l || t) && (r || b)) return { primitive: "square", rotation: 0 };
    if (l || t) return { primitive: leaf, rotation: 90 };
    return { primitive: leaf, rotation: -90 };
  }
  // rounded / extra-rounded follow the library's dot rules.
  if (count === 0) return { primitive: "dot", rotation: 0 };
  if (count > 2 || (l && r) || (t && b)) return { primitive: "square", rotation: 0 };
  if (count === 2) {
    const rotation = l && t ? 90 : t && r ? 180 : r && b ? -90 : 0;
    return { primitive: shape === "extra-rounded" ? "corner-extra" : "corner", rotation };
  }
  const rotation = t ? 90 : r ? 180 : b ? -90 : 0;
  return { primitive: "side", rotation };
}

/** The library's dot primitives, drawn in tile-local coordinates. */
function surroundPrimitivePath(primitive, x, y, s) {
  switch (primitive) {
    case "square":
      return `M${x} ${y}v${s}h${s}v${-s}z`;
    case "side":
      return `M${x} ${y}v${s}h${s / 2}a${s / 2} ${s / 2} 0 0 0 0 ${-s}`;
    case "corner":
      return `M${x} ${y}v${s}h${s}v${-s / 2}a${s / 2} ${s / 2} 0 0 0 ${-s / 2} ${-s / 2}`;
    case "corner-extra":
      return `M${x} ${y}v${s}h${s}a${s} ${s} 0 0 0 ${-s} ${-s}`;
    default:
      return `M${x} ${y}v${s / 2}a${s / 2} ${s / 2} 0 0 0 ${s / 2} ${s / 2}h${s / 2}v${-s / 2}a${s / 2} ${s / 2} 0 0 0 ${-s / 2} ${-s / 2}`;
  }
}

/** One surround tile carrying the library's neighbour-aware body glyph. */
function surroundTileFor(shape, x, y, size, neighbors) {
  const plan = surroundTilePlan(shape, neighbors);
  let el;
  if (plan.primitive === "dot") {
    el = document.createElementNS(SVG_NS, "circle");
    el.setAttribute("cx", String(x + size / 2));
    el.setAttribute("cy", String(y + size / 2));
    el.setAttribute("r", String(size / 2));
  } else {
    el = document.createElementNS(SVG_NS, "path");
    el.setAttribute("d", surroundPrimitivePath(plan.primitive, x, y, size));
  }
  if (plan.rotation) {
    el.setAttribute("transform", `rotate(${plan.rotation},${x + size / 2},${y + size / 2})`);
  }
  return el;
}

/** Generate the deterministic surround-dot group that fills the mask silhouette. */
function drawSurroundDots({
  svgEl,
  w,
  h,
  moduleCount,
  moduleSize,
  totalMarginPx,
  targetDx,
  targetDy,
  probe,
}) {
  const dataW = moduleCount * moduleSize;
  const qrLeft = totalMarginPx + targetDx;
  const qrTop = totalMarginPx + targetDy;
  const qrRight = qrLeft + dataW;
  const qrBottom = qrTop + dataW;
  const surroundGroup = document.createElementNS(SVG_NS, "g");
  // Marked so the readability check can drop the decorative ring: it touches
  // the code (masks have no quiet zone inside the shape), which defeats jsQR
  // even though the modules themselves are untouched.
  surroundGroup.setAttribute("class", "qr-surround");
  surroundGroup.setAttribute("fill", surroundRingFill(svgEl, w, h));
  const isPointInMask = probe;
  let seed = 0;
  const dataStr = state.generator.dataString || " ";
  for (let i = 0; i < dataStr.length; i++) seed = ((seed << 5) - seed + dataStr.charCodeAt(i)) | 0;
  seed = (seed ^ state.generator.ecc.charCodeAt(0)) | 0;
  const isDark = (r, c) => {
    let v = (r * 374761393 + c * 668265263 + seed) ^ 0x5bf03635;
    v = Math.imul(v ^ (v >>> 16), 0x85ebca6b);
    v = Math.imul(v ^ (v >>> 13), 0xc2b2ae35);
    return ((v ^ (v >>> 16)) & 1) === 1;
  };
  const isEdge = (cx, cy) =>
    !isPointInMask(cx + moduleSize, cy) ||
    !isPointInMask(cx - moduleSize, cy) ||
    !isPointInMask(cx, cy + moduleSize) ||
    !isPointInMask(cx, cy - moduleSize);
  const body = state.generator.shapeBody;
  const startX = qrLeft % moduleSize;
  const startY = qrTop % moduleSize;
  // First pass: collect the tiles that will be painted (inside the silhouette,
  // outside the quiet ring, and either dark or on the silhouette edge). The
  // library's glyphs depend on neighbouring tiles, so the whole map must exist
  // before any tile is drawn.
  /** @type {Map<string, { row: number, col: number, x: number, y: number, cx: number, cy: number, onEdge: boolean }>} */
  const painted = new Map();
  for (let y = startY; y < h; y += moduleSize) {
    for (let x = startX; x < w; x += moduleSize) {
      const cx = x + moduleSize / 2;
      const cy = y + moduleSize / 2;
      if (cx >= qrLeft && cx < qrRight && cy >= qrTop && cy < qrBottom) continue;
      if (!isPointInMask(cx, cy)) continue;
      const col = Math.round((x - qrLeft) / moduleSize);
      const row = Math.round((y - qrTop) / moduleSize);
      const quiet =
        (row >= -1 && row <= 7 && col >= -1 && col <= 7) ||
        (row >= -1 && row <= 7 && col >= moduleCount - 8 && col <= moduleCount) ||
        (row >= moduleCount - 8 && row <= moduleCount && col >= -1 && col <= 7);
      if (quiet) continue;
      const onEdge = isEdge(cx, cy);
      if (!isDark(row, col) && !onEdge) continue;
      painted.set(`${row},${col}`, { row, col, x, y, cx, cy, onEdge });
    }
  }
  const has = (row, col) => painted.has(`${row},${col}`);
  for (const { row, col, x, y, cx, cy, onEdge } of painted.values()) {
    // Edge cells are full squares: the neighbour-aware glyphs cover only part
    // of a cell, which would leave the dark silhouette poking out between the
    // tiles along the stepped boundary. Solid squares keep the outline clean.
    if (body === "square" || onEdge) {
      surroundGroup.appendChild(surroundTileRect(x, y, moduleSize, 0));
      continue;
    }
    if (body === "dots" || body === "dot") {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", cx);
      circle.setAttribute("cy", cy);
      circle.setAttribute("r", (moduleSize / 2) * 0.9);
      surroundGroup.appendChild(circle);
      continue;
    }
    surroundGroup.appendChild(
      surroundTileFor(body, x, y, moduleSize, {
        left: has(row, col - 1),
        right: has(row, col + 1),
        top: has(row - 1, col),
        bottom: has(row + 1, col),
      })
    );
  }
  return surroundGroup;
}

const MASK_SHAPE_TAGS = new Set(["circle", "path", "polygon", "rect"]);

/** The opaque mask silhouette direct child of `container`, or null without one. */
export function findMaskSilhouette(container) {
  if (state.generator.maskType === "none") return null;
  for (const child of container.children) {
    const tag = child.tagName.toLowerCase();
    if (tag === "defs" || tag === "g" || tag === "svg") continue;
    if (MASK_SHAPE_TAGS.has(tag)) return child;
  }
  return null;
}

/**
 * Clone a shape into a clipPath in `container`'s defs (fixed id, replaced on
 * re-render) so overlays can be clipped to the silhouette or the canvas.
 */
export function clipToShape(doc, container, clipId, shape) {
  let defs = container.querySelector("defs");
  if (!defs) {
    defs = doc.createElementNS(SVG_NS, "defs");
    container.insertBefore(defs, container.firstChild);
  }
  const existing = defs.querySelector(`#${clipId}`);
  if (existing) existing.remove();
  const clip = doc.createElementNS(SVG_NS, "clipPath");
  clip.setAttribute("id", clipId);
  clip.appendChild(shape.cloneNode(true));
  defs.appendChild(clip);
  return clipId;
}

/**
 * Clip a user-supplied custom silhouette to the QR canvas. Built-in paths are
 * drawn inside the 24x24 viewBox, but a custom path can extend far outside it;
 * in framed renders the QR canvas is nested with overflow:visible, so without
 * this clip the silhouette would paint over the frame and its label.
 */
function addCanvasClip(doc, root, w, h) {
  let defs = root.querySelector("defs");
  if (!defs) {
    defs = doc.createElementNS(SVG_NS, "defs");
    root.insertBefore(defs, root.firstChild);
  }
  const clipId = "qr-mask-canvas-clip";
  const existing = defs.querySelector(`#${clipId}`);
  if (existing) existing.remove();
  const clip = doc.createElementNS(SVG_NS, "clipPath");
  clip.setAttribute("id", clipId);
  const rect = doc.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "0");
  rect.setAttribute("y", "0");
  rect.setAttribute("width", String(w));
  rect.setAttribute("height", String(h));
  clip.appendChild(rect);
  defs.appendChild(clip);
  return clipId;
}

/**
 * Doc-level mask pass: replace the background rect with the silhouette, wrap
 * the code in a translated group and add the surround-dot layer behind it.
 * Returns true when the tree was modified.
 * @param {Document} svgDoc
 * @param {number} userMarginPx
 * @param {number} w
 * @param {number} h
 * @param {number} [moduleCount]
 * @param {unknown} [_qrMatrix] unused; kept for call-site parity with the string helper
 * @param {{ moduleSize?: number, totalMarginPx?: number, maskDx?: number, maskDy?: number }|null} [layout]
 * @returns {boolean}
 */
export function applySurroundShapeToDoc(
  svgDoc,
  userMarginPx,
  w,
  h,
  moduleCount = 21,
  _qrMatrix = null,
  layout = null
) {
  if (state.generator.maskType === "none") return false;

  // Production callers hand in the resolved layout; the positional fallback
  // keeps the string-level test helper below working with the same table.
  const moduleSize = layout ? layout.moduleSize : moduleSizeFor(state.generator.width, moduleCount);
  const totalMarginPx = layout
    ? layout.totalMarginPx
    : userMarginPx + innerPaddingForMask(state.generator.maskType, moduleCount) * moduleSize;

  const targetDx = layout ? layout.maskDx : 0;
  // Placed from the same table generator.js sized the canvas with, so the
  // shifted code still sits inside the silhouette.
  const targetDy = layout
    ? layout.maskDy
    : maskVerticalShift(state.generator.maskType, moduleCount) * moduleSize;

  const svgEl = svgDoc.documentElement;
  const prepared = prepareDocForMask(svgEl, w, h, targetDx, targetDy);
  if (!prepared) return false;
  const { contentGroup, bgRect } = prepared;

  const shapeW = w - 2 * userMarginPx;
  const shapeH = h - 2 * userMarginPx;

  const probe = createMaskProbe({ w, h, userMarginPx, moduleSize, shapeW, shapeH });
  let steppedD = buildSteppedMaskPath({ w, h, moduleSize, totalMarginPx, targetDx, targetDy, probe });
  // A malformed custom path yields no cells; fall back to the full canvas so
  // the silhouette never disappears.
  if (!steppedD) steppedD = `M0 0h${w}v${h}H0z`;
  const newBgShape = svgDoc.createElementNS(SVG_NS, "path");
  newBgShape.setAttribute("d", steppedD);

  const surroundGroup = drawSurroundDots({
    svgEl,
    w,
    h,
    moduleCount,
    moduleSize,
    totalMarginPx,
    targetDx,
    targetDy,
    probe,
  });
  // Behind the code group: edge dots are drawn at full module size, so on top
  // they could paint over the outer QR modules and visually clip the code.
  contentGroup.insertBefore(surroundGroup, contentGroup.firstChild);

  if (newBgShape) {
    newBgShape.setAttribute("fill", bgRect.getAttribute("fill") || state.generator.bgColor);
    // Marked like the ring: the readability check judges the code itself, and
    // the decorative silhouette fill can drown colored finder patterns.
    newBgShape.setAttribute("class", "qr-mask-bg");
    if (state.generator.maskType === "custom") {
      newBgShape.setAttribute("clip-path", `url(#${addCanvasClip(svgDoc, svgEl, w, h)})`);
    }
    bgRect.replaceWith(newBgShape);
  }

  svgEl.appendChild(contentGroup);

  // Every surround tile shares the group's fill, so its outline is inherited
  // from the group instead of repeated on ~700 children: same rendering,
  // far less markup to serialize and parse.
  const surroundFill = surroundGroup.getAttribute("fill");
  const surroundStroked =
    surroundFill &&
    surroundFill !== "none" &&
    surroundFill !== "transparent" &&
    surroundFill !== state.generator.bgColor;
  if (surroundStroked) {
    surroundGroup.setAttribute("stroke", surroundFill);
    surroundGroup.setAttribute("stroke-width", "0.5");
  }

  // Scope the queries away from the surround group instead of scanning the
  // whole canvas and rejecting its tiles one by one. Same candidates in the
  // same order: the mask silhouette, then the moved code content.
  const shapes = [];
  for (const scope of [newBgShape, ...contentGroup.children]) {
    if (scope === surroundGroup) continue;
    if (scope.matches("path, rect, circle")) shapes.push(scope);
    scope.querySelectorAll("path, rect, circle").forEach((shape) => shapes.push(shape));
  }
  shapes.forEach((shape) => {
    const shapeFill = shape.getAttribute("fill") || shape.closest("g")?.getAttribute("fill");
    if (
      shapeFill &&
      shapeFill !== "none" &&
      shapeFill !== "transparent" &&
      shapeFill !== state.generator.bgColor
    ) {
      shape.setAttribute("stroke", shapeFill);
      shape.setAttribute("stroke-width", "0.5");
    }
  });
  return true;
}
