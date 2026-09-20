import { describe, it, expect, afterEach } from "vitest";
import {
  HEX_COLOR_RE,
  clampNumber,
  isAllowedValue,
  isHttpUrl,
  isSafeImageSource,
  normalizeHexColor,
  toFiniteNumber,
} from "../src/js/utils.js";
import {
  ALLOWED_DATA_TYPES,
  ALLOWED_ECC,
  ALLOWED_FRAMES,
  ALLOWED_GRADIENT_TYPES,
  ALLOWED_MASKS,
  ALLOWED_SHAPES,
  GENERATOR_NUMERIC_BOUNDS,
  LEGACY_FRAME_TEXT_SIZES,
  MAX_STATE_IMAGE_LEN,
  MAX_STATE_TEXT_LEN,
  SHARE_LOGO_MAX_BYTES,
} from "../src/js/constants.js";
import {
  DEFAULT_GENERATOR,
  STATE_KEY,
  loadState,
  migrateInvertedStockPalette,
  persistAppState,
  repairLowVisibilityColors,
  sanitizeGeneratorConfig,
  sanitizeGeneratorHistory,
  sanitizeScannerHistory,
  state,
} from "../src/js/state";
import { decodeStateFromUrl, encodeStateToUrl } from "../src/js/share.js";
import { DOM } from "../src/js/ui/dom.js";

describe("utils — shared validation contracts", () => {
  it("toFiniteNumber accepts trimmed finite strings and rejects everything else", () => {
    expect(toFiniteNumber("42")).toBe(42);
    expect(toFiniteNumber(" -3.5 ")).toBe(-3.5);
    expect(toFiniteNumber("1e3")).toBe(1000);
    expect(toFiniteNumber("0x10")).toBe(16);
    for (const bad of ["", "   ", "abc", "Infinity", "NaN", null, undefined, 42, {}, []]) {
      expect(toFiniteNumber(bad)).toBeNull();
    }
  });

  it("clampNumber clamps into bounds and rounds integer bounds", () => {
    expect(clampNumber(49.6, GENERATOR_NUMERIC_BOUNDS.width)).toBe(50);
    expect(clampNumber(2001, GENERATOR_NUMERIC_BOUNDS.width)).toBe(2000);
    expect(clampNumber(123.5, GENERATOR_NUMERIC_BOUNDS.width)).toBe(124);
    expect(clampNumber(0.05, GENERATOR_NUMERIC_BOUNDS.logoSizeProportion)).toBe(0.1);
    expect(clampNumber(0.33, GENERATOR_NUMERIC_BOUNDS.logoSizeProportion)).toBe(0.33);
  });

  it("normalizeHexColor canonicalizes optional-hash six-digit hex", () => {
    expect(normalizeHexColor("#AABBCC")).toBe("aabbcc");
    expect(normalizeHexColor("aabbcc")).toBe("aabbcc");
    expect(normalizeHexColor("#abc")).toBeNull();
    expect(normalizeHexColor(" #aabbcc")).toBeNull();
    expect(normalizeHexColor("url(x)")).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
    expect(normalizeHexColor(42)).toBeNull();
  });

  it("isAllowedValue only accepts exact allow-listed strings", () => {
    expect(isAllowedValue(ALLOWED_DATA_TYPES, "url")).toBe(true);
    expect(isAllowedValue(ALLOWED_ECC, "H")).toBe(true);
    expect(isAllowedValue(ALLOWED_SHAPES, "square")).toBe(true);
    expect(isAllowedValue(ALLOWED_MASKS, "heart")).toBe(true);
    expect(isAllowedValue(ALLOWED_FRAMES, "none")).toBe(true);
    expect(isAllowedValue(ALLOWED_FRAMES, "badge")).toBe(true);
    expect(isAllowedValue(ALLOWED_FRAMES, "swoop")).toBe(false);
    expect(isAllowedValue(ALLOWED_GRADIENT_TYPES, "radial")).toBe(true);
    expect(isAllowedValue(ALLOWED_ECC, "Z")).toBe(false);
    expect(isAllowedValue(ALLOWED_MASKS, "evil")).toBe(false);
    expect(isAllowedValue(ALLOWED_ECC, null)).toBe(false);
    expect(isAllowedValue(ALLOWED_ECC, 1)).toBe(false);
  });

  it("maps every legacy frame-size preset to an in-bounds percentage", () => {
    for (const [preset, percent] of Object.entries(LEGACY_FRAME_TEXT_SIZES)) {
      expect(typeof percent, preset).toBe("number");
      expect(percent, preset).toBeGreaterThanOrEqual(GENERATOR_NUMERIC_BOUNDS.frameTextSize.min);
      expect(percent, preset).toBeLessThanOrEqual(GENERATOR_NUMERIC_BOUNDS.frameTextSize.max);
    }
  });

  it("isHttpUrl and isSafeImageSource enforce the image allow-list", () => {
    expect(isHttpUrl("https://x.test/a.png")).toBe(true);
    expect(isHttpUrl("HTTP://x.test")).toBe(true);
    expect(isHttpUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isHttpUrl(null)).toBe(false);

    const png = "data:image/png;base64,AAAA";
    expect(isSafeImageSource(png, { maxLength: SHARE_LOGO_MAX_BYTES })).toBe(true);
    expect(isSafeImageSource(png, { maxLength: 8 })).toBe(false);
    expect(isSafeImageSource("https://x.test/a.png", { maxLength: 100 })).toBe(false);
    expect(isSafeImageSource("https://x.test/a.png", { maxLength: 100, allowHttp: true })).toBe(true);
    expect(isSafeImageSource("data:image/svg+xml;base64,AA", { maxLength: 100, allowHttp: true })).toBe(
      false
    );
    expect(isSafeImageSource("javascript:alert(1)", { maxLength: 100, allowHttp: true })).toBe(false);
    expect(isSafeImageSource(42, { maxLength: 100 })).toBe(false);
    const tooLong = "data:image/png;base64," + "A".repeat(MAX_STATE_IMAGE_LEN);
    expect(isSafeImageSource(tooLong, { maxLength: MAX_STATE_IMAGE_LEN, allowHttp: true })).toBe(false);
  });

  it("exposes the single numeric-bounds table used by state and share", () => {
    expect(GENERATOR_NUMERIC_BOUNDS).toEqual({
      width: { min: 50, max: 2000, integer: true },
      height: { min: 50, max: 2000, integer: true },
      margin: { min: 0, max: 100, integer: true },
      qrRadius: { min: 0, max: 1000, integer: true },
      imageMargin: { min: 0, max: 100, integer: true },
      logoSizeProportion: { min: 0.1, max: 0.5 },
      frameTextSize: { min: 60, max: 200, integer: true },
    });
    expect(HEX_COLOR_RE.test("#A1B2C3")).toBe(true);
  });
});

const HOSTILE_CONFIGS = [
  null,
  "nope",
  42,
  [1, 2, 3],
  Symbol("hostile"),
  10n,
  {},
  { dataType: "evil", width: NaN, height: Infinity, margin: -1e9, qrRadius: "9" },
  { bgColor: "red", dotsColor: "#GGGGGG", frameColor: 42, frameTextColor: "" },
  {
    dataString: "x".repeat(10000),
    maskCustom: 'M0 0" onload="alert(1)',
    frameText: "y".repeat(500),
    logoFilename: "f".repeat(1000),
  },
  { logoDataUrl: "data:image/svg+xml;base64,AA", bgImageDataUrl: "javascript:alert(1)" },
  {
    bgGradient: { type: "spiral", rotation: NaN, color2: "red" },
    dotsGradient: { type: "linear", rotation: 720.4, color2: "#aabbcc" },
  },
  { fields: { a: "x", b: 1, c: true, d: {}, e: NaN } },
  JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"fields":{"__proto__":{"x":1}}}'
  ),
];

describe("sanitizeGeneratorConfig — never throws, idempotent", () => {
  it("sanitize(sanitize(x)) equals sanitize(x) for hostile inputs", () => {
    for (const input of HOSTILE_CONFIGS) {
      let once;
      expect(() => {
        once = sanitizeGeneratorConfig(input);
      }).not.toThrow();
      const twice = sanitizeGeneratorConfig(once);
      expect(twice).toEqual(once);
    }
    expect(Object.prototype.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined();
  });

  it("degrades to a partial/default result when accessors throw", () => {
    const earlyThrow = {};
    Object.defineProperty(earlyThrow, "dataString", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(() => sanitizeGeneratorConfig(earlyThrow)).not.toThrow();
    expect(sanitizeGeneratorConfig(earlyThrow)).toEqual({});

    const lateThrow = { width: 123 };
    Object.defineProperty(lateThrow, "dataString", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(sanitizeGeneratorConfig(lateThrow)).toEqual({});

    const afterStrings = { dataString: "ok" };
    Object.defineProperty(afterStrings, "width", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(sanitizeGeneratorConfig(afterStrings)).toEqual({ dataString: "ok" });
  });
});

describe("history sanitizers — never throw, idempotent", () => {
  it("sanitizeGeneratorHistory drops hostile entries and is idempotent", () => {
    const raw = [
      { id: "x", time: 42, config: { dataString: 12345, width: "wide", maskCustom: 'M0 0"x' } },
      null,
      "bad",
      { config: null },
      { id: 2, time: "t", config: { dotsColor: "#GGGGGG", frameText: "y".repeat(100) } },
    ];
    const once = sanitizeGeneratorHistory(raw);
    expect(once).toHaveLength(2);
    const twice = sanitizeGeneratorHistory(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it("sanitizeScannerHistory truncates hostile content and is idempotent", () => {
    const raw = [
      { id: 1, content: "x".repeat(MAX_STATE_TEXT_LEN + 50), time: "t" },
      { id: "nope", content: "ok", time: 5 },
      null,
      42,
      { id: 3, content: 9 },
    ];
    const once = sanitizeScannerHistory(raw);
    expect(once).toHaveLength(2);
    expect(once[0].content).toHaveLength(MAX_STATE_TEXT_LEN);
    const twice = sanitizeScannerHistory(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it("tolerates throwing accessor entries without aborting the list", () => {
    const hostileEntry = {};
    Object.defineProperty(hostileEntry, "config", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const goodEntry = { id: 7, time: "t", config: { dataString: "keep" } };
    expect(() => sanitizeGeneratorHistory([hostileEntry, goodEntry])).not.toThrow();
    expect(sanitizeGeneratorHistory([hostileEntry, goodEntry])).toEqual([
      { id: 7, time: "t", config: { dataString: "keep" } },
    ]);

    const hostileScan = {};
    Object.defineProperty(hostileScan, "content", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(() => sanitizeScannerHistory([hostileScan])).not.toThrow();
    expect(sanitizeScannerHistory([hostileScan])).toEqual([]);
  });
});

describe("repair/migration helpers — idempotence", () => {
  it.each([
    ["#ffffff", "#ffffff"],
    ["#000000", "#000000"],
    ["ffffff", "#FFFFFF"],
    ["#101010", "#101010"],
  ])("repairLowVisibilityColors(%s bg, %s dots) changes once then no-ops", (bg, dots) => {
    const g = {
      ...DEFAULT_GENERATOR,
      bgColor: bg,
      dotsColor: dots,
      cornersSquareColor: dots,
      cornersDotColor: dots,
    };
    expect(repairLowVisibilityColors(g)).toBe(true);
    const afterFirst = { ...g };
    expect(repairLowVisibilityColors(g)).toBe(false);
    expect(g).toEqual(afterFirst);
  });

  it("leaves readable configs alone and stays false on repeat", () => {
    const g = { ...DEFAULT_GENERATOR };
    expect(repairLowVisibilityColors(g)).toBe(false);
    expect(repairLowVisibilityColors(g)).toBe(false);
    expect(g).toEqual(DEFAULT_GENERATOR);
  });

  it("migrateInvertedStockPalette flips once and is a no-op afterwards", () => {
    const g = {
      ...DEFAULT_GENERATOR,
      bgColor: "#ffffff",
      dotsColor: "#000000",
      cornersSquareColor: "#000000",
      cornersDotColor: "#000000",
    };
    expect(migrateInvertedStockPalette(g)).toBe(true);
    const afterFirst = { ...g };
    expect(migrateInvertedStockPalette(g)).toBe(false);
    expect(g).toEqual(afterFirst);
  });
});

describe("loadState — stock-palette migration is legacy-only", () => {
  const initial = { ...state.generator };
  afterEach(() => {
    localStorage.clear();
    Object.assign(state.generator, initial);
    state.generatorHistory = [];
    state.scanner.history = [];
  });

  it("migrates a legacy (pre-versioned) white-bg blob exactly once", () => {
    const blob = {
      generatorHistory: [{ id: 1, time: "t", config: { dataString: "saved" } }],
      scanner: { history: [{ id: 2, content: "scan", time: "t" }] },
      generator: {
        dataType: "text",
        dataString: "hello",
        bgColor: "#ffffff",
        dotsColor: "#000000",
        cornersSquareColor: "#000000",
        cornersDotColor: "#000000",
      },
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(blob));
    loadState();
    const first = JSON.parse(
      JSON.stringify({
        generator: state.generator,
        generatorHistory: state.generatorHistory,
        scannerHistory: state.scanner.history,
      })
    );
    loadState();
    const second = JSON.parse(
      JSON.stringify({
        generator: state.generator,
        generatorHistory: state.generatorHistory,
        scannerHistory: state.scanner.history,
      })
    );
    expect(second).toEqual(first);
    expect(first.generator.bgColor).toBe("#000000");
    expect(first.generator.dotsColor).toBe("#ffffff");
  });

  it("keeps a current-schema white-bg design unchanged across load/save", () => {
    const blob = {
      v: 1,
      generatorHistory: [],
      scanner: { history: [] },
      generator: {
        dataType: "text",
        dataString: "hello",
        bgColor: "#ffffff",
        dotsColor: "#000000",
        cornersSquareColor: "#000000",
        cornersDotColor: "#000000",
      },
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(blob));
    loadState();
    const first = JSON.parse(JSON.stringify(state.generator));
    expect(first.bgColor).toBe("#ffffff");
    expect(first.dotsColor).toBe("#000000");
    expect(first.cornersSquareColor).toBe("#000000");
    expect(first.cornersDotColor).toBe("#000000");

    expect(persistAppState(false)).toBe(true);
    loadState();
    const second = JSON.parse(JSON.stringify(state.generator));
    // The field snapshot is re-written on every save; compare the design only.
    delete first.fields;
    delete second.fields;
    expect(second).toEqual(first);
    expect(second.bgColor).toBe("#ffffff");
    expect(second.dotsColor).toBe("#000000");
  });
});

describe("share URL decode — contracts", () => {
  const initial = { ...state.generator };
  afterEach(() => {
    Object.assign(state.generator, initial);
    for (const id of [
      "inputText",
      "smsPhone",
      "smsMsg",
      "emailTo",
      "emailBody",
      "wifiSsid",
      "wifiPass",
      "wifiEnc",
      "wifiHidden",
      "geoLat",
      "geoLon",
      "cryptoCoin",
      "cryptoAddress",
      "cryptoAmount",
    ])
      delete DOM[id];
    window.history.replaceState({}, "", "/");
  });

  it("never throws on hostile locations and always returns a boolean", () => {
    const queries = [
      "?",
      "#",
      "?=",
      "?type=",
      "?%",
      "?%ZZ=1",
      "?__proto__=polluted",
      "?constructor[prototype][polluted]=1",
      "?data=%E0%A4%A",
      "?w=1e309",
      "?bgGrad=" + "x".repeat(1000),
      "?" + "a".repeat(5000),
      "#" + "b".repeat(5000),
      "?data=" + encodeURIComponent("😀".repeat(50)),
    ];
    for (const query of queries) {
      window.history.replaceState({}, "", query);
      let result;
      expect(() => {
        result = decodeStateFromUrl();
      }).not.toThrow();
      expect(typeof result).toBe("boolean");
    }
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it("re-applying the same share URL is idempotent", () => {
    Object.assign(state.generator, {
      dataType: "wifi",
      dataString: "WIFI:S:Net;T:WPA;P:secret123;H:false;;",
      ecc: "Q",
      width: 512,
      dotsColor: "#112233",
      bgColor: "#F0F0F0",
      frameStyle: "dashed",
      frameText: "SCAN",
      frameTextColor: "#DEF012",
    });
    const url = encodeStateToUrl();
    window.history.replaceState({}, "", new URL(url).hash);
    expect(decodeStateFromUrl()).toBe(true);
    const afterFirst = JSON.parse(JSON.stringify(state.generator));
    expect(decodeStateFromUrl()).toBe(true);
    expect(JSON.parse(JSON.stringify(state.generator))).toEqual(afterFirst);
  });

  it("tolerates a partially initialized DOM when restoring email fields", () => {
    const emailTo = document.createElement("input");
    DOM.emailTo = emailTo;
    window.history.replaceState(
      {},
      "",
      "?type=email&data=" + encodeURIComponent("mailto:a@b.c?subject=Hi&body=Yo")
    );
    expect(decodeStateFromUrl()).toBe(true);
    expect(emailTo.value).toBe("a@b.c");
  });

  it("restores decoded payloads into textareas (text, SMS message, email body)", () => {
    const inputText = document.createElement("textarea");
    const smsPhone = document.createElement("input");
    const smsMsg = document.createElement("textarea");
    const emailTo = document.createElement("input");
    const emailBody = document.createElement("textarea");
    Object.assign(DOM, { inputText, smsPhone, smsMsg, emailTo, emailBody });

    window.history.replaceState({}, "", "?type=text&data=" + encodeURIComponent("hello text"));
    expect(decodeStateFromUrl()).toBe(true);
    expect(inputText.value).toBe("hello text");

    window.history.replaceState({}, "", "?type=sms&data=" + encodeURIComponent("SMSTO:+1555:hi there"));
    expect(decodeStateFromUrl()).toBe(true);
    expect(smsPhone.value).toBe("+1555");
    expect(smsMsg.value).toBe("hi there");

    window.history.replaceState(
      {},
      "",
      "?type=email&data=" + encodeURIComponent("mailto:a@b.c?subject=S&body=Body%20text")
    );
    expect(decodeStateFromUrl()).toBe(true);
    expect(emailTo.value).toBe("a@b.c");
    expect(emailBody.value).toBe("Body text");
  });

  it("restores decoded structured payloads into their inputs", () => {
    const wifiSsid = document.createElement("input");
    const wifiPass = document.createElement("input");
    const wifiEnc = document.createElement("select");
    wifiEnc.appendChild(new Option("WPA", "WPA"));
    const wifiHidden = document.createElement("input");
    wifiHidden.type = "checkbox";
    const geoLat = document.createElement("input");
    const geoLon = document.createElement("input");
    const cryptoAddress = document.createElement("input");
    const cryptoCoin = document.createElement("select");
    cryptoCoin.appendChild(new Option("Bitcoin", "bitcoin"));
    const cryptoAmount = document.createElement("input");
    Object.assign(DOM, {
      wifiSsid,
      wifiPass,
      wifiEnc,
      wifiHidden,
      geoLat,
      geoLon,
      cryptoAddress,
      cryptoCoin,
      cryptoAmount,
    });

    window.history.replaceState(
      {},
      "",
      "?type=wifi&data=" + encodeURIComponent("WIFI:S:My Net;T:WPA;P:se\\;cret;H:true;;")
    );
    expect(decodeStateFromUrl()).toBe(true);
    expect(wifiSsid.value).toBe("My Net");
    expect(wifiEnc.value).toBe("WPA");
    expect(wifiPass.value).toBe("se;cret");
    expect(wifiHidden.checked).toBe(true);

    window.history.replaceState({}, "", "?type=geo&data=" + encodeURIComponent("geo:37.77,-122.41"));
    expect(decodeStateFromUrl()).toBe(true);
    expect(geoLat.value).toBe("37.77");
    expect(geoLon.value).toBe("-122.41");

    window.history.replaceState(
      {},
      "",
      "?type=crypto&data=" + encodeURIComponent("bitcoin:bc1abc?amount=1.5")
    );
    expect(decodeStateFromUrl()).toBe(true);
    expect(cryptoCoin.value).toBe("bitcoin");
    expect(cryptoAddress.value).toBe("bc1abc");
    expect(cryptoAmount.value).toBe("1.5");
  });
});
