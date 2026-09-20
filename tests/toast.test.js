import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

async function freshToastModule() {
  vi.resetModules();
  return import("../src/js/ui/toast.js");
}

describe("showUndoToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates the toast as a polite live region and shows it", async () => {
    const { showUndoToast } = await freshToastModule();
    showUndoToast("HISTORY CLEARED", vi.fn());
    const toast = document.getElementById("undo-toast");
    expect(toast).not.toBeNull();
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    expect(toast.getAttribute("aria-atomic")).toBe("true");
    expect(toast.classList.contains("hidden")).toBe(false);
    expect(toast.textContent).toContain("HISTORY CLEARED");
  });

  it("invokes the undo callback exactly once on UNDO click", async () => {
    const { showUndoToast } = await freshToastModule();
    const onUndo = vi.fn();
    showUndoToast("HISTORY CLEARED", onUndo);
    const btn = document.getElementById("undo-toast-btn");
    expect(btn).not.toBeNull();
    btn.click();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("replaces the previous callback instead of stacking listeners", async () => {
    const { showUndoToast } = await freshToastModule();
    const first = vi.fn();
    const second = vi.fn();
    showUndoToast("FIRST", first);
    showUndoToast("SECOND", second);
    const btn = document.getElementById("undo-toast-btn");
    btn.click();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    btn.click();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("auto-hides after the 5s timeout", async () => {
    const { showUndoToast } = await freshToastModule();
    showUndoToast("HISTORY CLEARED", vi.fn());
    const toast = document.getElementById("undo-toast");
    expect(toast.classList.contains("hidden")).toBe(false);
    vi.advanceTimersByTime(4999);
    expect(toast.classList.contains("hidden")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toast.classList.contains("hidden")).toBe(true);
  });

  it("renders the message as text instead of injecting markup", async () => {
    const { showUndoToast } = await freshToastModule();
    showUndoToast("<img src=x onerror=alert(1)>", vi.fn());
    const toast = document.getElementById("undo-toast");
    expect(toast.querySelector("img")).toBeNull();
    expect(toast.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("keeps the undo action reachable as a keyboard-focusable button", async () => {
    const { showUndoToast } = await freshToastModule();
    showUndoToast("HISTORY CLEARED", vi.fn());
    const btn = document.getElementById("undo-toast-btn");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.tabIndex).toBe(0);
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  it("moves focus out of the toast before it auto-hides", async () => {
    const { showUndoToast } = await freshToastModule();
    showUndoToast("HISTORY CLEARED", vi.fn());
    const toast = document.getElementById("undo-toast");
    const btn = document.getElementById("undo-toast-btn");
    btn.focus();
    vi.advanceTimersByTime(5000);
    expect(toast.classList.contains("hidden")).toBe(true);
    expect(toast.contains(document.activeElement)).toBe(false);
  });
});

describe("announce", () => {
  const frames = [];

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="announcements" role="status" aria-live="polite"></div>';
    frames.length = 0;
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      frames.push(cb);
      return frames.length;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the live region, then writes the message on the next frame", async () => {
    const { announce } = await import("../src/js/ui/announce.js");
    const region = document.getElementById("announcements");
    announce("Copied to clipboard");
    expect(region.textContent).toBe(" ");

    frames.forEach((cb) => cb());
    expect(region.textContent).toBe("Copied to clipboard");
  });

  it("drops a stale frame callback when a newer announcement is queued", async () => {
    const { announce } = await import("../src/js/ui/announce.js");
    const region = document.getElementById("announcements");
    announce("First");
    announce("Second");

    frames[0]();
    expect(region.textContent).toBe(" ");
    frames[1]();
    expect(region.textContent).toBe("Second");
  });

  it("is a safe no-op when the announcements region is absent", async () => {
    document.body.innerHTML = "";
    const { announce } = await import("../src/js/ui/announce.js");
    expect(() => announce("nothing to announce into")).not.toThrow();
  });

  it("drops identical re-render echoes inside the dedupe window", async () => {
    const { announce } = await import("../src/js/ui/announce.js");
    const region = document.getElementById("announcements");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);

    announce("QR code generated and ready for download or copy");
    frames.forEach((cb) => cb());
    expect(region.textContent).toBe("QR code generated and ready for download or copy");

    frames.length = 0;
    announce("QR code generated and ready for download or copy");
    expect(region.textContent).toBe("QR code generated and ready for download or copy");
    expect(frames).toHaveLength(0);

    // Same message after the window is a genuine repeat and announces again.
    nowSpy.mockReturnValue(1_000 + 1_201);
    announce("QR code generated and ready for download or copy");
    expect(region.textContent).toBe(" ");
    frames.forEach((cb) => cb());
    expect(region.textContent).toBe("QR code generated and ready for download or copy");
    nowSpy.mockRestore();
  });

  it("always announces a different message immediately", async () => {
    const { announce } = await import("../src/js/ui/announce.js");
    const region = document.getElementById("announcements");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    announce("First");
    frames.forEach((cb) => cb());
    frames.length = 0;
    announce("Second");
    frames.forEach((cb) => cb());
    expect(region.textContent).toBe("Second");
    nowSpy.mockRestore();
  });
});
