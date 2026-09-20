import { describe, it, expect, afterEach } from "vitest";
import { generateUnicodeQR } from "../src/js/generator/encoder.js";

function stubQrcode({ moduleCount = 4, throwOnMake = false } = {}) {
  globalThis.qrcode = () => ({
    addData: () => {},
    make: () => {
      if (throwOnMake) throw new Error("code length overflow");
    },
    getModuleCount: () => moduleCount,
    isDark: (r, c) => (r + c) % 2 === 0,
  });
}

describe("generateUnicodeQR", () => {
  afterEach(() => {
    delete globalThis.qrcode;
  });

  it("returns null when the vendored encoder is not loaded", () => {
    expect(generateUnicodeQR("hello", "H")).toBe(null);
  });

  it("renders block art with CRLF rows and padding", () => {
    stubQrcode({ moduleCount: 4 });
    const out = generateUnicodeQR("hello", "H");
    expect(typeof out).toBe("string");
    expect(out.startsWith(" ".repeat(8) + "\r\n")).toBe(true);
    expect(out.endsWith(" ".repeat(8) + "\r\n")).toBe(true);
    expect(out).toMatch(/[▀▄█]/);
    expect(out.split("\r\n").length).toBe(2 + 2 + 1); // top pad + 2 row pairs + bottom pad + trailing
  });

  it("returns null when the encoder rejects the payload", () => {
    stubQrcode({ throwOnMake: true });
    expect(generateUnicodeQR("x".repeat(10000), "H")).toBe(null);
  });
});
