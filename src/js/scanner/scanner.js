import { DOM } from "../ui/dom.js";
import { state } from "../state";
import { t } from "../i18n.js";
import { copyTextToClipboard } from "../utils.js";
import { MAX_SCAN_UPLOAD_BYTES, SCAN_COOLDOWN_MS } from "../constants.js";
import { flashButton, refreshCustomSelect } from "../ui/components.js";
import { openModal, closeModal } from "../ui/modal.js";
import { addToScanHistory, removeScanHistoryAt, clearScanHistory } from "./history.js";
import {
  initDecoder,
  initWorker,
  hasWorker,
  frameBusy,
  decodeFrame,
  decodeStill,
  clearPendingUpload,
  resetFrameGate,
} from "./decoder.js";
import {
  setScanStatus,
  clearScannerOutput,
  handleScanError,
  handleScanSuccess,
  renderScanResult,
} from "./result.js";

export { renderHistoryList } from "./history.js";

let historyListDelegated = false;

// Bumped on every webcam start/stop so a late-resolving getUserMedia promise
// can detect that its session is stale and release the camera instead of
// attaching a stream while the user has moved on.
let scanSession = 0;

// Bumped on every upload (and on clear) so stale FileReader/Image callbacks
// from a superseded upload can't repaint the preview or the error UI.
let uploadSession = 0;

// True while getUserMedia is still pending; a second toggle click cancels it.
let webcamStartPending = false;

// Decode policy (worker lifecycle, retries, timeouts, jsQR fallback) lives in
// decoder.js; it reports back through these hooks.
initDecoder({
  onResult: handleScanSuccess,
  onUploadError: handleScanError,
  getSession: () => scanSession,
});

const ALLOWED_SCAN_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/svg+xml",
];

export function initScanner() {
  initScannerWorker();
  wireScannerModeTabs();
  wireDropZone();
  wireScanResultButtons();
  wireHistoryDelegation();
  populateCameras();
}

/** Create the decode worker when the platform supports it, with fallback. */
export function initScannerWorker() {
  return initWorker();
}

/** Wire the webcam/upload mode tabs, camera select and camera toggle. */
function wireScannerModeTabs() {
  DOM.btnScanWebcam.addEventListener("click", () => {
    if (state.scanner.mode === "webcam") return;
    state.scanner.mode = "webcam";
    DOM.btnScanWebcam.className = "tab-btn is-active";
    DOM.btnScanUpload.className = "tab-btn";
    DOM.scannerViewCamera.classList.remove("hidden");
    DOM.scannerViewUpload.classList.add("hidden");
    // The mode actually changed: cancel any upload decode still in flight and
    // drop an upload result that no longer matches the visible camera source.
    clearPendingUpload();
    uploadSession++;
    if (!DOM.uploadedPreviewContainer.classList.contains("hidden")) {
      clearScannerOutput();
    }
    startWebcamScan();
  });

  DOM.btnScanUpload.addEventListener("click", () => {
    if (state.scanner.mode === "upload") return;
    state.scanner.mode = "upload";
    DOM.btnScanUpload.className = "tab-btn is-active";
    DOM.btnScanWebcam.className = "tab-btn";
    DOM.scannerViewUpload.classList.remove("hidden");
    DOM.scannerViewCamera.classList.add("hidden");
    // The mode actually changed: cancel any upload decode still in flight and
    // drop a webcam result that no longer matches the upload source.
    clearPendingUpload();
    uploadSession++;
    const wasWebcamActive = Boolean(state.scanner.stream);
    stopWebcamScan();
    if (wasWebcamActive || DOM.uploadedPreviewContainer.classList.contains("hidden")) {
      clearScannerOutput();
    }
  });

  let cameraSwitchPending = false;
  DOM.cameraSelect.addEventListener("change", async () => {
    state.scanner.selectedCameraId = DOM.cameraSelect.value || "";
    if (cameraSwitchPending) return;
    cameraSwitchPending = true;
    try {
      stopWebcamScan();
      await startWebcamScan();
    } finally {
      cameraSwitchPending = false;
    }
  });

  DOM.btnToggleCamera.addEventListener("click", () => {
    if (state.scanner.stream) {
      stopWebcamScan();
      clearScannerOutput();
    } else if (webcamStartPending) {
      // A second click while permission is still pending cancels the start
      // instead of stacking another getUserMedia request.
      stopWebcamScan();
      DOM.cameraLoadingState.classList.add("hidden");
      DOM.cameraErrorState.classList.add("hidden");
    } else {
      startWebcamScan();
    }
  });
}

/** Wire the upload drop zone, file picker and drag-and-drop validation. */
function wireDropZone() {
  DOM.dropZone.addEventListener("click", () => DOM.scanFileInput.click());

  // Keyboard support for the drop zone: Enter or Space opens the file picker.
  DOM.dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      DOM.scanFileInput.click();
    }
  });

  DOM.scanFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) processUploadFile(file);
    DOM.scanFileInput.value = "";
    DOM.dropZone.focus();
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    DOM.dropZone.addEventListener(
      eventName,
      (e) => {
        e.preventDefault();
        DOM.dropZone.classList.add("dragover");
      },
      false
    );
  });

  ["dragleave", "drop"].forEach((eventName) => {
    DOM.dropZone.addEventListener(
      eventName,
      (e) => {
        e.preventDefault();
        DOM.dropZone.classList.remove("dragover");
      },
      false
    );
  });

  DOM.dropZone.addEventListener(
    "drop",
    (e) => {
      const file = e.dataTransfer.files[0];
      // Route through processUploadFile so drops and picker selections share
      // one validation path (empty MIME included).
      if (file) processUploadFile(file);
    },
    false
  );

  // Paste an image straight from the clipboard (screenshots, copied images).
  if (DOM.btnScanPaste) {
    DOM.btnScanPaste.addEventListener("click", async () => {
      const showPasteError = (message) => {
        DOM.errorModalMsg.textContent = message;
        openModal(DOM.errorModal, document.body);
      };
      try {
        if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") {
          showPasteError(t("scanner.clipboardUnsupported"));
          return;
        }
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((t) => ALLOWED_SCAN_IMAGE_TYPES.includes(t));
          if (!type) continue;
          const blob = await item.getType(type);
          const ext = type === "image/jpeg" ? "jpg" : type.split("/")[1];
          // Same validation/decode path as a picked or dropped file.
          processUploadFile(new File([blob], `clipboard.${ext}`, { type }));
          return;
        }
        showPasteError(t("scanner.clipboardEmpty"));
      } catch (err) {
        console.warn("[Scanner] Clipboard paste failed:", err);
        showPasteError(t("scanner.clipboardFailed"));
      }
    });
  }
}

/** Wire the scanner panel action buttons (error close, clear, copy, save). */
function wireScanResultButtons() {
  if (DOM.btnCloseError) {
    DOM.btnCloseError.addEventListener("click", () => {
      closeModal(DOM.errorModal);
    });
  }

  DOM.btnClearUpload.addEventListener("click", (e) => {
    e.stopPropagation();
    uploadSession++;
    // Cancel the in-flight worker decode so its result can't repaint the
    // preview after the user removed it.
    clearPendingUpload();
    DOM.scanFileInput.value = "";
    DOM.uploadedPreviewContainer.classList.add("hidden");
    DOM.uploadedPreview.src = "";
    clearScannerOutput();
  });

  DOM.btnCopyResult.addEventListener("click", async () => {
    const text = DOM.scanResultText.value;
    if (!text) return;
    try {
      const ok = await copyTextToClipboard(text);
      if (!ok) return;
      flashButton(DOM.btnCopyResult, t("controls.copied"), 1500, ["bg-white", "text-black"]);
    } catch (err) {
      console.warn("[QR] scan result copy failed:", err);
    }
  });

  DOM.btnSaveScan.addEventListener("click", () => {
    const text = DOM.scanResultText.value;
    if (!text) return;
    addToScanHistory(text);
    DOM.btnSaveScan.disabled = true;
    flashButton(DOM.btnSaveScan, t("controls.saved"), 1500, ["bg-white", "text-black"]);
  });
}

/** Wire the scan-history clear button and delegated list actions. */
export function wireHistoryDelegation() {
  DOM.btnClearHistory.addEventListener("click", () => {
    if (!clearScanHistory()) return;
    if (!state.scanner.stream && DOM.uploadedPreviewContainer.classList.contains("hidden")) {
      clearScannerOutput();
    }
  });

  if (!historyListDelegated) {
    DOM.historyList.addEventListener("click", async (e) => {
      const link = e.target.closest(".history-link");
      if (link) {
        e.stopPropagation();
        return;
      }

      const btnCopy = e.target.closest(".btn-copy-scan");
      if (btnCopy) {
        e.stopPropagation();
        const idx = parseInt(btnCopy.dataset.idx, 10);
        const item = state.scanner.history[idx];
        if (!item || typeof item.content !== "string" || !item.content) return;
        const ok = await copyTextToClipboard(item.content);
        if (ok) flashButton(btnCopy, t("controls.copied"), 1000, ["bg-white", "text-black"]);
        return;
      }

      const btnDelete = e.target.closest(".btn-delete-scan");
      if (btnDelete) {
        e.stopPropagation();
        const idx = parseInt(btnDelete.dataset.idx, 10);
        // splice(NaN, 1) would silently delete the newest entry instead.
        if (!Number.isNaN(idx)) removeScanHistoryAt(idx);
        return;
      }

      const historyItem = e.target.closest(".history-item");
      if (historyItem) {
        const idx = parseInt(historyItem.dataset.idx, 10);
        const item = state.scanner.history[idx];
        if (item && typeof item.content === "string") {
          renderScanResult(item.content);
        }
      }
    });
    historyListDelegated = true;
  }
}

export function stopWebcamScan() {
  scanSession++;
  webcamStartPending = false;
  // A frame still in flight belongs to the session that just ended; unlock the
  // gate and drop its timer so a restarted session isn't blocked by it.
  resetFrameGate();
  clearFallbackResume();
  DOM.cameraLoadingState.classList.add("hidden");
  DOM.cameraErrorState.classList.add("hidden");
  DOM.scannerReticle.classList.add("opacity-50");
  DOM.scannerReticle.classList.remove("scanning", "scan-success");
  if (state.scanner.stream) {
    state.scanner.stream.getTracks().forEach((track) => track.stop());
    state.scanner.stream = null;
  }
  if (DOM.webcamVideo) {
    DOM.webcamVideo.srcObject = null;
  }
  if (state.scanner.animationFrameId) {
    cancelAnimationFrame(state.scanner.animationFrameId);
    state.scanner.animationFrameId = null;
  }
  DOM.btnToggleCamera.textContent = t("common.start");
  DOM.btnToggleCamera.setAttribute("aria-pressed", "false");
  setScanStatus("idle", t("scanner.statusIdle"));
}

/** User-facing camera failure text for the common getUserMedia error names. */
function describeCameraError(err) {
  const name = err && err.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return t("scanner.accessDenied");
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return t("scanner.noCamera");
  if (name === "NotReadableError" || name === "TrackStartError") return t("scanner.cameraInUse");
  if (name === "OverconstrainedError") return t("scanner.selectedCameraUnavailable");
  return t("scanner.streamFailed");
}

export async function startWebcamScan() {
  stopWebcamScan();
  const session = ++scanSession;
  DOM.cameraLoadingState.classList.remove("hidden");
  DOM.cameraErrorState.classList.add("hidden");
  setScanStatus("scanning", t("scanner.statusStarting"));

  // getUserMedia is unavailable in insecure contexts and very old browsers;
  // report that distinctly instead of a generic stream failure.
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    DOM.cameraLoadingState.classList.add("hidden");
    DOM.cameraErrorState.classList.remove("hidden");
    DOM.cameraErrorMsg.textContent = t("scanner.notSupported");
    setScanStatus("error", t("scanner.statusError"));
    return;
  }

  const selectedDeviceId = DOM.cameraSelect.value;
  const constraints = {
    video: selectedDeviceId
      ? ["user", "environment"].includes(selectedDeviceId)
        ? { facingMode: selectedDeviceId }
        : { deviceId: { exact: selectedDeviceId } }
      : { facingMode: "environment" },
  };

  let stream;
  webcamStartPending = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    // A superseded session must not overwrite the UI the user has moved on to.
    if (session !== scanSession) return;
    webcamStartPending = false;
    DOM.cameraLoadingState.classList.add("hidden");
    DOM.cameraErrorState.classList.remove("hidden");
    DOM.cameraErrorMsg.textContent = describeCameraError(err);
    setScanStatus("error", t("scanner.statusError"));
    return;
  }
  if (session === scanSession) webcamStartPending = false;

  if (session !== scanSession || state.activeTab !== "scanner") {
    stream.getTracks().forEach((track) => track.stop());
    // This session was superseded while getUserMedia was pending: clear the
    // spinner so the UI can't stay stuck on "Starting...".
    DOM.cameraLoadingState.classList.add("hidden");
    return;
  }
  state.scanner.stream = stream;
  // A track can end without a stop() call (device unplugged, OS revoked
  // access, mobile app backgrounded too long). Surface it instead of
  // silently scanning a dead stream.
  state.scanner.stream.getVideoTracks().forEach((track) => {
    if (typeof track.addEventListener !== "function") return;
    track.addEventListener("ended", () => {
      if (session !== scanSession) return;
      stopWebcamScan();
      DOM.cameraErrorState.classList.remove("hidden");
      DOM.cameraErrorMsg.textContent = t("scanner.disconnected");
      setScanStatus("error", t("scanner.statusError"));
    });
  });
  DOM.webcamVideo.srcObject = stream;
  DOM.webcamVideo.setAttribute("playsinline", true);
  // Muted live playback keeps iOS Safari's autoplay policy happy when the
  // session starts without a direct user gesture.
  DOM.webcamVideo.muted = true;
  try {
    await DOM.webcamVideo.play();
  } catch (err) {
    // A superseded session's play() rejection must not tear down the stream
    // that replaced it (stop/start or camera switch while play was pending).
    if (session !== scanSession) return;
    console.warn("[Scanner] Video playback failed:", err);
    stopWebcamScan();
    DOM.cameraErrorState.classList.remove("hidden");
    DOM.cameraErrorMsg.textContent = t("scanner.playbackDenied");
    setScanStatus("error", t("scanner.statusError"));
    return;
  }
  if (session !== scanSession) {
    DOM.cameraLoadingState.classList.add("hidden");
    return;
  }
  // Mirror the preview only for the user-facing camera. Back-facing cameras
  // should not be mirrored — a mirrored QR code is unscannable. Read the
  // facing mode directly from the active track instead of parsing option text.
  const videoTrack = state.scanner.stream.getVideoTracks()[0];
  const trackSettings =
    videoTrack && typeof videoTrack.getSettings === "function" ? videoTrack.getSettings() : {};
  const trackFacingMode = trackSettings.facingMode;
  const isFront = trackFacingMode !== undefined ? trackFacingMode === "user" : selectedDeviceId === "user";
  DOM.webcamVideo.classList.toggle("scale-x-[-1]", isFront);
  DOM.btnToggleCamera.textContent = t("common.stop");
  DOM.btnToggleCamera.setAttribute("aria-pressed", "true");

  await populateCameras();

  if (session !== scanSession) {
    DOM.cameraLoadingState.classList.add("hidden");
    return;
  }
  DOM.cameraLoadingState.classList.add("hidden");
  DOM.scannerReticle.classList.remove("opacity-50");
  DOM.scannerReticle.classList.add("scanning");
  setScanStatus("scanning", t("scanner.statusScanning"));
  state.scanner.animationFrameId = requestAnimationFrame(scanTick);
}

async function populateCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((device) => device.kind === "videoinput");
    state.scanner.cameras = videoDevices;
    DOM.cameraSelect.innerHTML = "";

    if (videoDevices.length === 0) {
      DOM.cameraSelect.innerHTML =
        `<option value="user">${t("common.front")}</option>` +
        `<option value="environment">${t("common.back")}</option>`;
      state.scanner.selectedCameraId = DOM.cameraSelect.value || "";
      refreshCustomSelect(DOM.cameraSelect);
      return;
    }

    videoDevices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || t("scanner.cameraNumber", { count: index + 1 });
      DOM.cameraSelect.appendChild(option);
    });

    if (state.scanner.stream) {
      const activeTrack = state.scanner.stream.getVideoTracks()[0];
      if (activeTrack && typeof activeTrack.getSettings === "function") {
        const settings = activeTrack.getSettings();
        if (settings.deviceId) {
          DOM.cameraSelect.value = settings.deviceId;
        }
      }
    }
    state.scanner.selectedCameraId = DOM.cameraSelect.value || "";
    refreshCustomSelect(DOM.cameraSelect);
  } catch (e) {
    console.error("Error listing cameras:", e);
  }
}

let lastScanTime = 0;
let canvasBuffer = null;
let bufferCtx = null;
let visibilityHandlerBound = false;
// In main-thread fallback mode a successful decode pauses the loop for the
// dedupe cooldown instead of hammering jsQR every frame forever.
let fallbackResumeTimer = null;

function clearFallbackResume() {
  if (fallbackResumeTimer) {
    clearTimeout(fallbackResumeTimer);
    fallbackResumeTimer = null;
  }
}

function scheduleFallbackResume() {
  clearFallbackResume();
  fallbackResumeTimer = setTimeout(() => {
    fallbackResumeTimer = null;
    if (state.scanner.stream && !state.scanner.animationFrameId) {
      state.scanner.animationFrameId = requestAnimationFrame(scanTick);
    }
  }, SCAN_COOLDOWN_MS);
}

// P8 perf: browsers throttle requestAnimationFrame in hidden tabs, but by fully
// dropping the rAF slot (and the decode work) while hidden we also keep the
// deadlock-safety timeout from firing and free the tab's rendering budget.
function ensureVisibilityResume() {
  if (visibilityHandlerBound) return;
  visibilityHandlerBound = true;
  const onVisible = () => {
    if (document.hidden) return;
    visibilityHandlerBound = false;
    document.removeEventListener("visibilitychange", onVisible);
    if (state.scanner.stream && !state.scanner.animationFrameId) {
      state.scanner.animationFrameId = requestAnimationFrame(scanTick);
    }
  };
  document.addEventListener("visibilitychange", onVisible);
}

function scanTick(timestamp) {
  // This frame has started, so its id is consumed; keeping it would make the
  // visibility/fallback resume paths think a frame is still scheduled.
  state.scanner.animationFrameId = null;
  if (!state.scanner.stream) return;
  if (document.hidden) {
    ensureVisibilityResume();
    return;
  }
  if (DOM.webcamVideo.readyState === DOM.webcamVideo.HAVE_ENOUGH_DATA) {
    if (timestamp - lastScanTime > 200 && !frameBusy()) {
      lastScanTime = timestamp;

      if (!canvasBuffer) {
        canvasBuffer = document.getElementById("scanner-buffer-canvas");
        bufferCtx = canvasBuffer ? canvasBuffer.getContext("2d", { willReadFrequently: true }) : null;
      }
      if (!canvasBuffer || !bufferCtx) {
        // Without a drawing buffer there is nothing to decode; stop the loop
        // instead of throwing out of every frame and leaving the camera on.
        console.error("[Scanner] decode canvas unavailable; stopping scan loop");
        state.scanner.animationFrameId = null;
        return;
      }

      try {
        let width = DOM.webcamVideo.videoWidth;
        let height = DOM.webcamVideo.videoHeight;
        if (!width || !height) {
          state.scanner.animationFrameId = requestAnimationFrame(scanTick);
          return;
        }
        if (width > 800) {
          height = Math.round(height * (800 / width));
          width = 800;
        }
        if (canvasBuffer.width !== width) canvasBuffer.width = width;
        if (canvasBuffer.height !== height) canvasBuffer.height = height;
        bufferCtx.drawImage(DOM.webcamVideo, 0, 0, width, height);

        let imageData = bufferCtx.getImageData(0, 0, width, height);

        if (hasWorker() && decodeFrame({ imageData, width, height, session: scanSession })) {
          // Buffer transferred to the worker; drop our stale reference.
          imageData = null;
        }
        if (!frameBusy() && imageData) {
          // Main-thread fallback (no worker, or the post above failed).
          try {
            const decodedResult = jsQR(imageData.data, width, height, {
              inversionAttempts: "attemptBoth",
            });
            if (decodedResult) {
              handleScanSuccess(decodedResult.data);
              // Keep the camera session alive for the next code without
              // decoding every frame on the main thread.
              scheduleFallbackResume();
              return;
            }
          } catch (err) {
            console.error("[Scanner] jsQR error:", err);
          }
        }
      } catch (err) {
        // A capture failure (e.g. a zero-sized frame) must not kill the loop.
        console.error("[Scanner] Frame capture failed:", err);
      }
    }
  }
  state.scanner.animationFrameId = requestAnimationFrame(scanTick);
}

function processUploadFile(file) {
  if (!file) return;
  if (file.type && !ALLOWED_SCAN_IMAGE_TYPES.includes(file.type)) {
    DOM.errorModalMsg.textContent = t("scanner.invalidFileType");
    openModal(DOM.errorModal, document.body);
    return;
  }
  if (file.size > MAX_SCAN_UPLOAD_BYTES) {
    DOM.errorModalMsg.textContent = t("scanner.fileTooLarge");
    openModal(DOM.errorModal, document.body);
    return;
  }
  DOM.uploadedFilename.textContent = file.name;
  DOM.uploadedFilesize.textContent = `${(file.size / 1024).toFixed(1)} KB`;

  const session = ++uploadSession;
  const isCurrent = () => session === uploadSession;
  const reader = new FileReader();
  reader.onload = (e) => {
    if (!isCurrent()) return;
    DOM.uploadedPreview.src = e.target.result;
    DOM.uploadedPreviewContainer.classList.remove("hidden");

    const img = new Image();
    let loaded = false;
    const loadTimeout = setTimeout(() => {
      if (loaded || !isCurrent()) return;
      img.src = "";
      handleScanError();
    }, 30000);
    img.onload = () => {
      if (!isCurrent()) return;
      loaded = true;
      clearTimeout(loadTimeout);
      const MAX_DIM = 1024;
      let w = img.width;
      let h = img.height;
      if (w > MAX_DIM || h > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      // A zero-dimension image (e.g. a dimensionless SVG) would make
      // getImageData throw IndexSizeError; fail it like any other decode.
      if (!w || !h) {
        handleScanError();
        return;
      }

      const bufferCanvas = document.getElementById("scanner-buffer-canvas");
      if (!bufferCanvas) {
        handleScanError();
        return;
      }
      const canvasCtx = bufferCanvas.getContext("2d", { willReadFrequently: true });
      if (!canvasCtx) {
        handleScanError();
        return;
      }
      if (bufferCanvas.width !== w) bufferCanvas.width = w;
      if (bufferCanvas.height !== h) bufferCanvas.height = h;
      canvasCtx.drawImage(img, 0, 0, w, h);

      let imageData = canvasCtx.getImageData(0, 0, w, h);
      let workerPosted = false;

      if (hasWorker() && decodeStill({ imageData, width: w, height: h })) {
        // Buffer transferred to the worker; the reply (or timeout) arrives via
        // the decoder's hooks.
        imageData = null;
        workerPosted = true;
      }
      if (!workerPosted) {
        try {
          const result = jsQR(imageData.data, w, h, { inversionAttempts: "attemptBoth" });
          if (result) {
            handleScanSuccess(result.data);
          } else {
            handleScanError();
          }
        } catch (e) {
          console.error("[Scanner] jsQR error:", e);
          handleScanError();
        }
      }
    };
    img.onerror = () => {
      if (!isCurrent()) return;
      loaded = true;
      clearTimeout(loadTimeout);
      handleScanError();
    };
    img.src = e.target.result;
  };
  reader.onerror = () => {
    if (isCurrent()) handleScanError();
  };
  reader.onabort = () => {
    if (isCurrent()) handleScanError();
  };
  reader.readAsDataURL(file);
}
