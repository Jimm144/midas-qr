import { describe, it, expect, afterEach, vi } from "vitest";

let posts = [];

async function loadWorkerHandler() {
  vi.resetModules();
  posts = [];
  let handler = null;
  const addSpy = vi.spyOn(window, "addEventListener").mockImplementation((type, fn) => {
    if (type === "message") handler = fn;
  });
  globalThis.importScripts = vi.fn();
  vi.spyOn(window, "postMessage").mockImplementation((msg) => {
    posts.push(msg);
  });
  await import("../src/js/scanner/worker.js");
  addSpy.mockRestore();
  return handler;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.importScripts;
  delete globalThis.jsQR;
});

describe("scanner worker protocol", () => {
  it("decodes and echoes mode/id/session correlation fields", async () => {
    const handler = await loadWorkerHandler();
    expect(handler).toBeTypeOf("function");
    const jsqr = vi.fn(() => ({ data: "PAYLOAD" }));
    globalThis.jsQR = jsqr;
    const imageData = { data: new Uint8ClampedArray(4) };

    handler({ data: { imageData, width: 2, height: 2, mode: "webcam", id: 7, session: 3 } });

    expect(jsqr).toHaveBeenCalledWith(imageData.data, 2, 2, { inversionAttempts: "attemptBoth" });
    expect(posts).toEqual([{ success: true, data: "PAYLOAD", mode: "webcam", id: 7, session: 3 }]);
  });

  it("honors a custom inversionAttempts value", async () => {
    const handler = await loadWorkerHandler();
    const jsqr = vi.fn(() => null);
    globalThis.jsQR = jsqr;
    handler({
      data: {
        imageData: { data: new Uint8ClampedArray(4) },
        width: 1,
        height: 1,
        inversionAttempts: "dontInvert",
        mode: "upload",
        id: 1,
      },
    });
    expect(jsqr).toHaveBeenCalledWith(expect.any(Uint8ClampedArray), 1, 1, {
      inversionAttempts: "dontInvert",
    });
    expect(posts).toEqual([{ success: false, mode: "upload", id: 1, session: undefined }]);
  });

  it("reports a jsQR exception instead of letting it escape the listener", async () => {
    const handler = await loadWorkerHandler();
    globalThis.jsQR = vi.fn(() => {
      throw new Error("boom");
    });
    expect(() =>
      handler({ data: { imageData: { data: new Uint8ClampedArray(4) }, width: 1, height: 1, mode: "upload", id: 9 } })
    ).not.toThrow();
    expect(posts).toEqual([
      { success: false, error: "boom", mode: "upload", id: 9, session: undefined },
    ]);
  });

  it("rejects malformed or missing image payloads without crashing", async () => {
    const handler = await loadWorkerHandler();
    globalThis.jsQR = vi.fn(() => null);

    expect(() => handler(undefined)).not.toThrow();
    expect(() => handler({ data: null })).not.toThrow();
    expect(() => handler({ data: "nope" })).not.toThrow();
    expect(() => handler({ data: { imageData: null, width: 1, height: 1, mode: "upload", id: 2 } })).not.toThrow();
    expect(() => handler({ data: { imageData: { data: null }, width: 0, height: 0, mode: "upload", id: 3 } })).not.toThrow();

    expect(posts).toHaveLength(5);
    expect(posts.every((p) => p.success === false && p.error === "invalid-image-data")).toBe(true);
    expect(globalThis.jsQR).not.toHaveBeenCalled();
  });

  it("reports a missing jsQR global instead of decoding", async () => {
    const handler = await loadWorkerHandler();
    handler({ data: { imageData: { data: new Uint8ClampedArray(4) }, width: 1, height: 1, mode: "upload", id: 4 } });
    expect(posts).toEqual([
      { success: false, error: "jsQR unavailable", mode: "upload", id: 4, session: undefined },
    ]);
  });
});
