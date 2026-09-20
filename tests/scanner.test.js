import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MAX_SCAN_HISTORY } from "../src/js/constants.js";

async function freshScannerModule() {
  vi.resetModules();
  const dom = await import("../src/js/ui/dom.js");
  const stateMod = await import("../src/js/state");
  const scannerMod = await import("../src/js/scanner/scanner.js");
  dom.DOM.historyList = document.createElement("div");
  dom.DOM.btnClearHistory = document.createElement("button");
  document.body.append(dom.DOM.historyList, dom.DOM.btnClearHistory);
  return {
    DOM: dom.DOM,
    state: stateMod.state,
    renderHistoryList: scannerMod.renderHistoryList,
    initScannerWorker: scannerMod.initScannerWorker,
    startWebcamScan: scannerMod.startWebcamScan,
    stopWebcamScan: scannerMod.stopWebcamScan,
  };
}

function setupCameraDom(DOM) {
  Object.assign(DOM, {
    cameraLoadingState: document.createElement("div"),
    cameraErrorState: document.createElement("div"),
    cameraErrorMsg: document.createElement("p"),
    cameraSelect: document.createElement("select"),
    btnToggleCamera: document.createElement("button"),
    scannerReticle: document.createElement("div"),
    webcamVideo: document.createElement("video"),
    scanStatusBadge: document.createElement("span"),
  });
  DOM.cameraSelect.innerHTML = '<option value="">auto</option>';
  document.body.append(
    DOM.cameraLoadingState,
    DOM.cameraErrorState,
    DOM.cameraSelect,
    DOM.btnToggleCamera,
    DOM.scannerReticle,
    DOM.webcamVideo,
    DOM.scanStatusBadge
  );
  return DOM;
}

function mockMediaDevices(getUserMedia, enumerateDevices = async () => []) {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia, enumerateDevices },
    configurable: true,
  });
  return () => {
    if (descriptor) Object.defineProperty(navigator, "mediaDevices", descriptor);
    else delete navigator.mediaDevices;
  };
}

function installFakeWorker() {
  class FakeWorker {
    constructor() {
      this.messages = [];
      this.terminated = false;
      FakeWorker.instances.push(this);
    }
    postMessage(data, transfer) {
      this.messages.push({ data, transfer });
    }
    terminate() {
      this.terminated = true;
    }
  }
  FakeWorker.instances = [];
  const globalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const windowDescriptor = Object.getOwnPropertyDescriptor(window, "Worker");
  globalThis.Worker = FakeWorker;
  window.Worker = FakeWorker;
  return {
    FakeWorker,
    restore() {
      if (globalDescriptor) Object.defineProperty(globalThis, "Worker", globalDescriptor);
      else delete globalThis.Worker;
      if (windowDescriptor) Object.defineProperty(window, "Worker", windowDescriptor);
      else delete window.Worker;
    },
  };
}

describe("scanner history rendering — malformed stored items", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.resetModules();
  });

  it("renders malformed stored history items without throwing", async () => {
    const { DOM, state, renderHistoryList } = await freshScannerModule();
    state.scanner.history = [
      null,
      { id: 1 },
      { id: 2, content: 42, time: null },
      { id: 3, content: "https://safe.example.com", time: {} },
    ];
    expect(() => renderHistoryList()).not.toThrow();
    expect(DOM.historyList.querySelectorAll(".history-item")).toHaveLength(4);
  });
});

describe("scanner worker error handling", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.resetModules();
  });

  it("ignores malformed worker messages without throwing", async () => {
    const { initScannerWorker } = await freshScannerModule();
    const fake = installFakeWorker();
    try {
      initScannerWorker();
      const worker = fake.FakeWorker.instances[0];
      expect(worker).toBeDefined();
      expect(() => worker.onmessage({ data: null })).not.toThrow();
      expect(() => worker.onmessage({})).not.toThrow();
      expect(() => worker.onmessage({ data: "nope" })).not.toThrow();
    } finally {
      fake.restore();
    }
  });

  it("recovers from a worker error and can create a fallback worker", async () => {
    const { initScannerWorker } = await freshScannerModule();
    const fake = installFakeWorker();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      initScannerWorker();
      const worker = fake.FakeWorker.instances[0];
      expect(() => worker.onerror({ message: "boom" })).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();
      initScannerWorker();
      expect(fake.FakeWorker.instances).toHaveLength(2);
    } finally {
      errorSpy.mockRestore();
      fake.restore();
    }
  });
});

describe("scanner webcam session lifecycle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.resetModules();
  });

  it("does not paint a stale camera error after the session was superseded", async () => {
    const { DOM, state, startWebcamScan, stopWebcamScan } = await freshScannerModule();
    setupCameraDom(DOM);
    state.activeTab = "scanner";
    let rejectStream;
    const getUserMedia = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectStream = reject;
        })
    );
    const restoreMedia = mockMediaDevices(getUserMedia);
    try {
      const pending = startWebcamScan();
      stopWebcamScan();
      rejectStream(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
      await pending;
      expect(DOM.cameraErrorState.classList.contains("hidden")).toBe(true);
      expect(DOM.scanStatusBadge.classList.contains("hidden")).toBe(true);
      expect(DOM.scanStatusBadge.textContent).toBe("");
    } finally {
      restoreMedia();
    }
  });
});

/* ================================================================== */
/* Deep-sweep coverage: camera lifecycle, worker integration, result  */
/* handling and history actions.                                      */
/* ================================================================== */

function makeScannerEl(tag, id) {
  const node = document.createElement(tag);
  node.id = id;
  document.body.appendChild(node);
  return node;
}

function setupFullScannerDom(DOM) {
  Object.assign(DOM, {
    btnScanWebcam: makeScannerEl("button", "btn-scan-webcam"),
    btnScanUpload: makeScannerEl("button", "btn-scan-upload"),
    scannerViewCamera: makeScannerEl("div", "scanner-view-camera"),
    scannerViewUpload: makeScannerEl("div", "scanner-view-upload"),
    cameraLoadingState: makeScannerEl("div", "camera-loading-state"),
    cameraErrorState: makeScannerEl("div", "camera-error-state"),
    cameraErrorMsg: makeScannerEl("span", "camera-error-msg"),
    cameraSelect: makeScannerEl("select", "camera-select"),
    btnToggleCamera: makeScannerEl("button", "btn-toggle-camera"),
    scannerReticle: makeScannerEl("div", "scanner-reticle"),
    webcamVideo: makeScannerEl("video", "webcam-video"),
    dropZone: makeScannerEl("div", "drop-zone"),
    btnScanPaste: makeScannerEl("button", "btn-scan-paste"),
    scanFileInput: makeScannerEl("input", "scan-file-input"),
    uploadedPreviewContainer: makeScannerEl("div", "uploaded-preview-container"),
    uploadedPreview: makeScannerEl("img", "uploaded-preview"),
    uploadedFilename: makeScannerEl("span", "uploaded-filename"),
    uploadedFilesize: makeScannerEl("span", "uploaded-filesize"),
    btnClearUpload: makeScannerEl("button", "btn-clear-upload"),
    emptyStateScan: makeScannerEl("div", "empty-state-scan"),
    scanResultText: makeScannerEl("textarea", "scan-result"),
    scanStatusBadge: makeScannerEl("span", "scan-status-badge"),
    btnCopyResult: makeScannerEl("button", "btn-copy-result"),
    btnSaveScan: makeScannerEl("button", "btn-save-scan"),
    btnVisitResult: makeScannerEl("a", "btn-visit-result"),
    historyList: makeScannerEl("div", "history-list"),
    btnClearHistory: makeScannerEl("button", "btn-clear-history"),
    btnCloseError: makeScannerEl("button", "btn-close-error"),
    errorModal: makeScannerEl("div", "error-modal"),
    errorModalMsg: makeScannerEl("p", "error-modal-msg"),
  });
  makeScannerEl("canvas", "scanner-buffer-canvas");
  DOM.scannerViewCamera.classList.add("hidden");
  DOM.uploadedPreviewContainer.classList.add("hidden");
  DOM.scanResultText.classList.add("hidden");
  DOM.errorModal.classList.add("hidden");
  DOM.btnCopyResult.disabled = true;
  DOM.btnSaveScan.disabled = true;
  DOM.btnVisitResult.href = "#";
  DOM.btnVisitResult.classList.add("opacity-50", "pointer-events-none");
  DOM.btnVisitResult.setAttribute("aria-disabled", "true");
  DOM.webcamVideo.play = vi.fn().mockResolvedValue();
  return DOM;
}

async function freshScannerHarness() {
  vi.resetModules();
  document.body.innerHTML = "";
  const dom = await import("../src/js/ui/dom.js");
  const stateMod = await import("../src/js/state");
  const scannerMod = await import("../src/js/scanner/scanner.js");
  const resultMod = await import("../src/js/scanner/result.js");
  const historyMod = await import("../src/js/scanner/history.js");
  setupFullScannerDom(dom.DOM);
  return {
    DOM: dom.DOM,
    state: stateMod.state,
    scanner: scannerMod,
    result: resultMod,
    history: historyMod,
  };
}

function fakeTrack(settings = {}) {
  return { stop: vi.fn(), getSettings: vi.fn(() => settings), addEventListener: vi.fn() };
}

function fakeStream({ video } = {}) {
  const videoTrack = video || fakeTrack();
  const all = videoTrack ? [videoTrack] : [];
  return {
    getTracks: () => all,
    getVideoTracks: () => (videoTrack ? [videoTrack] : []),
  };
}

function installRaf() {
  const origRaf = globalThis.requestAnimationFrame;
  const origCaf = globalThis.cancelAnimationFrame;
  const queue = new Map();
  let seq = 0;
  globalThis.requestAnimationFrame = (cb) => {
    const id = ++seq;
    queue.set(id, cb);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    queue.delete(id);
  };
  return {
    pending: () => queue.size,
    runNext(ts = 1) {
      const first = queue.entries().next();
      if (first.done) return false;
      queue.delete(first.value[0]);
      first.value[1](ts);
      return true;
    },
    restore() {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCaf;
    },
  };
}

function installCanvasCtx() {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn((_x, _y, w, h) => ({
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
      width: w,
      height: h,
    })),
  };
  const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx);
  return { ctx, restore: () => spy.mockRestore() };
}

function makeVideoReady(video, width = 640, height = 480) {
  Object.defineProperty(video, "readyState", { value: 4, configurable: true });
  Object.defineProperty(video, "videoWidth", { value: width, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: height, configurable: true });
}

function installFileReaderStub() {
  const Orig = globalThis.FileReader;
  class StubFileReader {
    readAsDataURL() {
      this.result = "data:image/png;base64,AAAA";
      setTimeout(() => {
        if (typeof this.onload === "function") this.onload({ target: { result: this.result } });
      }, 0);
    }
  }
  globalThis.FileReader = StubFileReader;
  return { restore: () => (globalThis.FileReader = Orig) };
}

function installImageStub({ width = 64, height = 64 } = {}) {
  const Orig = globalThis.Image;
  class StubImage {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.onload = null;
      this.onerror = null;
      this._src = "";
    }
    set src(value) {
      this._src = value;
      setTimeout(() => {
        if (!value) {
          if (typeof this.onerror === "function") this.onerror();
          return;
        }
        this.width = width;
        this.height = height;
        if (typeof this.onload === "function") this.onload();
      }, 0);
    }
    get src() {
      return this._src;
    }
  }
  globalThis.Image = StubImage;
  return { restore: () => (globalThis.Image = Orig) };
}

function installClipboard(writeText) {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return {
    writeText,
    restore() {
      if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
      else delete navigator.clipboard;
    },
  };
}

function dispatchFileChange(DOM) {
  const file = new File(["fake-bytes"], "code.png", { type: "image/png" });
  Object.defineProperty(DOM.scanFileInput, "files", { value: [file], configurable: true });
  DOM.scanFileInput.dispatchEvent(new Event("change"));
}

describe("scanner camera lifecycle (deep sweep)", () => {
  let cleanups = [];
  const keep = (resource) => {
    if (resource && typeof resource.restore === "function") cleanups.push(resource.restore);
    return resource;
  };

  beforeEach(() => {
    cleanups = [];
    document.body.innerHTML = "";
    vi.resetModules();
  });

  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete document.hidden;
  });

  async function harness({ getUserMedia, devices = [] } = {}) {
    const h = await freshScannerHarness();
    h.raf = keep(installRaf());
    keep(installCanvasCtx());
    keep(mockMediaDevices(getUserMedia || (async () => fakeStream()), async () => devices));
    h.state.activeTab = "scanner";
    return h;
  }

  it("requests facingMode environment by default and attaches/stops the stream cleanly", async () => {
    const videoTrack = fakeTrack({ facingMode: "environment", deviceId: "dev-1" });
    const stream = fakeStream({ video: videoTrack });
    const getUserMedia = vi.fn(async () => stream);
    const h = await harness({ getUserMedia });

    await h.scanner.startWebcamScan();

    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" } });
    expect(h.state.scanner.stream).toBe(stream);
    expect(h.DOM.webcamVideo.srcObject).toBe(stream);
    expect(h.DOM.webcamVideo.muted).toBe(true);
    expect(h.DOM.webcamVideo.getAttribute("playsinline")).not.toBeNull();
    expect(h.DOM.btnToggleCamera.textContent).toBe("Stop");
    expect(h.DOM.btnToggleCamera.getAttribute("aria-pressed")).toBe("true");
    expect(h.DOM.scannerReticle.classList.contains("scanning")).toBe(true);
    expect(h.DOM.scannerReticle.classList.contains("opacity-50")).toBe(false);
    expect(h.DOM.cameraLoadingState.classList.contains("hidden")).toBe(true);
    expect(h.DOM.scanStatusBadge.textContent).toBe("Scanning...");
    expect(h.raf.pending()).toBe(1);

    h.scanner.stopWebcamScan();

    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(h.state.scanner.stream).toBeNull();
    expect(h.DOM.webcamVideo.srcObject).toBeNull();
    expect(h.raf.pending()).toBe(0);
    expect(h.DOM.btnToggleCamera.textContent).toBe("Start");
    expect(h.DOM.btnToggleCamera.getAttribute("aria-pressed")).toBe("false");
    expect(h.DOM.scanStatusBadge.classList.contains("hidden")).toBe(true);
    expect(h.DOM.scanStatusBadge.textContent).toBe("");
  });

  it(
    "pastes an image from the clipboard into the upload pipeline",
    async () => {
      const h = await harness();
      h.scanner.initScanner();
      const png = new Blob(["fake-bytes"], { type: "image/png" });
      const read = vi.fn(async () => [{ types: ["text/plain", "image/png"], getType: async () => png }]);
      const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
      Object.defineProperty(navigator, "clipboard", { value: { read }, configurable: true });
      try {
        h.DOM.btnScanPaste.click();
        // The filename is set before FileReader runs; only the preview
        // container flipping visible proves the decode pipeline finished.
        for (let i = 0; i < 750 && h.DOM.uploadedPreviewContainer.classList.contains("hidden"); i++) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(read).toHaveBeenCalledTimes(1);
        expect(h.DOM.uploadedFilename.textContent).toBe("clipboard.png");
        expect(h.DOM.uploadedPreviewContainer.classList.contains("hidden")).toBe(false);
        expect(h.DOM.errorModal.classList.contains("hidden")).toBe(true);
      } finally {
        if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
        else delete navigator.clipboard;
      }
    },
    30_000
  );

  it("uses facingMode for the virtual Front option and mirrors only the front camera", async () => {
    const videoTrack = fakeTrack({ facingMode: "user" });
    const getUserMedia = vi.fn(async () => fakeStream({ video: videoTrack }));
    const h = await harness({ getUserMedia });
    h.DOM.cameraSelect.innerHTML = '<option value="user">Front</option><option value="environment">Back</option>';
    h.DOM.cameraSelect.value = "user";

    await h.scanner.startWebcamScan();

    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "user" } });
    expect(h.DOM.webcamVideo.classList.contains("scale-x-[-1]")).toBe(true);
    h.scanner.stopWebcamScan();
  });

  it("uses an exact deviceId constraint for enumerated cameras", async () => {
    const devices = [
      { kind: "videoinput", deviceId: "cam-42", label: "Cam 42" },
      { kind: "videoinput", deviceId: "cam-43", label: "Cam 43" },
    ];
    const videoTrack = fakeTrack({ facingMode: "environment", deviceId: "cam-42" });
    const getUserMedia = vi.fn(async () => fakeStream({ video: videoTrack }));
    const h = await harness({ getUserMedia, devices });
    devices.forEach((device) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label;
      h.DOM.cameraSelect.appendChild(option);
    });
    h.DOM.cameraSelect.value = "cam-42";

    await h.scanner.startWebcamScan();

    expect(getUserMedia).toHaveBeenCalledWith({ video: { deviceId: { exact: "cam-42" } } });
    expect(h.DOM.webcamVideo.classList.contains("scale-x-[-1]")).toBe(false);
    h.scanner.stopWebcamScan();
  });

  it("reports an unsupported getUserMedia distinctly", async () => {
    const h = await freshScannerHarness();
    h.raf = keep(installRaf());
    keep(installCanvasCtx());
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    cleanups.push(() => {
      if (descriptor) Object.defineProperty(navigator, "mediaDevices", descriptor);
      else delete navigator.mediaDevices;
    });
    h.state.activeTab = "scanner";

    await h.scanner.startWebcamScan();

    expect(h.DOM.cameraErrorMsg.textContent).toBe("Camera not supported");
    expect(h.DOM.cameraErrorState.classList.contains("hidden")).toBe(false);
    expect(h.DOM.cameraLoadingState.classList.contains("hidden")).toBe(true);
    expect(h.DOM.scanStatusBadge.textContent).toBe("Camera error");
  });

  it("maps common getUserMedia failures to specific messages", async () => {
    const cases = [
      ["NotAllowedError", "Access denied"],
      ["NotFoundError", "No camera found"],
      ["NotReadableError", "Camera is in use by another app"],
      ["OverconstrainedError", "Selected camera unavailable"],
      ["WeirdError", "Stream failed"],
    ];
    for (const [name, expected] of cases) {
      const h = await harness({
        getUserMedia: vi.fn(async () => {
          throw Object.assign(new Error(name), { name });
        }),
      });
      await h.scanner.startWebcamScan();
      expect(h.DOM.cameraErrorMsg.textContent).toBe(expected);
      expect(h.DOM.cameraErrorState.classList.contains("hidden")).toBe(false);
      expect(h.DOM.cameraLoadingState.classList.contains("hidden")).toBe(true);
      expect(h.DOM.scanStatusBadge.textContent).toBe("Camera error");
      h.scanner.stopWebcamScan();
    }
  });

  it("stops the stream and reports an error when video.play() rejects", async () => {
    const videoTrack = fakeTrack({ facingMode: "environment" });
    const stream = fakeStream({ video: videoTrack });
    const h = await harness({ getUserMedia: async () => stream });
    h.DOM.webcamVideo.play = vi.fn().mockRejectedValue(new Error("blocked"));

    await h.scanner.startWebcamScan();

    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(h.DOM.webcamVideo.srcObject).toBeNull();
    expect(h.state.scanner.stream).toBeNull();
    expect(h.DOM.cameraErrorState.classList.contains("hidden")).toBe(false);
    expect(h.DOM.cameraErrorMsg.textContent).toContain("playback denied");
    expect(h.DOM.scanStatusBadge.textContent).toBe("Camera error");
  });

  it("ignores a stale play() rejection from a superseded session", async () => {
    const tracks = [];
    const getUserMedia = vi.fn(async () => {
      const track = fakeTrack();
      tracks.push(track);
      return fakeStream({ video: track });
    });
    const h = await harness({ getUserMedia });

    let rejectPlay;
    const pendingPlay = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectPlay = reject;
        })
    );
    h.DOM.webcamVideo.play = pendingPlay;

    const first = h.scanner.startWebcamScan();
    await vi.waitFor(() => expect(pendingPlay).toHaveBeenCalledTimes(1));

    h.scanner.stopWebcamScan();
    h.DOM.webcamVideo.play = vi.fn().mockResolvedValue();
    const second = h.scanner.startWebcamScan();
    await second;

    rejectPlay(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
    await first;

    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(tracks[1].stop).not.toHaveBeenCalled();
    expect(h.state.scanner.stream).not.toBeNull();
    expect(h.DOM.cameraErrorState.classList.contains("hidden")).toBe(true);
    expect(h.DOM.cameraErrorMsg.textContent).toBe("");
    expect(h.DOM.scanStatusBadge.textContent).toBe("Scanning...");

    h.scanner.stopWebcamScan();
  });

  it("reports a camera track that ends mid-session", async () => {
    const handlers = {};
    const videoTrack = fakeTrack({ facingMode: "environment" });
    videoTrack.addEventListener = vi.fn((type, fn) => {
      handlers[type] = fn;
    });
    const h = await harness({ getUserMedia: async () => fakeStream({ video: videoTrack }) });

    await h.scanner.startWebcamScan();
    expect(typeof handlers.ended).toBe("function");
    handlers.ended();

    expect(h.state.scanner.stream).toBeNull();
    expect(h.DOM.cameraErrorMsg.textContent).toBe("Camera disconnected");
    expect(h.DOM.cameraErrorState.classList.contains("hidden")).toBe(false);
    expect(h.DOM.scanStatusBadge.textContent).toBe("Camera error");
  });

  it("releases a stream that resolves after the session was superseded", async () => {
    let resolveStream;
    const getUserMedia = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveStream = resolve;
        })
    );
    const h = await harness({ getUserMedia });
    const pending = h.scanner.startWebcamScan();
    const videoTrack = fakeTrack();
    h.scanner.stopWebcamScan();

    resolveStream(fakeStream({ video: videoTrack }));
    await pending;

    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(h.state.scanner.stream).toBeNull();
    expect(h.DOM.cameraLoadingState.classList.contains("hidden")).toBe(true);
    expect(h.DOM.scanStatusBadge.classList.contains("hidden")).toBe(true);
    expect(h.DOM.scanStatusBadge.textContent).toBe("");
  });

  it("cancels a pending start when the toggle is clicked again", async () => {
    let resolveStream;
    const getUserMedia = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveStream = resolve;
        })
    );
    const h = await harness({ getUserMedia });
    h.scanner.initScanner();

    h.DOM.btnToggleCamera.click();
    expect(h.DOM.cameraLoadingState.classList.contains("hidden")).toBe(false);
    h.DOM.btnToggleCamera.click();
    expect(h.DOM.cameraLoadingState.classList.contains("hidden")).toBe(true);

    const videoTrack = fakeTrack();
    resolveStream(fakeStream({ video: videoTrack }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(h.DOM.webcamVideo.srcObject).toBeNull();
    expect(h.state.scanner.stream).toBeNull();
  });

  it("resumes the scan loop when the tab becomes visible again", async () => {
    const h = await harness({ getUserMedia: async () => fakeStream() });
    await h.scanner.startWebcamScan();
    expect(h.raf.pending()).toBe(1);

    let hidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    h.raf.runNext(1);
    expect(h.raf.pending()).toBe(0);

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(h.raf.pending()).toBe(1);

    h.scanner.stopWebcamScan();
  });

  it("cycles start/stop/start without leaking streams", async () => {
    const tracks = [];
    const getUserMedia = vi.fn(async () => {
      const track = fakeTrack();
      tracks.push(track);
      return fakeStream({ video: track });
    });
    const h = await harness({ getUserMedia });

    await h.scanner.startWebcamScan();
    await h.scanner.startWebcamScan();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(tracks[1].stop).not.toHaveBeenCalled();
    expect(h.state.scanner.stream).not.toBeNull();
    expect(h.raf.pending()).toBe(1);

    h.scanner.stopWebcamScan();
    expect(tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(h.state.scanner.stream).toBeNull();
    expect(h.raf.pending()).toBe(0);
  });

  it("populates camera options and marks the active device", async () => {
    const devices = [
      { kind: "videoinput", deviceId: "cam-1", label: "One" },
      { kind: "videoinput", deviceId: "cam-2", label: "Two" },
    ];
    const videoTrack = fakeTrack({ facingMode: "environment", deviceId: "cam-2" });
    const h = await harness({ getUserMedia: async () => fakeStream({ video: videoTrack }), devices });

    await h.scanner.startWebcamScan();

    expect(h.DOM.cameraSelect.options).toHaveLength(2);
    expect(h.DOM.cameraSelect.value).toBe("cam-2");
    expect(h.state.scanner.selectedCameraId).toBe("cam-2");
    h.scanner.stopWebcamScan();
  });
});

describe("scanner worker integration (scanTick + uploads)", () => {
  let cleanups = [];
  const keep = (resource) => {
    if (resource && typeof resource.restore === "function") cleanups.push(resource.restore);
    return resource;
  };

  beforeEach(() => {
    cleanups = [];
    document.body.innerHTML = "";
    vi.resetModules();
  });

  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function harnessWithWorker() {
    const h = await freshScannerHarness();
    h.raf = keep(installRaf());
    keep(installCanvasCtx());
    keep(mockMediaDevices(async () => fakeStream(), async () => []));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    cleanups.push(() => errorSpy.mockRestore());
    h.fake = keep(installFakeWorker());
    h.state.activeTab = "scanner";
    h.scanner.initScanner();
    return h;
  }

  it("posts each webcam frame with correlation data and renders a worker result", async () => {
    const h = await harnessWithWorker();
    await h.scanner.startWebcamScan();
    makeVideoReady(h.DOM.webcamVideo);

    h.raf.runNext(250);

    const worker = h.fake.FakeWorker.instances[0];
    expect(worker.messages).toHaveLength(1);
    const msg = worker.messages[0].data;
    expect(msg.mode).toBe("webcam");
    expect(typeof msg.id).toBe("number");
    expect(typeof msg.session).toBe("number");
    expect(worker.messages[0].transfer).toHaveLength(1);

    worker.onmessage({ data: { success: true, data: "HELLO", mode: "webcam", id: msg.id, session: msg.session } });

    expect(h.DOM.scanResultText.value).toBe("HELLO");
    expect(h.DOM.scanStatusBadge.textContent).toBe("Detected");
    h.scanner.stopWebcamScan();
  });

  it("ignores an uncorrelated upload result", async () => {
    const h = await harnessWithWorker();
    const worker = h.fake.FakeWorker.instances[0];
    worker.onmessage({ data: { success: true, data: "SPOOKY", mode: "upload" } });
    expect(h.DOM.scanResultText.value).toBe("");
  });

  it("drops a late worker result whose camera session no longer matches", async () => {
    const h = await harnessWithWorker();
    await h.scanner.startWebcamScan();
    makeVideoReady(h.DOM.webcamVideo);
    h.raf.runNext(250);
    const worker = h.fake.FakeWorker.instances[0];
    const msg = worker.messages[0].data;

    h.scanner.stopWebcamScan();
    worker.onmessage({ data: { success: true, data: "STALE", mode: "webcam", id: msg.id, session: msg.session } });

    expect(h.DOM.scanResultText.value).toBe("");
    expect(h.DOM.scanResultText.classList.contains("hidden")).toBe(true);
    expect(h.DOM.scanStatusBadge.classList.contains("hidden")).toBe(true);
    expect(h.DOM.scanStatusBadge.textContent).toBe("");
  });

  it("recycles an unresponsive worker after three unanswered frames, then retries", async () => {
    vi.useFakeTimers();
    const h = await harnessWithWorker();
    await h.scanner.startWebcamScan();
    makeVideoReady(h.DOM.webcamVideo);
    const worker = h.fake.FakeWorker.instances[0];

    h.raf.runNext(250);
    await vi.advanceTimersByTimeAsync(1000);
    h.raf.runNext(500);
    await vi.advanceTimersByTimeAsync(1000);
    h.raf.runNext(750);
    await vi.advanceTimersByTimeAsync(1000);

    expect(worker.messages).toHaveLength(3);
    expect(worker.terminated).toBe(true);
    expect(h.fake.FakeWorker.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(h.fake.FakeWorker.instances).toHaveLength(2);

    h.scanner.stopWebcamScan();
    vi.clearAllTimers();
  });

  it("terminates and retries a crashed worker", async () => {
    vi.useFakeTimers();
    const h = await harnessWithWorker();
    await h.scanner.startWebcamScan();
    const worker = h.fake.FakeWorker.instances[0];

    worker.onerror({ message: "boom" });
    expect(worker.terminated).toBe(true);
    expect(h.fake.FakeWorker.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(h.fake.FakeWorker.instances).toHaveLength(2);

    h.scanner.stopWebcamScan();
    vi.clearAllTimers();
  });

  it("does not capture frames before the video reports readyState", async () => {
    const h = await harnessWithWorker();
    await h.scanner.startWebcamScan();
    h.raf.runNext(250);
    expect(h.fake.FakeWorker.instances[0].messages).toHaveLength(0);
    h.scanner.stopWebcamScan();
  });

  it("terminates a worker whose postMessage throws and decodes that frame on the main thread", async () => {
    const h = await harnessWithWorker();
    const jsqr = vi.fn(() => ({ data: "RESCUED" }));
    globalThis.jsQR = jsqr;
    cleanups.push(() => {
      delete globalThis.jsQR;
    });
    await h.scanner.startWebcamScan();
    makeVideoReady(h.DOM.webcamVideo);
    const worker = h.fake.FakeWorker.instances[0];
    worker.postMessage = () => {
      throw new Error("clone failed");
    };

    h.raf.runNext(250);

    expect(worker.terminated).toBe(true);
    expect(jsqr).toHaveBeenCalledTimes(1);
    expect(h.DOM.scanResultText.value).toBe("RESCUED");
    h.scanner.stopWebcamScan();
  });

  it("rejects non-image uploads before reading them", async () => {
    const h = await harnessWithWorker();
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(h.DOM.scanFileInput, "files", { value: [file], configurable: true });
    h.DOM.scanFileInput.dispatchEvent(new Event("change"));

    expect(h.DOM.errorModal.classList.contains("hidden")).toBe(false);
    expect(h.DOM.errorModalMsg.textContent).toBe("Invalid file type — an image is required");
    expect(h.fake.FakeWorker.instances[0].messages).toHaveLength(0);
  });

  it("rejects images over the size cap", async () => {
    const h = await harnessWithWorker();
    const file = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 15 * 1024 * 1024 + 1 });
    Object.defineProperty(h.DOM.scanFileInput, "files", { value: [file], configurable: true });
    h.DOM.scanFileInput.dispatchEvent(new Event("change"));

    expect(h.DOM.errorModal.classList.contains("hidden")).toBe(false);
    expect(h.DOM.errorModalMsg.textContent).toBe("File too large (max 15 MB)");
  });

  it("shows the error modal when the worker cannot decode an upload", async () => {
    const h = await harnessWithWorker();
    keep(installFileReaderStub());
    keep(installImageStub());
    const worker = h.fake.FakeWorker.instances[0];

    dispatchFileChange(h.DOM);
    await vi.waitFor(() => {
      expect(worker.messages).toHaveLength(1);
    });
    const msg = worker.messages[0].data;
    worker.onmessage({ data: { success: false, mode: "upload", id: msg.id } });

    expect(h.DOM.errorModal.classList.contains("hidden")).toBe(false);
    expect(h.DOM.errorModalMsg.textContent).toBe("Couldn't decode this image");
    expect(h.DOM.scanStatusBadge.textContent).toBe("Error");
  });

  it("reports an error for a zero-dimension upload instead of stranding the scanner", async () => {
    const h = await harnessWithWorker();
    keep(installFileReaderStub());
    keep(installImageStub({ width: 0, height: 0 }));
    const worker = h.fake.FakeWorker.instances[0];

    dispatchFileChange(h.DOM);
    await vi.waitFor(() => {
      expect(h.DOM.errorModal.classList.contains("hidden")).toBe(false);
    });

    expect(h.DOM.errorModalMsg.textContent).toBe("Couldn't decode this image");
    expect(h.DOM.scanStatusBadge.textContent).toBe("Error");
    // The 0x0 image must never reach the decoder, worker or main thread.
    expect(worker.messages).toHaveLength(0);
  });

  it("resumes the fallback scan loop after the dedupe cooldown", async () => {
    vi.useFakeTimers();
    const h = await freshScannerHarness();
    const raf = keep(installRaf());
    keep(installCanvasCtx());
    keep(mockMediaDevices(async () => fakeStream(), async () => []));
    const workerDescriptor = Object.getOwnPropertyDescriptor(window, "Worker");
    Object.defineProperty(window, "Worker", { value: undefined, configurable: true });
    cleanups.push(() => {
      if (workerDescriptor) Object.defineProperty(window, "Worker", workerDescriptor);
      else delete window.Worker;
    });
    globalThis.jsQR = vi.fn(() => ({ data: "MAIN" }));
    cleanups.push(() => {
      delete globalThis.jsQR;
    });
    h.state.activeTab = "scanner";

    await h.scanner.startWebcamScan();
    makeVideoReady(h.DOM.webcamVideo);
    raf.runNext(250);

    expect(h.DOM.scanResultText.value).toBe("MAIN");
    expect(raf.pending()).toBe(0);

    await vi.advanceTimersByTimeAsync(1500);
    expect(raf.pending()).toBe(1);

    h.scanner.stopWebcamScan();
    vi.clearAllTimers();
  });

  it("falls back to main-thread jsQR when no Worker implementation exists", async () => {
    const h = await freshScannerHarness();
    const raf = keep(installRaf());
    keep(installCanvasCtx());
    keep(mockMediaDevices(async () => fakeStream(), async () => []));
    const workerDescriptor = Object.getOwnPropertyDescriptor(window, "Worker");
    Object.defineProperty(window, "Worker", { value: undefined, configurable: true });
    cleanups.push(() => {
      if (workerDescriptor) Object.defineProperty(window, "Worker", workerDescriptor);
      else delete window.Worker;
    });
    const jsqr = vi.fn(() => ({ data: "MAIN" }));
    globalThis.jsQR = jsqr;
    cleanups.push(() => {
      delete globalThis.jsQR;
    });
    h.state.activeTab = "scanner";

    await h.scanner.startWebcamScan();
    makeVideoReady(h.DOM.webcamVideo);
    raf.runNext(250);

    expect(jsqr).toHaveBeenCalledTimes(1);
    expect(h.DOM.scanResultText.value).toBe("MAIN");
    h.scanner.stopWebcamScan();
  });

  it("decodes an uploaded image through the worker and renders the payload", async () => {
    const h = await harnessWithWorker();
    keep(installFileReaderStub());
    keep(installImageStub());
    const worker = h.fake.FakeWorker.instances[0];

    dispatchFileChange(h.DOM);
    await vi.waitFor(() => {
      expect(worker.messages).toHaveLength(1);
    });

    const msg = worker.messages[0].data;
    expect(msg.mode).toBe("upload");
    expect(typeof msg.id).toBe("number");

    worker.onmessage({ data: { success: true, data: "UPLOAD", mode: "upload", id: msg.id } });

    expect(h.DOM.scanResultText.value).toBe("UPLOAD");
    expect(h.DOM.uploadedPreviewContainer.classList.contains("hidden")).toBe(false);
  });

  it("ignores an upload result after the upload was cleared", async () => {
    const h = await harnessWithWorker();
    keep(installFileReaderStub());
    keep(installImageStub());
    const worker = h.fake.FakeWorker.instances[0];

    dispatchFileChange(h.DOM);
    await vi.waitFor(() => {
      expect(worker.messages).toHaveLength(1);
    });
    const msg = worker.messages[0].data;

    h.DOM.btnClearUpload.click();
    worker.onmessage({ data: { success: true, data: "STALE", mode: "upload", id: msg.id } });

    expect(h.DOM.scanResultText.value).toBe("");
    expect(h.DOM.scanResultText.classList.contains("hidden")).toBe(true);
    expect(h.DOM.uploadedPreviewContainer.classList.contains("hidden")).toBe(true);
  });

  it("clears an upload result when switching to the webcam tab", async () => {
    const h = await harnessWithWorker();
    keep(installFileReaderStub());
    keep(installImageStub());
    const worker = h.fake.FakeWorker.instances[0];

    dispatchFileChange(h.DOM);
    await vi.waitFor(() => {
      expect(worker.messages).toHaveLength(1);
    });
    const msg = worker.messages[0].data;
    worker.onmessage({ data: { success: true, data: "UPLOAD", mode: "upload", id: msg.id } });

    expect(h.DOM.scanResultText.value).toBe("UPLOAD");
    expect(h.DOM.uploadedPreviewContainer.classList.contains("hidden")).toBe(false);

    h.DOM.btnScanWebcam.click();

    expect(h.state.scanner.mode).toBe("webcam");
    expect(h.DOM.scanResultText.value).toBe("");
    expect(h.DOM.scanResultText.classList.contains("hidden")).toBe(true);
    expect(h.DOM.btnCopyResult.disabled).toBe(true);
    expect(h.DOM.btnSaveScan.disabled).toBe(true);

    await vi.waitFor(() => {
      expect(h.state.scanner.stream).not.toBeNull();
    });
    h.scanner.stopWebcamScan();
  });

  it("ignores a stale upload decode after switching to webcam and back", async () => {
    const h = await harnessWithWorker();
    keep(installFileReaderStub());
    keep(installImageStub());
    const worker = h.fake.FakeWorker.instances[0];

    dispatchFileChange(h.DOM);
    await vi.waitFor(() => {
      expect(worker.messages).toHaveLength(1);
    });
    const msg = worker.messages[0].data;

    h.DOM.btnScanWebcam.click();
    await vi.waitFor(() => {
      expect(h.state.scanner.stream).not.toBeNull();
    });
    h.DOM.btnScanUpload.click();

    worker.onmessage({ data: { success: true, data: "STALE", mode: "upload", id: msg.id } });

    expect(h.DOM.scanResultText.value).toBe("");
    expect(h.DOM.scanResultText.classList.contains("hidden")).toBe(true);
  });

  it("clears a webcam result when switching back to the upload tab", async () => {
    const h = await harnessWithWorker();
    h.DOM.btnScanWebcam.click();
    await vi.waitFor(() => {
      expect(h.state.scanner.stream).not.toBeNull();
    });
    makeVideoReady(h.DOM.webcamVideo);
    h.raf.runNext(250);

    const worker = h.fake.FakeWorker.instances[0];
    const msg = worker.messages[0].data;
    worker.onmessage({ data: { success: true, data: "CAMERA", mode: "webcam", id: msg.id, session: msg.session } });
    expect(h.DOM.scanResultText.value).toBe("CAMERA");

    h.DOM.btnScanUpload.click();

    expect(h.state.scanner.mode).toBe("upload");
    expect(h.state.scanner.stream).toBeNull();
    expect(h.DOM.scanResultText.value).toBe("");
    expect(h.DOM.scanResultText.classList.contains("hidden")).toBe(true);
  });

  it("times out a hung upload decode, recycles the worker and shows an error", async () => {
    vi.useFakeTimers();
    const h = await harnessWithWorker();
    keep(installFileReaderStub());
    keep(installImageStub());
    const worker = h.fake.FakeWorker.instances[0];

    dispatchFileChange(h.DOM);
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.messages).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(8000);

    expect(worker.terminated).toBe(true);
    expect(h.DOM.errorModal.classList.contains("hidden")).toBe(false);
    expect(h.DOM.errorModalMsg.textContent).toBe("Couldn't decode this image");
    vi.clearAllTimers();
  });
});

describe("decoder worker recycling", () => {
  let cleanups = [];
  const keep = (resource) => {
    if (resource && typeof resource.restore === "function") cleanups.push(resource.restore);
    return resource;
  };

  beforeEach(() => {
    cleanups = [];
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function freshDecoder() {
    const decoder = await import("../src/js/scanner/decoder.js");
    const fake = keep(installFakeWorker());
    const onUploadError = vi.fn();
    decoder.initDecoder({ onUploadError, onResult: vi.fn() });
    decoder.initWorker();
    return { decoder, fake, onUploadError };
  }

  const fakeImageData = () => ({ data: new Uint8ClampedArray(4) });

  it("fails a pending upload when a webcam-driven recycle kills the worker", async () => {
    const { decoder, fake, onUploadError } = await freshDecoder();
    const worker = fake.FakeWorker.instances[0];

    decoder.decodeStill({ imageData: fakeImageData(), width: 1, height: 1 });
    expect(worker.messages).toHaveLength(1);

    for (let i = 0; i < 3; i++) {
      decoder.decodeFrame({ imageData: fakeImageData(), width: 1, height: 1, session: 1 });
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(worker.terminated).toBe(true);
    expect(onUploadError).toHaveBeenCalledTimes(1);
    vi.clearAllTimers();
  });

  it("notifies once, not twice, when the pending upload's own timeout recycles", async () => {
    const { decoder, fake, onUploadError } = await freshDecoder();
    const worker = fake.FakeWorker.instances[0];

    decoder.decodeStill({ imageData: fakeImageData(), width: 1, height: 1 });
    await vi.advanceTimersByTimeAsync(8000);

    expect(worker.terminated).toBe(true);
    expect(onUploadError).toHaveBeenCalledTimes(1);
    vi.clearAllTimers();
  });
});

describe("scanner result handling", () => {
  let cleanups = [];
  const keep = (resource) => {
    if (resource && typeof resource.restore === "function") cleanups.push(resource.restore);
    return resource;
  };

  beforeEach(() => {
    cleanups = [];
    document.body.innerHTML = "";
    vi.resetModules();
  });

  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders payloads as text, never as markup", async () => {
    const h = await freshScannerHarness();
    const payload = '<img src=x onerror="window.__scanXss=1">';
    h.result.handleScanSuccess(payload);
    expect(h.DOM.scanResultText.value).toBe(payload);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(window.__scanXss).toBeUndefined();
    delete window.__scanXss;
  });

  it("enables scheme-specific visit actions", async () => {
    const h = await freshScannerHarness();

    h.result.handleScanSuccess("https://example.com/a");
    expect(h.DOM.btnVisitResult.getAttribute("href")).toBe("https://example.com/a");
    expect(h.DOM.btnVisitResult.textContent).toBe("Visit URL");
    expect(h.DOM.btnVisitResult.getAttribute("aria-disabled")).toBe("false");

    h.result.handleScanSuccess("tel:+15551234");
    expect(h.DOM.btnVisitResult.getAttribute("href")).toBe("tel:+15551234");
    expect(h.DOM.btnVisitResult.textContent).toBe("Call");

    h.result.handleScanSuccess("mailto:a@b.c");
    expect(h.DOM.btnVisitResult.getAttribute("href")).toBe("mailto:a@b.c");
    expect(h.DOM.btnVisitResult.textContent).toBe("Email");

    h.result.handleScanSuccess("SMSTO:+1555:hello");
    expect(h.DOM.btnVisitResult.getAttribute("href")).toBe("sms:+1555");
    expect(h.DOM.btnVisitResult.textContent).toBe("SMS");

    h.result.handleScanSuccess("plain text payload");
    expect(h.DOM.btnVisitResult.getAttribute("aria-disabled")).toBe("true");
    expect(h.DOM.btnVisitResult.textContent).toBe("Open");
  });

  it("throttles duplicate detections until the output is cleared", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const h = await freshScannerHarness();

    h.result.handleScanSuccess("SAME");
    expect(h.DOM.scanResultText.value).toBe("SAME");

    h.DOM.scanResultText.value = "";
    h.result.handleScanSuccess("SAME");
    expect(h.DOM.scanResultText.value).toBe("");

    h.result.clearScannerOutput();
    h.result.handleScanSuccess("SAME");
    expect(h.DOM.scanResultText.value).toBe("SAME");
  });

  it("resets the throttle after a failed decode", async () => {
    const h = await freshScannerHarness();
    h.result.handleScanSuccess("A");
    h.result.handleScanError();
    expect(h.DOM.scanResultText.value).toBe("");
    h.result.handleScanSuccess("A");
    expect(h.DOM.scanResultText.value).toBe("A");
  });

  it("keeps the visit link out of the tab order while disabled", async () => {
    const h = await freshScannerHarness();
    h.result.clearScannerOutput();
    expect(h.DOM.btnVisitResult.getAttribute("tabindex")).toBe("-1");

    h.result.handleScanSuccess("https://example.com");
    expect(h.DOM.btnVisitResult.hasAttribute("tabindex")).toBe(false);

    h.result.clearScannerOutput();
    expect(h.DOM.btnVisitResult.getAttribute("tabindex")).toBe("-1");
  });

  it("clearScannerOutput disables actions and resets the Open label", async () => {
    const h = await freshScannerHarness();
    h.result.handleScanSuccess("https://example.com");
    expect(h.DOM.btnCopyResult.disabled).toBe(false);
    expect(h.DOM.btnSaveScan.disabled).toBe(false);

    h.result.clearScannerOutput();

    expect(h.DOM.scanResultText.value).toBe("");
    expect(h.DOM.scanResultText.classList.contains("hidden")).toBe(true);
    expect(h.DOM.btnCopyResult.disabled).toBe(true);
    expect(h.DOM.btnSaveScan.disabled).toBe(true);
    expect(h.DOM.btnVisitResult.getAttribute("aria-disabled")).toBe("true");
    expect(h.DOM.btnVisitResult.textContent).toBe("Open");
    expect(h.DOM.scanStatusBadge.classList.contains("hidden")).toBe(true);
    expect(h.DOM.scanStatusBadge.textContent).toBe("");
    expect(h.DOM.emptyStateScan.classList.contains("hidden")).toBe(false);
  });

  it("copies the current result through the copy button", async () => {
    const h = await freshScannerHarness();
    const clipboard = keep(installClipboard(vi.fn(async () => {})));
    h.scanner.initScanner();
    h.result.handleScanSuccess("copy me");
    h.DOM.btnCopyResult.click();
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("copy me"));
  });

  it("shows the error modal for undecodable payloads", async () => {
    const h = await freshScannerHarness();
    h.result.handleScanError();
    expect(h.DOM.errorModal.classList.contains("hidden")).toBe(false);
    expect(h.DOM.errorModalMsg.textContent).toBe("Couldn't decode this image");
    expect(h.DOM.scanStatusBadge.textContent).toBe("Error");
  });
});

describe("scanner history — escaping, persistence and actions", () => {
  let cleanups = [];
  const keep = (resource) => {
    if (resource && typeof resource.restore === "function") cleanups.push(resource.restore);
    return resource;
  };

  beforeEach(() => {
    cleanups = [];
    document.body.innerHTML = "";
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("escapes hostile stored content", async () => {
    const h = await freshScannerHarness();
    const hostile = 'https://example.com/"><img src=x onerror=alert(1)>';
    h.state.scanner.history = [{ id: 1, content: hostile, time: "<b>t</b>" }];
    h.scanner.renderHistoryList();

    expect(h.DOM.historyList.querySelector("img")).toBeNull();
    expect(h.DOM.historyList.querySelector("a")).toBeNull();
    expect(h.DOM.historyList.innerHTML).toContain("&lt;img");
  });

  it("never renders links in history rows", async () => {
    const h = await freshScannerHarness();
    h.state.scanner.history = [{ id: 1, content: "javascript:alert(1)", time: "t" }];
    h.scanner.renderHistoryList();
    expect(h.DOM.historyList.querySelector("a")).toBeNull();
    expect(h.DOM.historyList.querySelector(".history-item")).not.toBeNull();
  });

  it("ignores non-string payloads when saving", async () => {
    const h = await freshScannerHarness();
    h.history.addToScanHistory(null);
    h.history.addToScanHistory(42);
    h.history.addToScanHistory("");
    h.history.addToScanHistory(undefined);
    expect(h.state.scanner.history).toHaveLength(0);
  });

  it("dedupes the newest entry and caps the list", async () => {
    const h = await freshScannerHarness();
    h.history.addToScanHistory("dup");
    h.history.addToScanHistory("dup");
    expect(h.state.scanner.history).toHaveLength(1);

    for (let i = 0; i < 25; i++) h.history.addToScanHistory(`scan-${i}`);

    expect(h.state.scanner.history).toHaveLength(MAX_SCAN_HISTORY);
    expect(h.state.scanner.history[0].content).toBe("scan-24");
    expect(h.state.scanner.history[MAX_SCAN_HISTORY - 1].content).toBe("scan-5");
  });

  it("keeps only the newest entry in memory when persistence keeps failing", async () => {
    const h = await freshScannerHarness();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
      if (key === "qr_state_v1") throw new DOMException("quota", "QuotaExceededError");
    });

    h.history.addToScanHistory("a");
    h.history.addToScanHistory("b");
    h.history.addToScanHistory("c");

    expect(h.state.scanner.history.map((item) => item.content)).toEqual(["c"]);
  });

  it("persists new scans and reloads them through loadState", async () => {
    const h = await freshScannerHarness();
    h.history.addToScanHistory("https://persisted.example/x");
    const raw = localStorage.getItem("qr_state_v1");
    expect(raw).toContain("persisted.example/x");

    h.state.scanner.history = [];
    const stateMod = await import("../src/js/state");
    stateMod.loadState();

    expect(h.state.scanner.history).toHaveLength(1);
    expect(h.state.scanner.history[0].content).toBe("https://persisted.example/x");
  });

  it("deletes an entry and restores it from the undo toast", async () => {
    const h = await freshScannerHarness();
    h.scanner.wireHistoryDelegation();
    h.state.scanner.history = [
      { id: 1, content: "one", time: "t1" },
      { id: 2, content: "two", time: "t2" },
    ];
    h.scanner.renderHistoryList();

    h.DOM.historyList.querySelectorAll(".btn-delete-scan")[0].click();

    expect(h.state.scanner.history.map((item) => item.content)).toEqual(["two"]);
    expect(h.DOM.historyList.querySelectorAll(".history-item")).toHaveLength(1);

    const undoBtn = document.getElementById("undo-toast-btn");
    expect(undoBtn).not.toBeNull();
    undoBtn.click();

    expect(h.state.scanner.history.map((item) => item.content)).toEqual(["one", "two"]);
  });

  it("clears the list and restores it from the undo toast", async () => {
    const h = await freshScannerHarness();
    h.scanner.wireHistoryDelegation();
    h.state.scanner.history = [{ id: 1, content: "keep", time: "t" }];
    h.scanner.renderHistoryList();

    h.DOM.btnClearHistory.click();
    expect(h.state.scanner.history).toHaveLength(0);
    expect(h.DOM.btnClearHistory.disabled).toBe(true);

    document.getElementById("undo-toast-btn").click();
    expect(h.state.scanner.history.map((item) => item.content)).toEqual(["keep"]);
    expect(h.DOM.btnClearHistory.disabled).toBe(false);
  });

  it("copies a stored payload from the list", async () => {
    const h = await freshScannerHarness();
    const clipboard = keep(installClipboard(vi.fn(async () => {})));
    h.scanner.wireHistoryDelegation();
    h.state.scanner.history = [{ id: 1, content: "copy me", time: "t" }];
    h.scanner.renderHistoryList();

    h.DOM.historyList.querySelector(".btn-copy-scan").click();

    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("copy me"));
  });

  it("renders a selected entry and re-enables Save", async () => {
    const h = await freshScannerHarness();
    h.scanner.wireHistoryDelegation();
    h.state.scanner.history = [{ id: 1, content: "https://example.com/h", time: "t" }];
    h.scanner.renderHistoryList();
    h.DOM.btnSaveScan.disabled = true;

    h.DOM.historyList.querySelector(".history-item").click();

    expect(h.DOM.scanResultText.value).toBe("https://example.com/h");
    expect(h.DOM.scanResultText.classList.contains("hidden")).toBe(false);
    expect(h.DOM.btnSaveScan.disabled).toBe(false);
    expect(h.DOM.btnCopyResult.disabled).toBe(false);
    expect(h.DOM.btnVisitResult.getAttribute("href")).toBe("https://example.com/h");
    expect(h.DOM.btnVisitResult.textContent).toBe("Visit URL");
  });
});