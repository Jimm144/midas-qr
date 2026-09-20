// @ts-check
/**
 * Single owner of gradient specs: validation and the geometry both gradient
 * renderers need. The QR pass paints canvas-pixel gradients into defs, the
 * frame builder paints 24-unit viewBox gradients as markup — before this
 * module each carried its own validator and its own direction math.
 */
import { HEX_COLOR_RE } from "../utils.js";

/**
 * Normalize a stored GradientSpec. Returns null when the spec is unusable, so
 * callers can treat "invalid" and "absent" the same way. Rotation defaults to
 * 0 for non-finite values; range/clamping is the caller's policy.
 * @param {unknown} spec
 * @returns {{ type: "linear" | "radial", rotation: number, color2: string } | null}
 */
export function parseGradient(spec) {
  if (!spec || typeof spec !== "object") return null;
  const g = /** @type {{ type?: unknown, rotation?: unknown, color2?: unknown }} */ (spec);
  if (g.type !== "linear" && g.type !== "radial") return null;
  if (typeof g.color2 !== "string" || !HEX_COLOR_RE.test(g.color2)) return null;
  const rotation = Number(g.rotation);
  return { type: g.type, rotation: Number.isFinite(rotation) ? rotation : 0, color2: g.color2 };
}

/** Two-stop ramp from the target's solid stop-0 colour to the spec's colour. */
export function gradientStops(baseColor, color2) {
  return [
    { offset: 0, color: baseColor },
    { offset: 1, color: color2 },
  ];
}

/**
 * Projection length of a `rotation`-degree line across a w x h box: the SVG
 * equivalent of CSS's "gradient line covers the box corners".
 */
export function diagonalSpan(w, h, rotation) {
  const th = (rotation * Math.PI) / 180;
  return Math.abs(w * Math.cos(th)) + Math.abs(h * Math.sin(th));
}

/**
 * Endpoints of a centred linear gradient. Callers supply the span so the same
 * math serves canvas pixels, frame viewBox units and the fixed text span.
 * @returns {{ x1: number, y1: number, x2: number, y2: number }}
 */
export function linearEndpoints(cx, cy, len, rotation) {
  const th = (rotation * Math.PI) / 180;
  return {
    x1: cx - (Math.cos(th) * len) / 2,
    y1: cy - (Math.sin(th) * len) / 2,
    x2: cx + (Math.cos(th) * len) / 2,
    y2: cy + (Math.sin(th) * len) / 2,
  };
}
