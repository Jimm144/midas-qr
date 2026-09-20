import { describe, it, expect, afterEach, vi } from "vitest";
import { loadVendoredScript } from "../src/js/lib-loader.js";

function findScript(src) {
  return document.head.querySelector(`script[src="${src}"]`);
}

describe("loadVendoredScript — hung loads, late settling and retry", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.head.querySelectorAll("script").forEach((s) => s.remove());
    delete globalThis.__hungGlobal;
    delete globalThis.__hungSingle;
    delete globalThis.__lateGlobal;
    delete globalThis.__errThenOk;
  });

  it("resolves false after the load timeout, removes the tag and allows a fresh retry", async () => {
    vi.useFakeTimers();
    const src = "src/lib/hung-test.js";
    const first = loadVendoredScript(src, "__hungGlobal");
    const script1 = findScript(src);
    expect(script1).not.toBeNull();

    await vi.advanceTimersByTimeAsync(20001);
    await expect(first).resolves.toBe(false);
    expect(script1.isConnected).toBe(false);

    const second = loadVendoredScript(src, "__hungGlobal");
    const script2 = findScript(src);
    expect(script2).not.toBeNull();
    expect(script2).not.toBe(script1);

    globalThis.__hungGlobal = {};
    script2.dispatchEvent(new Event("load"));
    await expect(second).resolves.toBe(true);
  });

  it("single-flights a hung load between concurrent callers", async () => {
    vi.useFakeTimers();
    const src = "src/lib/hung-single.js";
    const p1 = loadVendoredScript(src, "__hungSingle");
    const p2 = loadVendoredScript(src, "__hungSingle");
    expect(document.head.querySelectorAll(`script[src="${src}"]`)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20001);
    await expect(p1).resolves.toBe(false);
    await expect(p2).resolves.toBe(false);
  });

  it("ignores a late load event after the timeout already settled", async () => {
    vi.useFakeTimers();
    const src = "src/lib/late-load.js";
    const pending = loadVendoredScript(src, "__lateGlobal");
    const script = findScript(src);

    await vi.advanceTimersByTimeAsync(20001);
    await expect(pending).resolves.toBe(false);

    globalThis.__lateGlobal = {};
    expect(() => script.dispatchEvent(new Event("load"))).not.toThrow();
    expect(script.isConnected).toBe(false);
  });

  it("injects an external same-origin script tag with no inline code", async () => {
    const src = "src/lib/csp-test.js";
    const pending = loadVendoredScript(src, "__cspGlobal");
    const script = findScript(src);
    expect(script).not.toBeNull();
    expect(script.getAttribute("src")).toBe(src);
    expect(script.textContent).toBe("");

    globalThis.__cspGlobal = {};
    script.dispatchEvent(new Event("load"));
    await expect(pending).resolves.toBe(true);
    delete globalThis.__cspGlobal;
  });

  it("retries after an error even when the previous caller already gave up", async () => {
    const src = "src/lib/error-then-ok.js";
    const first = loadVendoredScript(src, "__errThenOk");
    findScript(src).dispatchEvent(new Event("error"));
    await expect(first).resolves.toBe(false);
    expect(findScript(src)).toBeNull();

    const second = loadVendoredScript(src, "__errThenOk");
    globalThis.__errThenOk = {};
    findScript(src).dispatchEvent(new Event("load"));
    await expect(second).resolves.toBe(true);
  });
});
