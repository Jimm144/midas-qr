// @ts-check
// Web Worker for QR Code Scanning (Performance Optimization)
// This offloads the CPU-intensive jsQR decoding from the main thread.

importScripts("../../lib/jsqr.min.js");

/**
 * Correlation fields (`mode`, `id`, `session`) are echoed on every reply so
 * the main thread can tell which upload/camera session a result belongs to.
 * A malformed message must never throw out of the listener: an uncaught
 * worker error would fire onerror on the main thread and kill the worker.
 */
self.addEventListener("message", function (e) {
  const payload = e && e.data && typeof e.data === "object" ? e.data : {};
  const { imageData, width, height, inversionAttempts, mode, id, session } = payload;

  try {
    if (!imageData || !imageData.data || !width || !height) {
      self.postMessage({ success: false, error: "invalid-image-data", mode, id, session });
      return;
    }
    if (typeof jsQR !== "function") {
      self.postMessage({ success: false, error: "jsQR unavailable", mode, id, session });
      return;
    }

    const result = jsQR(imageData.data, width, height, {
      inversionAttempts: inversionAttempts || "attemptBoth",
    });

    if (result) {
      self.postMessage({ success: true, data: result.data, mode, id, session });
    } else {
      self.postMessage({ success: false, mode, id, session });
    }
  } catch (err) {
    self.postMessage({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      mode,
      id,
      session,
    });
  }
});
