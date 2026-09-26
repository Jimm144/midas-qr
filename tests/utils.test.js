import { describe, it, expect, vi, afterEach } from "vitest";
import {
  escapeHTML,
  escapeWifiStr,
  escapeVCard,
  stripProtocol,
  sanitizeMaskPath,
  copyTextToClipboard,
  HEX_COLOR_RE,
  isSafeBitmapDataUrl,
  formatHistoryTimestamp,
  snapshot,
  truncateSafe,
} from "../src/js/utils.js";
import { loadVendoredScript } from "../src/js/lib-loader.js";
import { getIntlLocale } from "../src/js/i18n.js";

describe("HEX_COLOR_RE", () => {
  it("accepts six-digit hex and rejects everything else", () => {
    expect(HEX_COLOR_RE.test("#03A5F1")).toBe(true);
    expect(HEX_COLOR_RE.test("#abc")).toBe(false);
    expect(HEX_COLOR_RE.test("03A5F1")).toBe(false);
    expect(HEX_COLOR_RE.test("#03A5F1 ")).toBe(false);
  });
});

describe("isSafeBitmapDataUrl", () => {
  it("accepts base64 bitmap data URLs", () => {
    expect(isSafeBitmapDataUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isSafeBitmapDataUrl("data:image/jpeg;base64,BBBB")).toBe(true);
  });
  it("rejects SVG, remote, script and non-string payloads", () => {
    expect(isSafeBitmapDataUrl("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(isSafeBitmapDataUrl("https://example.com/logo.png")).toBe(false);
    expect(isSafeBitmapDataUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeBitmapDataUrl(null)).toBe(false);
    expect(isSafeBitmapDataUrl({})).toBe(false);
  });
});

describe("formatHistoryTimestamp", () => {
  it("composes locale time with a short date", () => {
    const ts = new Date(2026, 8, 16, 14, 32).getTime();
    const d = new Date(ts);
    // The formatter follows the active UI language, not the runtime default,
    // so the expectation has to ask for the same locale.
    const locale = getIntlLocale();
    const expected =
      d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) +
      " " +
      d.toLocaleDateString(locale, { month: "short", day: "numeric" });
    expect(formatHistoryTimestamp(ts)).toBe(expected);
  });
});

describe("truncateSafe", () => {
  it("returns short strings unchanged", () => {
    expect(truncateSafe("abc", 3)).toBe("abc");
    expect(truncateSafe("abc", 10)).toBe("abc");
  });

  it("truncates plain text at the cap", () => {
    expect(truncateSafe("abcdef", 4)).toBe("abcd");
  });

  it("never leaves a lone high surrogate at the cut", () => {
    const emoji = "😀".repeat(8);
    const out = truncateSafe(emoji, 15);
    expect(out).toBe("😀".repeat(7));
    expect(out.length).toBe(14);
  });

  it("coerces non-strings", () => {
    expect(truncateSafe(null, 3)).toBe("");
    expect(truncateSafe(12345, 3)).toBe("123");
  });
});

describe("snapshot", () => {
  it("deep-copies nested JSON-safe structures", () => {
    const source = { a: 1, nested: { list: [1, 2, { b: true }] } };
    const copy = snapshot(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(copy.nested).not.toBe(source.nested);
    copy.nested.list[2].b = false;
    expect(source.nested.list[2].b).toBe(true);
  });
});

describe("escapeHTML", () => {
  it("escapes all five HTML metacharacters", () => {
    expect(escapeHTML(`<a href="x" title='y'>&amp;</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;amp;&lt;/a&gt;"
    );
  });
  it("returns empty string for null/undefined", () => {
    expect(escapeHTML(null)).toBe("");
    expect(escapeHTML(undefined)).toBe("");
  });
  it("passes through safe characters", () => {
    expect(escapeHTML("Hello World 123")).toBe("Hello World 123");
  });
  it("escapes the full metacharacter set in one pass", () => {
    expect(escapeHTML("&<>'\"")).toBe("&amp;&lt;&gt;&#39;&quot;");
  });
});

describe("escapeWifiStr", () => {
  it("escapes backslash, semicolon, colon, comma, and quote", () => {
    expect(escapeWifiStr(`a\\b;c:d,e"f`)).toBe(`a\\\\b\\;c\\:d\\,e\\"f`);
  });
  it("preserves normal characters", () => {
    expect(escapeWifiStr("MyNetwork")).toBe("MyNetwork");
  });
});

describe("escapeVCard", () => {
  it("escapes backslash, comma, semicolon", () => {
    expect(escapeVCard("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
  });
  it("converts newlines to \\n", () => {
    expect(escapeVCard("line1\nline2")).toBe("line1\\nline2");
  });
  it("escapes a backslash directly before a newline in a single pass", () => {
    expect(escapeVCard("a\\\nb")).toBe("a" + "\\\\" + "\\n" + "b");
  });
  it("keeps comma and newline escaping order stable", () => {
    expect(escapeVCard("x,\ny")).toBe("x\\,\\ny");
  });
});

describe("stripProtocol", () => {
  it("strips http:// and https://", () => {
    expect(stripProtocol("http://example.com")).toBe("example.com");
    expect(stripProtocol("https://example.com")).toBe("example.com");
  });
  it("leaves non-http strings unchanged", () => {
    expect(stripProtocol("file://x")).toBe("file://x");
    expect(stripProtocol("plain")).toBe("plain");
  });
});

describe("sanitizeMaskPath", () => {
  it("preserves valid path data", () => {
    expect(sanitizeMaskPath("M12 2 L24 24 L0 24 Z")).toBe("M12 2 L24 24 L0 24 Z");
  });
  it("strips quotes and angle brackets from a script-injection attempt", () => {
    const payload = `M0 0\" onload=\"alert(1)\"><script>alert(2)</script>`;
    const clean = sanitizeMaskPath(payload);
    expect(clean).not.toContain('"');
    expect(clean).not.toContain("<");
    expect(clean).not.toContain(">");
    expect(clean).toContain("M0 0");
  });
  it("strips semicolons and equals signs", () => {
    expect(sanitizeMaskPath("M0 0;alert=1")).toBe("M0 0alert1");
  });
  it("returns empty string for null/undefined/empty", () => {
    expect(sanitizeMaskPath(null)).toBe("");
    expect(sanitizeMaskPath(undefined)).toBe("");
    expect(sanitizeMaskPath("")).toBe("");
  });
});
describe("copyTextToClipboard", () => {
  it("returns false when no clipboard mechanism exists", async () => {
    await expect(copyTextToClipboard("hello")).resolves.toBe(false);
  });

  it("returns true when the async Clipboard API succeeds", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: async () => {} },
      configurable: true,
    });
    try {
      await expect(copyTextToClipboard("hello")).resolves.toBe(true);
    } finally {
      if (descriptor) Object.defineProperty(window.navigator, "clipboard", descriptor);
      else delete window.navigator.clipboard;
    }
  });

  it("falls back gracefully when the async API rejects", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
    Object.defineProperty(window.navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
      configurable: true,
    });
    try {
      // jsdom has no working execCommand copy, so the fallback reports false.
      await expect(copyTextToClipboard("hello")).resolves.toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(window.navigator, "clipboard", descriptor);
      else delete window.navigator.clipboard;
    }
  });
});

describe("escape helpers — table-driven", () => {
  it.each([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ["'", "&#39;"],
    ['"', "&quot;"],
    ["a & b < c > d", "a &amp; b &lt; c &gt; d"],
    ["already &amp;", "already &amp;amp;"],
    ["plain text 42", "plain text 42"],
    ["ümlaut 😀", "ümlaut 😀"],
    ["", ""],
  ])("escapeHTML(%j) -> %j", (input, expected) => {
    expect(escapeHTML(input)).toBe(expected);
  });

  it.each([
    ["a\\b", "a\\\\b"],
    ["a;b", "a\\;b"],
    ["a:b", "a\\:b"],
    ["a,b", "a\\,b"],
    ['a"b', 'a\\"b'],
    ["plain", "plain"],
    ["", ""],
  ])("escapeWifiStr(%j) -> %j", (input, expected) => {
    expect(escapeWifiStr(input)).toBe(expected);
  });

  it.each([
    ["a,b;c\\d", "a\\,b\\;c\\\\d"],
    ["line1\nline2", "line1\\nline2"],
    ["a\\\nb", "a" + "\\\\" + "\\n" + "b"],
    ["a\r\nb", "a\\nb"],
    ["a\rb", "a\\nb"],
    ["plain", "plain"],
    ["", ""],
  ])("escapeVCard(%j) -> %j", (input, expected) => {
    expect(escapeVCard(input)).toBe(expected);
  });

  it("escapes nullish inputs as empty strings", () => {
    expect(escapeHTML(null)).toBe("");
    expect(escapeHTML(undefined)).toBe("");
    expect(escapeWifiStr(null)).toBe("");
    expect(escapeWifiStr(undefined)).toBe("");
    expect(escapeVCard(null)).toBe("");
    expect(escapeVCard(undefined)).toBe("");
  });
});

describe("snapshot — JSON fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("deep-copies when structuredClone is unavailable", () => {
    vi.stubGlobal("structuredClone", undefined);
    const source = { a: 1, nested: { list: [1, 2, { b: true }] } };
    const copy = snapshot(source);
    expect(copy).toEqual(source);
    expect(copy.nested).not.toBe(source.nested);
    copy.nested.list[2].b = false;
    expect(source.nested.list[2].b).toBe(true);
  });

  it("falls back to a JSON copy when structuredClone throws on non-cloneable values", () => {
    vi.stubGlobal("structuredClone", () => {
      throw new DOMException("could not be cloned", "DataCloneError");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = { a: 1, cachedG: document.createElement("g") };
    const copy = snapshot(source);
    expect(copy.a).toBe(1);
    expect(copy).not.toBe(source);
    expect(warn).toHaveBeenCalled();
  });
});

describe("copyTextToClipboard — legacy fallback hardening", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
  const originalExec = document.execCommand;

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(window.navigator, "clipboard", originalClipboard);
    else delete window.navigator.clipboard;
    if (originalExec === undefined) delete document.execCommand;
    else document.execCommand = originalExec;
    document.querySelectorAll("textarea").forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it("uses execCommand and detaches the scratch textarea on success", async () => {
    Object.defineProperty(window.navigator, "clipboard", { value: undefined, configurable: true });
    const exec = vi.fn(() => true);
    document.execCommand = exec;
    await expect(copyTextToClipboard("hello")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("detaches the scratch textarea even when execCommand throws", async () => {
    Object.defineProperty(window.navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = () => {
      throw new Error("nope");
    };
    await expect(copyTextToClipboard("hello")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls through when writeText is not a function and coerces the text", async () => {
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: "not-a-function" },
      configurable: true,
    });
    document.execCommand = () => true;
    let captured = null;
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === "textarea") captured = el;
      return el;
    });
    await expect(copyTextToClipboard(42)).resolves.toBe(true);
    expect(captured && captured.value).toBe("42");
  });

  it("returns false when writeText throws synchronously and the fallback fails", async () => {
    Object.defineProperty(window.navigator, "clipboard", {
      value: {
        writeText: () => {
          throw new Error("sync");
        },
      },
      configurable: true,
    });
    document.execCommand = () => false;
    await expect(copyTextToClipboard("x")).resolves.toBe(false);
  });
});

describe("loadVendoredScript — single-flight, cleanup and retry", () => {
  afterEach(() => {
    document.head.querySelectorAll('script[src^="src/lib/"]').forEach((s) => s.remove());
    delete globalThis.__libLoaderSingleFlight;
    delete globalThis.__libLoaderRetry;
    delete globalThis.__libLoaderAlready;
    vi.restoreAllMocks();
  });

  it("single-flights concurrent loads of the same src", async () => {
    const spy = vi.spyOn(document.head, "appendChild");
    const src = "src/lib/single-flight-test.js";
    const p1 = loadVendoredScript(src, "__libLoaderSingleFlight");
    const p2 = loadVendoredScript(src, "__libLoaderSingleFlight");
    expect(spy).toHaveBeenCalledTimes(1);
    const script = spy.mock.calls[0][0];
    globalThis.__libLoaderSingleFlight = {};
    script.dispatchEvent(new Event("load"));
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(true);
    expect(script.isConnected).toBe(false);
  });

  it("allows a fresh retry after an error and removes the failed tag", async () => {
    const spy = vi.spyOn(document.head, "appendChild");
    const src = "src/lib/retry-test.js";
    const first = loadVendoredScript(src, "__libLoaderRetry");
    const script1 = spy.mock.calls[0][0];
    script1.dispatchEvent(new Event("error"));
    await expect(first).resolves.toBe(false);
    expect(script1.isConnected).toBe(false);

    const second = loadVendoredScript(src, "__libLoaderRetry");
    expect(spy).toHaveBeenCalledTimes(2);
    const script2 = spy.mock.calls[1][0];
    globalThis.__libLoaderRetry = {};
    script2.dispatchEvent(new Event("load"));
    await expect(second).resolves.toBe(true);
  });

  it("resolves false when the script loads without defining the global", async () => {
    const spy = vi.spyOn(document.head, "appendChild");
    const src = "src/lib/missing-global-test.js";
    const pending = loadVendoredScript(src, "__libLoaderDefinitelyMissing");
    const script = spy.mock.calls[0][0];
    script.dispatchEvent(new Event("load"));
    await expect(pending).resolves.toBe(false);
    expect(script.isConnected).toBe(false);
  });

  it("resolves true without touching the DOM when the global already exists", async () => {
    globalThis.__libLoaderAlready = {};
    const spy = vi.spyOn(document.head, "appendChild");
    await expect(loadVendoredScript("src/lib/never-appended.js", "__libLoaderAlready")).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects empty/non-string src without touching the DOM", async () => {
    const spy = vi.spyOn(document.head, "appendChild");
    await expect(loadVendoredScript("")).resolves.toBe(false);
    await expect(loadVendoredScript(null)).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
