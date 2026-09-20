// @ts-check
/**
 * Single-flight lazy loader for vendored classic scripts that attach a global.
 * Keeps the in-flight promise per `src`, and clears it once settled so a failed
 * load can be retried on the next call instead of failing forever.
 */

/** A script tag that never fires load/error must not leave callers pending forever. */
const LOAD_TIMEOUT_MS = 20000;

/** @type {Map<string, Promise<boolean>>} */
const inFlight = new Map();

/**
 * Load `src` via an injected `<script>` and resolve true when the optional
 * `globalName` is available. When the global already exists, resolves true
 * immediately without touching the DOM. Resolves false on network/parse error,
 * a hung load (timeout), or when the script loads but does not define the
 * requested global.
 * @param {string} src
 * @param {string} [globalName]
 * @returns {Promise<boolean>}
 */
export function loadVendoredScript(src, globalName) {
  if (typeof src !== "string" || src === "") return Promise.resolve(false);
  const g = /** @type {Record<string, unknown>} */ (globalThis);
  if (globalName && typeof g[globalName] !== "undefined") {
    return Promise.resolve(true);
  }
  const pending = inFlight.get(src);
  if (pending) return pending;

  const promise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    let settled = false;
    let timeout = null;
    // Drop the tag (and its handlers) on every outcome so a failed load can be
    // retried cleanly and listeners can't fire twice. Settling twice must be a
    // no-op: a slow tag can still fire load/error after the timeout won.
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      script.remove();
      resolve(ok);
    };
    script.onload = () => {
      if (globalName && typeof g[globalName] === "undefined") {
        console.error(`[lib-loader] ${src} loaded but global "${globalName}" is not defined`);
        finish(false);
        return;
      }
      finish(true);
    };
    script.onerror = () => {
      console.error(`[lib-loader] Failed to load ${src}`);
      finish(false);
    };
    timeout = setTimeout(() => {
      console.error(`[lib-loader] Timed out loading ${src}`);
      finish(false);
    }, LOAD_TIMEOUT_MS);
    document.head.appendChild(script);
  }).finally(() => {
    if (inFlight.get(src) === promise) inFlight.delete(src);
  });

  inFlight.set(src, promise);
  return promise;
}
