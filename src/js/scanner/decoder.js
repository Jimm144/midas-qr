// @ts-check
/**
 * Owns the decode worker: creation, retry/recycle policy, request
 * correlation, both decode timeouts and the main-thread jsQR fallback.
 *
 * The scanner hands frames in and receives decoded payloads through hooks;
 * camera sessions and upload UI state stay in scanner.js. Two adapters justify
 * the seam: the worker in production, the main thread when workers are
 * unavailable or a post fails.
 */

// A webcam frame that isn't answered within this window is assumed lost (the
// next frame is allowed through). Three consecutive misses recycle the worker.
const WEBCAM_DECODE_TIMEOUT_MS = 1000;
// Uploads are single-shot: give jsQR a generous window before giving up.
const UPLOAD_DECODE_TIMEOUT_MS = 8000;
const MAX_WORKER_RETRIES = 3;
const WORKER_RETRY_DELAY_MS = 2000;

/** @type {Worker | null} */
let worker = null;
let retryTimer = null;
let retryAttempts = 0;
let requestSeq = 0;
let pendingUploadId = 0;
let fallbackTimer = null;
let uploadTimer = null;
let frameInFlight = false;
let consecutiveTimeouts = 0;

/** @type {{ onResult: (data: string) => void, onUploadError: () => void, getSession: () => number }} */
let hooks = {
  onResult: () => {},
  onUploadError: () => {},
  getSession: () => 0,
};

/** Wire the scanner's callbacks. Call once at module init. */
export function initDecoder(nextHooks) {
  hooks = { ...hooks, ...nextHooks };
}

function clearFallback() {
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
}

function clearUploadTimer() {
  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = null;
  }
}

function terminate(target) {
  if (target && typeof target.terminate === "function") {
    try {
      target.terminate();
    } catch (_err) {
      // Worker already gone.
    }
  }
}

function scheduleRetry() {
  if (retryTimer || retryAttempts >= MAX_WORKER_RETRIES) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryAttempts++;
    initWorker();
  }, WORKER_RETRY_DELAY_MS);
}

/**
 * Drop a crashed or unresponsive worker: terminate it so its message queue and
 * transferred buffers are released, then let the retry recreate it. Decoding
 * falls back to the main thread until a worker is available again.
 */
function recycle() {
  const dying = worker;
  const hadPendingUpload = pendingUploadId !== 0;
  worker = null;
  frameInFlight = false;
  pendingUploadId = 0;
  consecutiveTimeouts = 0;
  clearFallback();
  clearUploadTimer();
  terminate(dying);
  scheduleRetry();
  // An upload queued on the recycled worker can no longer be answered: fail
  // the UI like handleError does instead of leaving the panel pending.
  if (hadPendingUpload) hooks.onUploadError();
}

function handleMessage(e) {
  const result = e && e.data;
  if (!result || typeof result !== "object") return;
  const requestId = typeof result.id === "number" ? result.id : 0;

  if (result.mode === "upload") {
    // Require a live matching request: a reply with no id (or after a clear,
    // when the pending id is the 0 sentinel) must never repaint the panel.
    if (requestId === 0 || requestId !== pendingUploadId) return;
    pendingUploadId = 0;
    clearUploadTimer();
    retryAttempts = 0;
    if (result.success && typeof result.data === "string") {
      hooks.onResult(result.data);
    } else {
      hooks.onUploadError();
    }
    return;
  }

  if (result.mode !== "webcam") return;
  // Accept a late frame from the current camera session, but never one from a
  // session that has been stopped or restarted in the meantime.
  if (result.session !== hooks.getSession()) return;
  frameInFlight = false;
  consecutiveTimeouts = 0;
  retryAttempts = 0;
  clearFallback();
  if (result.success && typeof result.data === "string") {
    hooks.onResult(result.data);
  }
}

function handleError(crashed, err) {
  console.error("[Scanner] Worker error:", err);
  if (worker !== crashed) return;
  const hadPendingUpload = pendingUploadId !== 0;
  worker = null;
  frameInFlight = false;
  pendingUploadId = 0;
  consecutiveTimeouts = 0;
  clearFallback();
  clearUploadTimer();
  terminate(crashed);
  // An upload that was in flight cannot be decoded anymore; surface the
  // failure so the UI never stays pending. Webcam frames keep going on the
  // main-thread fallback until the worker is recreated.
  if (hadPendingUpload) hooks.onUploadError();
  scheduleRetry();
}

/** Create the decode worker when the platform supports it, with fallback. */
export function initWorker() {
  if (worker) return worker;
  if (!window.Worker) return null;
  try {
    const created = new Worker("src/js/scanner/worker.js");
    created.onmessage = handleMessage;
    created.onerror = (err) => handleError(created, err);
    worker = created;
    return created;
  } catch (err) {
    console.warn("[Scanner] Worker creation failed, using main thread fallback:", err);
    worker = null;
    return null;
  }
}

export function hasWorker() {
  return Boolean(worker);
}

export function frameBusy() {
  return frameInFlight;
}

/**
 * Post one webcam frame. Returns true when the buffer was transferred to the
 * worker; false means the caller should decode it on the main thread.
 */
export function decodeFrame({ imageData, width, height, session }) {
  if (!worker) return false;
  frameInFlight = true;
  const requestId = ++requestSeq;
  try {
    worker.postMessage(
      {
        imageData,
        width,
        height,
        inversionAttempts: "attemptBoth",
        mode: "webcam",
        id: requestId,
        session,
      },
      [imageData.data.buffer]
    );
    // Deadlock safety fallback; cleared when the worker answers so a stale
    // timer can't unlock a newer in-flight decode.
    clearFallback();
    fallbackTimer = setTimeout(onFrameTimeout, WEBCAM_DECODE_TIMEOUT_MS);
    return true;
  } catch (err) {
    // The worker can die between the null check and postMessage; fall back to
    // the main thread for this frame instead of wedging.
    console.warn("[Scanner] Worker post failed, using main thread fallback:", err);
    frameInFlight = false;
    discard();
    return false;
  }
}

/**
 * Post one uploaded image. Returns true when queued in the worker; false means
 * the caller should decode it on the main thread.
 */
export function decodeStill({ imageData, width, height }) {
  if (!worker) return false;
  const requestId = ++requestSeq;
  try {
    worker.postMessage(
      {
        imageData,
        width,
        height,
        inversionAttempts: "attemptBoth",
        mode: "upload",
        id: requestId,
      },
      [imageData.data.buffer]
    );
    pendingUploadId = requestId;
    clearUploadTimer();
    uploadTimer = setTimeout(onUploadDecodeTimeout, UPLOAD_DECODE_TIMEOUT_MS);
    return true;
  } catch (err) {
    console.warn("[Scanner] Worker post failed, using main thread fallback:", err);
    pendingUploadId = 0;
    clearUploadTimer();
    discard();
    return false;
  }
}

/** Cancel the in-flight upload decode so its result can't repaint the panel. */
export function clearPendingUpload() {
  pendingUploadId = 0;
  clearUploadTimer();
}

/** A ended camera session must not leave its in-flight frame blocking a new one. */
export function resetFrameGate() {
  frameInFlight = false;
  consecutiveTimeouts = 0;
  clearFallback();
}

/** Terminate and forget the current worker, then schedule a rebuild. */
function discard() {
  const dying = worker;
  worker = null;
  terminate(dying);
  scheduleRetry();
}

/**
 * A webcam frame the worker never answered: unlock the gate so the next frame
 * can be captured. Three misses in a row mean the worker is hung — terminate
 * and rebuild it so queued frames and transferred buffers are released.
 */
function onFrameTimeout() {
  fallbackTimer = null;
  if (!frameInFlight) return;
  frameInFlight = false;
  consecutiveTimeouts++;
  if (consecutiveTimeouts >= 3) {
    console.warn("[Scanner] Decode worker unresponsive; recycling it.");
    recycle();
  }
}

/** An uploaded image was never decoded in time: fail the UI and rebuild the worker. */
function onUploadDecodeTimeout() {
  uploadTimer = null;
  if (pendingUploadId === 0) return;
  pendingUploadId = 0;
  console.warn("[Scanner] Upload decode timed out; recycling worker.");
  recycle();
  hooks.onUploadError();
}
