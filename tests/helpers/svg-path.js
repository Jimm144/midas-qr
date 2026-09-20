/**
 * Test-only SVG geometry helpers: tokenize/flatten the path commands used by
 * the built-in mask and frame shapes (M/L/H/V/C, relative + absolute, `z`),
 * then point-in-polygon / distance queries over the flattened outline.
 */

const PATH_RE = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

function tokenizePath(d) {
  const tokens = [];
  let match;
  let last = 0;
  PATH_RE.lastIndex = 0;
  while ((match = PATH_RE.exec(d))) {
    if (d.slice(last, match.index).trim() !== "") {
      throw new Error(`Unexpected path token between "${d.slice(last, match.index)}" in: ${d}`);
    }
    tokens.push(match[0]);
    last = match.index + match[0].length;
  }
  if (d.slice(last).trim() !== "") throw new Error(`Unexpected path tail "${d.slice(last)}" in: ${d}`);
  return tokens;
}

function cubicPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]];
}

/**
 * Flatten a path into a polyline (12 samples per cubic). Supports the subset
 * the app's built-in shapes use; throws on anything else so a shape change
 * that needs more parser support fails loudly instead of silently.
 */
export function flattenPath(d) {
  const tokens = tokenizePath(d);
  const points = [];
  let i = 0;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd.toLowerCase() === "z") {
        cx = sx;
        cy = sy;
        continue;
      }
    }
    const rel = cmd >= "a" && cmd <= "z";
    const lower = cmd.toLowerCase();
    if (lower === "m") {
      const x = num();
      const y = num();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      sx = cx;
      sy = cy;
      points.push([cx, cy]);
      cmd = rel ? "l" : "L";
    } else if (lower === "l") {
      const x = num();
      const y = num();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      points.push([cx, cy]);
    } else if (lower === "h") {
      const x = num();
      cx = rel ? cx + x : x;
      points.push([cx, cy]);
    } else if (lower === "v") {
      const y = num();
      cy = rel ? cy + y : y;
      points.push([cx, cy]);
    } else if (lower === "c") {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x = num();
      const y = num();
      const p0 = [cx, cy];
      const p1 = rel ? [cx + x1, cy + y1] : [x1, y1];
      const p2 = rel ? [cx + x2, cy + y2] : [x2, y2];
      const p3 = rel ? [cx + x, cy + y] : [x, y];
      for (let s = 1; s <= 12; s++) points.push(cubicPoint(p0, p1, p2, p3, s / 12));
      cx = p3[0];
      cy = p3[1];
    } else {
      throw new Error(`Unsupported path command "${cmd}"`);
    }
  }
  return points;
}

/** Even-odd-free ray casting; boundary points may land either way. */
export function pointInPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Shortest distance from a point to the polygon outline. */
export function distanceToPolygon(points, x, y) {
  let min = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    min = Math.min(min, pointSegmentDistance(x, y, points[j][0], points[j][1], points[i][0], points[i][1]));
  }
  return min;
}

/** Point inside a rounded rect anchored at (0, 0). */
export function insideRoundedRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const rx = Math.min(r, w / 2);
  const ry = Math.min(r, h / 2);
  const cx = x < rx ? rx : x > w - rx ? w - rx : null;
  const cy = y < ry ? ry : y > h - ry ? h - ry : null;
  if (cx === null || cy === null) return true;
  const nx = (x - cx) / (rx || 1);
  const ny = (y - cy) / (ry || 1);
  return nx * nx + ny * ny <= 1 + 1e-9;
}
