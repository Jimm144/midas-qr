// @ts-check
/**
 * Snapshot of the last successfully rendered SVG (post mask/frame pipeline).
 * generator.js publishes it after every render so exports always match the
 * preview — including masks, which only exist in this rendered string.
 */

/**
 * @typedef {{
 *   svg: string,
 *   w: number,
 *   h: number,
 *   moduleCount: number,
 *   userMarginPx: number,
 * }} RenderInfo
 */

/** @type {RenderInfo | null} */
let renderInfo = null;

/**
 * Publish (or clear, with `null`) the last rendered SVG snapshot.
 * @param {RenderInfo | null} info
 * @returns {void}
 */
export function setRenderInfo(info) {
  renderInfo = info;
}

/**
 * The last published snapshot, or null when nothing has been rendered yet.
 * @returns {RenderInfo | null}
 */
export function getRenderInfo() {
  return renderInfo;
}
