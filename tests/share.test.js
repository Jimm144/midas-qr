import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { encodeStateToUrl, decodeStateFromUrl, applyHydratedPayload } from "../src/js/share.js";
import { state, STATE_KEY, APP_SCHEMA_VERSION } from "../src/js/state";

describe("encodeStateToUrl — defensive clamping", () => {
  beforeEach(() => {
    state.generator.dataType = "url";
    state.generator.dataString = "";
    state.generator.ecc = "H";
    state.generator.width = 300;
    state.generator.height = 300;
    state.generator.margin = 4;
    state.generator.qrRadius = 0;
    state.generator.dotsColor = "#000000";
    state.generator.bgColor = "#ffffff";
    state.generator.bgTransparent = false;
    state.generator.cornersSquareColor = "#000000";
    state.generator.cornersDotColor = "#000000";
    state.generator.shapeBody = "square";
    state.generator.shapeOuter = "square";
    state.generator.shapeInner = "square";
    state.generator.maskType = "none";
    state.generator.maskCustom = "";
    state.generator.frameStyle = "none";
    state.generator.frameText = "SCAN ME";
    state.generator.logoDataUrl = null;
    state.generator.logoSizeProportion = 0.4;
    state.generator.imageMargin = 0;
  });

  it("omits a giant logo data URL from the share URL", () => {
    state.generator.logoDataUrl = "data:image/png;base64," + "A".repeat(5000);
    const url = encodeStateToUrl();
    expect(url).not.toContain("logo=");
  });

  it("includes a small data: logo URL", () => {
    state.generator.logoDataUrl = "data:image/png;base64,AAAA";
    const url = encodeStateToUrl();
    expect(url).toContain("logo=data%3Aimage%2Fpng");
  });

  it("refuses to encode an invalid hex color", () => {
    state.generator.dotsColor = "not-a-color";
    state.generator.bgColor = "#xyzxyz";
    const url = encodeStateToUrl();
    expect(url).not.toContain("dots=");
    expect(url).not.toContain("bg=");
  });

  it("refuses to encode an unknown shape value", () => {
    state.generator.shapeBody = "weirdUnknown";
    const url = encodeStateToUrl();
    expect(url).not.toContain("body=weirdUnknown");
  });

  it("truncates frame text to 15 chars on encode", () => {
    state.generator.frameStyle = "scan";
    state.generator.frameText = "THIS IS A VERY LONG FRAME STRING";
    const url = encodeStateToUrl();
    expect(url).toContain("frameText=THIS+IS+A+VE");
  });

  it("round-trips an email payload through the share URL", () => {
    state.generator.dataType = "email";
    state.generator.dataString = "mailto:person@example.com?subject=Hi%20there&body=Hello";
    const url = encodeStateToUrl();
    expect(url).toContain("type=email");
    expect(url).toContain("data=mailto%3Aperson%40example.com");
    window.history.replaceState({}, "", new URL(url).hash);
    expect(decodeStateFromUrl()).toBe(true);
    expect(state.generator.dataType).toBe("email");
    expect(state.generator.dataString).toBe("mailto:person@example.com?subject=Hi%20there&body=Hello");
  });
});

describe("gradients round-trip through the share URL", () => {
  it("encodes a dots gradient and decodes it back", () => {
    state.generator.dotsGradient = { type: "linear", rotation: 90, color2: "#FF0000" };
    const url = encodeStateToUrl();
    expect(url).toContain("dotsGrad=linear%2C90%2C%23FF0000");
    window.history.replaceState({}, "", new URL(url).hash);
    expect(decodeStateFromUrl()).toBe(true);
    expect(state.generator.dotsGradient).toEqual({ type: "linear", rotation: 90, color2: "#FF0000" });
    state.generator.dotsGradient = null;
  });

  it("omits invalid gradient specs and rejects malformed params", () => {
    state.generator.bgGradient = { type: "spiral", rotation: 10, color2: "#00FF00" };
    expect(encodeStateToUrl()).not.toContain("bgGrad");
    state.generator.bgGradient = null;

    window.history.replaceState({}, "", "?bgGrad=linear,abc,%23GGGGGG&cdGrad=linear,45");
    decodeStateFromUrl();
    expect(state.generator.bgGradient).toBeNull();
    expect(state.generator.cornersDotGradient).toBeNull();
    window.history.replaceState({}, "", "/");
  });

  it("clears recipient gradients the shared link does not specify", () => {
    state.generator.bgGradient = { type: "linear", rotation: 10, color2: "#111111" };
    state.generator.dotsGradient = { type: "linear", rotation: 20, color2: "#222222" };
    state.generator.cornersSquareGradient = { type: "linear", rotation: 30, color2: "#333333" };
    state.generator.cornersDotGradient = { type: "linear", rotation: 40, color2: "#444444" };
    state.generator.frameGradient = { type: "linear", rotation: 50, color2: "#555555" };
    state.generator.frameTextGradient = { type: "linear", rotation: 60, color2: "#666666" };

    window.history.replaceState({}, "", "?w=400");
    expect(decodeStateFromUrl()).toBe(true);
    expect(state.generator.bgGradient).toBeNull();
    expect(state.generator.dotsGradient).toBeNull();
    expect(state.generator.cornersSquareGradient).toBeNull();
    expect(state.generator.cornersDotGradient).toBeNull();
    expect(state.generator.frameGradient).toBeNull();
    expect(state.generator.frameTextGradient).toBeNull();

    state.generator.dotsGradient = { type: "linear", rotation: 90, color2: "#111111" };
    state.generator.frameTextGradient = { type: "radial", rotation: 45, color2: "#222222" };
    window.history.replaceState(
      {},
      "",
      "?dotsGrad=radial,180,%23ABCDEF&frameTextGrad=linear,90,%23123456"
    );
    expect(decodeStateFromUrl()).toBe(true);
    expect(state.generator.dotsGradient).toEqual({ type: "radial", rotation: 180, color2: "#ABCDEF" });
    expect(state.generator.frameTextGradient).toEqual({
      type: "linear",
      rotation: 90,
      color2: "#123456",
    });
    expect(state.generator.bgGradient).toBeNull();
    expect(state.generator.cornersSquareGradient).toBeNull();
    expect(state.generator.cornersDotGradient).toBeNull();
    expect(state.generator.frameGradient).toBeNull();

    for (const key of [
      "bgGradient",
      "dotsGradient",
      "cornersSquareGradient",
      "cornersDotGradient",
      "frameGradient",
      "frameTextGradient",
    ]) {
      state.generator[key] = null;
    }
    window.history.replaceState({}, "", "/");
  });
});

describe("decodeStateFromUrl — malformed inputs are rejected", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    state.generator.dataType = "url";
    state.generator.dataString = "";
    state.generator.ecc = "H";
    state.generator.width = 300;
    state.generator.height = 300;
    state.generator.margin = 4;
    state.generator.qrRadius = 0;
    state.generator.dotsColor = "#000000";
    state.generator.bgColor = "#ffffff";
    state.generator.logoDataUrl = null;
    state.generator.shapeBody = "square";
  });

  afterEach(() => {
    window.history.replaceState({}, "", originalLocation.pathname);
  });

  it("clamps width into the valid range", () => {
    window.history.replaceState({}, "", "?w=99999");
    decodeStateFromUrl();
    expect(state.generator.width).toBe(2000);
  });

  it("rejects NaN numeric params and keeps the prior value", () => {
    window.history.replaceState({}, "", "?w=NaN&margin=abc");
    decodeStateFromUrl();
    expect(state.generator.width).toBe(300);
    expect(state.generator.margin).toBe(4);
  });

  it("rejects invalid hex colors", () => {
    window.history.replaceState({}, "", "?dots=xyzxyz&bg=!@#$%^");
    decodeStateFromUrl();
    expect(state.generator.dotsColor).toBe("#000000");
    expect(state.generator.bgColor).toBe("#ffffff");
  });

  it("rejects an SVG data: URL logo payload via share URL", () => {
    const svg = "data:image/svg+xml,<svg onload=alert(1)>";
    window.history.replaceState({}, "", "?logo=" + encodeURIComponent(svg));
    decodeStateFromUrl();
    expect(state.generator.logoDataUrl).toBe(null);
  });
});

describe("state persistence — schema version + round-trip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("exposes a schema version constant", () => {
    expect(APP_SCHEMA_VERSION).toBe(1);
    expect(STATE_KEY).toBe("qr_state_v1");
  });
});

describe("decodeStateFromUrl — hostile input fuzzing", () => {
  function resetGenerator() {
    state.generator.dataType = "url";
    state.generator.dataString = "previous-data";
    state.generator.ecc = "H";
    state.generator.width = 321;
    state.generator.height = 322;
    state.generator.margin = 7;
    state.generator.qrRadius = 9;
    state.generator.dotsColor = "#ffffff";
    state.generator.bgColor = "#000000";
    state.generator.bgTransparent = false;
    state.generator.cornersSquareColor = "#ffffff";
    state.generator.cornersDotColor = "#ffffff";
    state.generator.bgGradient = null;
    state.generator.dotsGradient = null;
    state.generator.cornersSquareGradient = null;
    state.generator.cornersDotGradient = null;
    state.generator.shapeBody = "square";
    state.generator.shapeOuter = "square";
    state.generator.shapeInner = "square";
    state.generator.maskType = "none";
    state.generator.maskCustom = "M0 0";
    state.generator.frameStyle = "none";
    state.generator.frameText = "SCAN ME";
    state.generator.frameTextSize = 115;
    state.generator.frameTextEnabled = true;
    state.generator.frameFont = "theme";
    state.generator.frameColor = "#123456";
    state.generator.frameTextColor = "#654321";
    state.generator.frameGradient = null;
    state.generator.logoDataUrl = null;
    state.generator.logoFilename = null;
    state.generator.bgImageDataUrl = null;
    state.generator.logoSizeProportion = 0.4;
    state.generator.imageMargin = 0;
  }

  function decode(query) {
    window.history.replaceState({}, "", query);
    decodeStateFromUrl();
  }

  beforeEach(() => {
    resetGenerator();
  });

  afterEach(() => {
    window.history.replaceState({}, "", window.location.pathname);
  });

  it("rejects or safely clamps hostile numeric params", () => {
    const cases = [
      ["?w=NaN", () => expect(state.generator.width).toBe(321)],
      ["?w=", () => expect(state.generator.width).toBe(321)],
      ["?w=Infinity", () => expect(state.generator.width).toBe(321)],
      ["?w=50abc", () => expect(state.generator.width).toBe(321)],
      ["?w=-5", () => expect(state.generator.width).toBe(50)],
      ["?w=1e21", () => expect(state.generator.width).toBe(2000)],
      ["?h=99999", () => expect(state.generator.height).toBe(2000)],
      ["?margin=abc", () => expect(state.generator.margin).toBe(7)],
      ["?margin=-10", () => expect(state.generator.margin).toBe(0)],
      ["?radius=NaN", () => expect(state.generator.qrRadius).toBe(9)],
      ["?radius=999999", () => expect(state.generator.qrRadius).toBe(1000)],
    ];
    for (const [query, assert] of cases) {
      resetGenerator();
      decode(query);
      assert();
    }
  });

  it("rejects unknown enums and keeps the previous value", () => {
    const cases = [
      ["?ecc=ZZZ", () => expect(state.generator.ecc).toBe("H")],
      ["?type=evil", () => expect(state.generator.dataType).toBe("url")],
      ["?body=cross", () => expect(state.generator.shapeBody).toBe("square")],
      ["?outer=cross", () => expect(state.generator.shapeOuter).toBe("square")],
      ["?inner=cross", () => expect(state.generator.shapeInner).toBe("square")],
      ["?mask=evil", () => expect(state.generator.maskType).toBe("none")],
      ["?frame=evil", () => expect(state.generator.frameStyle).toBe("none")],
      ["?frame=swoop", () => expect(state.generator.frameStyle).toBe("none")],
      ["?frame=crop", () => expect(state.generator.frameStyle).toBe("none")],
      ["?frame=squircle", () => expect(state.generator.frameStyle).toBe("none")],
      ["?frame=bottom", () => expect(state.generator.frameStyle).toBe("none")],
      ["?frame=top", () => expect(state.generator.frameStyle).toBe("none")],
      ["?frameSize=huge", () => expect(state.generator.frameTextSize).toBe(115)],
      ["?font=comic", () => expect(state.generator.frameFont).toBe("theme")],
    ];
    for (const [query, assert] of cases) {
      resetGenerator();
      decode(query);
      assert();
    }
  });

  it("applies valid enums from both the query and the hash", () => {
    resetGenerator();
    decode("?mask=circle&body=classy-rounded&outer=rounded&inner=dot");
    expect(state.generator.maskType).toBe("circle");
    expect(state.generator.shapeBody).toBe("classy-rounded");
    expect(state.generator.shapeOuter).toBe("rounded");
    expect(state.generator.shapeInner).toBe("dot");

    resetGenerator();
    window.history.replaceState({}, "", "#mask=star&body=dots");
    expect(decodeStateFromUrl()).toBe(true);
    expect(state.generator.maskType).toBe("star");
    expect(state.generator.shapeBody).toBe("dots");
  });

  it("migrates legacy frame sizes and clamps numeric ones on decode", () => {
    const cases = [
      ["?frameSize=small", 85],
      ["?frameSize=medium", 100],
      ["?frameSize=large", 125],
      ["?frameSize=10", 60],
      ["?frameSize=999", 200],
      ["?frameSize=123.4", 123],
      ["?frameSize=abc", 115],
    ];
    for (const [query, expected] of cases) {
      resetGenerator();
      decode(query);
      expect(state.generator.frameTextSize, query).toBe(expected);
    }
  });

  it("decodes removed frame styles to the previous value without throwing", () => {
    for (const removed of ["bottom", "top", "swoop", "crop", "squircle"]) {
      resetGenerator();
      state.generator.frameStyle = "badge";
      decode(`?frame=${removed}`);
      expect(state.generator.frameStyle, removed).toBe("badge");
    }
    resetGenerator();
    decode("?frame=swoop&frameText=Hi");
    expect(state.generator.frameStyle).toBe("none");
    expect(state.generator.frameText).toBe("Hi");
  });

  it("decodes the frame-text toggle and restores the style default", () => {
    resetGenerator();
    decode("?frame=label&noText=1");
    expect(state.generator.frameStyle).toBe("label");
    expect(state.generator.frameTextEnabled).toBe(false);
    resetGenerator();
    decode("?frame=scan&text=1");
    expect(state.generator.frameTextEnabled).toBe(true);
    resetGenerator();
    decode("?frame=scan");
    expect(state.generator.frameTextEnabled).toBe(false);
    resetGenerator();
    decode("?frame=badge");
    expect(state.generator.frameTextEnabled).toBe(true);
    resetGenerator();
    decode("?noText=1");
    expect(state.generator.frameTextEnabled).toBe(false);
  });

  it("rejects overlong dataString and maskCustom payloads", () => {
    decode("?data=" + "A".repeat(5000));
    expect(state.generator.dataString).toBe("previous-data");
    decode("?maskPath=" + "M".repeat(5000));
    expect(state.generator.maskCustom).toBe("M0 0");
    decode("?data=short");
    expect(state.generator.dataString).toBe("short");
  });

  it("truncates overlong frame text instead of accepting it whole", () => {
    decode("?frameText=" + "B".repeat(200));
    expect(state.generator.frameText).toBe("B".repeat(15));
  });

  it("rejects gradient specs with NaN rotation, bad color2 or unknown type", () => {
    const cases = [
      "?bgGrad=linear,NaN,%23FF0000",
      "?bgGrad=linear,90,not-a-color",
      "?bgGrad=spiral,90,%23FF0000",
      "?bgGrad=linear,90",
      "?bgGrad=",
      "?dotsGrad=linear,1e999,%23FF0000",
      "?dotsGrad=linear,-1,%23FF0000",
      "?csGrad=linear,90,%23GGGGGG",
    ];
    for (const query of cases) {
      resetGenerator();
      decode(query);
      expect(state.generator.bgGradient).toBeNull();
      expect(state.generator.dotsGradient).toBeNull();
      expect(state.generator.cornersSquareGradient).toBeNull();
    }
    decode("?cdGrad=radial,45,%23aabbcc");
    expect(state.generator.cornersDotGradient).toEqual({
      type: "radial",
      rotation: 45,
      color2: "#aabbcc",
    });
  });

  it("rejects data: logos that are not safe bitmaps", () => {
    const unsafe = [
      "data:image/svg+xml,<svg onload=alert(1)>",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/png;base64," + "A".repeat(3000),
      "javascript:alert(1)",
      "data:image/png,not-base64",
    ];
    for (const logo of unsafe) {
      resetGenerator();
      decode("?logo=" + encodeURIComponent(logo));
      expect(state.generator.logoDataUrl).toBeNull();
    }
  });

  it("accepts a safe bitmap data: URL logo without prompting", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      resetGenerator();
      decode("?logo=" + encodeURIComponent("data:image/png;base64,AAAA"));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(state.generator.logoDataUrl).toBe("data:image/png;base64,AAAA");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("accepts a remote http(s) logo only after the recipient confirms", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      resetGenerator();
      decode("?logo=" + encodeURIComponent("https://example.com/logo.png"));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(state.generator.logoDataUrl).toBe("https://example.com/logo.png");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("rejects a remote logo from a shared link when the recipient declines", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      resetGenerator();
      decode("?logo=" + encodeURIComponent("https://attacker.test/beacon.png"));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(state.generator.logoDataUrl).toBeNull();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("rejects or clamps hostile logo size and margin params", () => {
    decode("?logoSize=NaN");
    expect(state.generator.logoSizeProportion).toBe(0.4);
    resetGenerator();
    decode("?logoSize=");
    expect(state.generator.logoSizeProportion).toBe(0.4);
    resetGenerator();
    decode("?logoSize=99");
    expect(state.generator.logoSizeProportion).toBe(0.5);
    resetGenerator();
    decode("?logoSize=-1");
    expect(state.generator.logoSizeProportion).toBe(0.1);
    resetGenerator();
    decode("?logoMargin=-3");
    expect(state.generator.imageMargin).toBe(0);
  });

  it("ignores duplicated scalar params instead of guessing first/last", () => {
    decode("?w=99999&w=100");
    expect(state.generator.width).toBe(321);
    decode("?ecc=L&ecc=H");
    expect(state.generator.ecc).toBe("H");
    decode("?data=one&data=two");
    expect(state.generator.dataString).toBe("previous-data");
    decode("?bgT=1&bgT=0&bgT=true");
    expect(state.generator.bgTransparent).toBe(false);
    decode("?logo=" + encodeURIComponent("https://a.test/x.png") + "&logo=javascript:alert(1)");
    expect(state.generator.logoDataUrl).toBeNull();
  });

  it("cannot pollute Object.prototype through parameter names", () => {
    decode(
      "?__proto__[polluted]=1&constructor[prototype][polluted]=1&prototype=evil&__proto__=evil&field=__proto__"
    );
    expect(Object.prototype.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(state.generator)).toBe(Object.prototype);
    expect(state.generator.dataType).toBe("url");
  });

  it("sanitizes mask paths decoded from hostile params", () => {
    decode("?maskPath=" + encodeURIComponent('M0 0" onload="alert(1)'));
    expect(state.generator.maskCustom).not.toContain('"');
    expect(state.generator.maskCustom).not.toContain("<");
    expect(state.generator.maskCustom).toContain("M0 0");
    resetGenerator();
    decode("?maskPath=////");
    expect(state.generator.maskCustom).toBe("");
  });

  it("applies a crypto payload even when the address has malformed percent escapes", () => {
    decode("?type=crypto&data=" + encodeURIComponent("bitcoin:addr%ZZ"));
    expect(state.generator.dataType).toBe("crypto");
    expect(state.generator.dataString).toBe("bitcoin:addr%ZZ");
  });

  it("does not leave a previous decode's payload armed when the next decode has no params", () => {
    decode("?data=first");
    resetGenerator();
    window.history.replaceState({}, "", window.location.pathname);
    expect(decodeStateFromUrl()).toBe(false);
    applyHydratedPayload();
    expect(state.generator.dataString).toBe("previous-data");
  });

  it("decodes state params from the hash as well as the query", () => {
    window.history.replaceState({}, "", "#type=text&data=hashdata");
    expect(decodeStateFromUrl()).toBe(true);
    expect(state.generator.dataType).toBe("text");
    expect(state.generator.dataString).toBe("hashdata");
  });

  it("never leaves a lone surrogate when truncating frame text", () => {
    decode("?frameText=" + encodeURIComponent("😀".repeat(12)));
    const text = state.generator.frameText;
    const last = text.charCodeAt(text.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    expect(text.length).toBeLessThanOrEqual(15);
  });

  it("rejects hostile frame color params", () => {
    decode("?frameColor=red&frameTextColor=url(x)");
    expect(state.generator.frameColor).toBe("#123456");
    expect(state.generator.frameTextColor).toBe("#654321");
    resetGenerator();
    decode("?frameColor=%23AABBCC&frameTextColor=%23ddeeff");
    expect(state.generator.frameColor).toBe("#AABBCC");
    expect(state.generator.frameTextColor).toBe("#ddeeff");
  });

  it("never lets any hostile query push the state outside its clamped ranges", () => {
    const hostileQueries = [
      "?w=1e999&h=-1e999&margin=Infinity&radius=NaN",
      "?w=" + "9".repeat(10000),
      "?w=-1e999&h=99999&margin=-1e9&radius=1e9",
      "?data=" + "x".repeat(200000),
      "?frameText=" + "y".repeat(100000),
      "?logo=" + "z".repeat(100000),
      "?bgImage=" + "z".repeat(100000),
      "?maskPath=" + "M".repeat(100000),
      "?logoSize=1e999&logoMargin=1e999",
      "?logoSize=-1e999&logoMargin=-1e999",
      "?ecc=L&ecc=H&type=text&type=url",
      "?w=400&w=900&h=100&h=100",
      "?bgGrad=linear,90," + "a".repeat(2000),
      "?bgT=1&bgT=0&bgT=true",
      "?__proto__=polluted&constructor=evil&prototype=bad",
      "?type=__proto__&body=constructor&mask=prototype&frame=__proto__&font=__proto__&frameSize=__proto__",
      "?dots=%23GGGGGG&bg=%23abc&cs=javascript&cd=",
      "?w[]=1&h[key]=2&radius[0]=3",
      "?data=%00%01%02&maskPath=////",
      "?logo=data%3Aimage%2Fpng%3Bbase64%2C" + "A".repeat(5000),
      "?bgImage=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CAAAA",
      "?data=" + encodeURIComponent("日本語テキスト"),
      "?frameText=" + encodeURIComponent("😀".repeat(12)),
      "?data=%ED%A0%80",
      "?data=%E0%A4%A",
      "?radius=-0&w=0x64&margin=.5",
    ];
    const assertInvariants = () => {
      const g = state.generator;
      expect(g.width).toBeGreaterThanOrEqual(50);
      expect(g.width).toBeLessThanOrEqual(2000);
      expect(g.height).toBeGreaterThanOrEqual(50);
      expect(g.height).toBeLessThanOrEqual(2000);
      expect(g.margin).toBeGreaterThanOrEqual(0);
      expect(g.margin).toBeLessThanOrEqual(100);
      expect(g.qrRadius).toBeGreaterThanOrEqual(0);
      expect(g.qrRadius).toBeLessThanOrEqual(1000);
      expect(g.imageMargin).toBeGreaterThanOrEqual(0);
      expect(g.imageMargin).toBeLessThanOrEqual(100);
      expect(g.logoSizeProportion).toBeGreaterThanOrEqual(0.1);
      expect(g.logoSizeProportion).toBeLessThanOrEqual(0.5);
      expect(g.dataString.length).toBeLessThanOrEqual(4096);
      expect(g.maskCustom.length).toBeLessThanOrEqual(4096);
      expect(g.frameText.length).toBeLessThanOrEqual(15);
      expect(typeof g.frameTextEnabled).toBe("boolean");
      if (g.logoDataUrl) expect(g.logoDataUrl.length).toBeLessThanOrEqual(2048);
      if (g.bgImageDataUrl) expect(g.bgImageDataUrl.length).toBeLessThanOrEqual(2048);
      for (const spec of [
        g.bgGradient,
        g.dotsGradient,
        g.cornersSquareGradient,
        g.cornersDotGradient,
        g.frameGradient,
      ]) {
        if (!spec) continue;
        expect(spec.rotation).toBeGreaterThanOrEqual(0);
        expect(spec.rotation).toBeLessThanOrEqual(360);
        expect(spec.type === "linear" || spec.type === "radial").toBe(true);
        expect(spec.color2).toMatch(/^#[0-9A-F]{6}$/i);
      }
    };
    for (const query of hostileQueries) {
      resetGenerator();
      decode(query);
      assertInvariants();
    }
    expect(Object.prototype.polluted).toBeUndefined();
  });
});

describe("encodeStateToUrl — short URLs, only non-default values", () => {
  beforeEach(() => {
    Object.assign(state.generator, {
      dataType: "url",
      dataString: "",
      ecc: "H",
      width: 300,
      height: 300,
      margin: 4,
      qrRadius: 0,
      dotsColor: "#000000",
      bgColor: "#ffffff",
      bgTransparent: false,
      cornersSquareColor: "#000000",
      cornersDotColor: "#000000",
      bgGradient: null,
      dotsGradient: null,
      cornersSquareGradient: null,
      cornersDotGradient: null,
      shapeBody: "square",
      shapeOuter: "square",
      shapeInner: "square",
      maskType: "none",
      maskCustom: "",
      frameStyle: "none",
      frameText: "Scan me!",
      frameTextSize: 115,
      frameTextEnabled: true,
      frameFont: "theme",
      frameColor: "",
      frameTextColor: "",
      frameGradient: null,
      logoDataUrl: null,
      logoFilename: null,
      bgImageDataUrl: null,
      logoSizeProportion: 0.4,
      imageMargin: 0,
    });
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    state.generator.logoDataUrl = null;
    state.generator.logoFilename = null;
    window.history.replaceState({}, "", "/");
  });

  it("emits no params at all for a default config", () => {
    const url = encodeStateToUrl();
    expect(new URL(url).search).toBe("");
    expect(new URL(url).hash).toBe("");
  });

  it("keeps every share param in the URL fragment, never the query", () => {
    state.generator.width = 400;
    state.generator.dataType = "wifi";
    state.generator.dataString = "WIFI:S:Net;T:WPA;P:secret123;;";
    const url = new URL(encodeStateToUrl());
    expect(url.search).toBe("");
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    expect(hashParams.get("w")).toBe("400");
    expect(hashParams.get("type")).toBe("wifi");
    expect(hashParams.get("data")).toBe("WIFI:S:Net;T:WPA;P:secret123;;");
  });

  it("emits only values that differ from the defaults", () => {
    state.generator.width = 400;
    state.generator.bgTransparent = true;
    state.generator.frameColor = "#123ABC";
    state.generator.frameStyle = "scan";
    state.generator.frameTextSize = 150;
    state.generator.frameTextEnabled = true;
    const url = new URL(encodeStateToUrl());
    expect(url.search).toBe("");
    const params = new URLSearchParams(url.hash.replace(/^#/, ""));
    expect(params.get("w")).toBe("400");
    expect(params.get("bgT")).toBe("1");
    expect(params.get("frameColor")).toBe("#123ABC");
    expect(params.get("frameSize")).toBe("150");
    expect(params.get("frame")).toBe("scan");
    expect(params.get("text")).toBe("1");
    expect(params.has("noText")).toBe(false);
    expect(params.has("h")).toBe(false);
    expect(params.has("margin")).toBe(false);
    expect(params.has("ecc")).toBe(false);
    expect(params.has("type")).toBe(false);
  });

  it("emits noText whenever the toggle is off and text only for style-default-off", () => {
    const paramsOf = () => new URLSearchParams(new URL(encodeStateToUrl()).hash.replace(/^#/, ""));
    state.generator.frameStyle = "label";
    state.generator.frameTextEnabled = false;
    let params = paramsOf();
    expect(params.get("frame")).toBe("label");
    expect(params.get("noText")).toBe("1");
    expect(params.has("text")).toBe(false);

    state.generator.frameStyle = "scan";
    expect(paramsOf().get("noText")).toBe("1");

    state.generator.frameTextEnabled = true;
    params = paramsOf();
    expect(params.get("frame")).toBe("scan");
    expect(params.get("text")).toBe("1");
    expect(params.has("noText")).toBe(false);
  });

  it("refuses to encode unsafe logos, broken numbers and oversized payloads", () => {
    state.generator.logoDataUrl = "javascript:alert(1)";
    expect(encodeStateToUrl()).not.toContain("logo=");
    state.generator.logoDataUrl = "data:image/svg+xml;base64,AAAA";
    expect(encodeStateToUrl()).not.toContain("logo=");
    state.generator.logoDataUrl = "https://example.com/logo.png";
    expect(encodeStateToUrl()).toContain("logo=https%3A%2F%2Fexample.com%2Flogo.png");
    state.generator.dataString = "x".repeat(5000);
    expect(encodeStateToUrl()).not.toContain("data=");
    state.generator.maskCustom = "M".repeat(5000);
    expect(encodeStateToUrl()).not.toContain("maskPath=");
    state.generator.logoSizeProportion = NaN;
    expect(encodeStateToUrl()).not.toContain("logoSize=");
    state.generator.width = Infinity;
    expect(encodeStateToUrl()).not.toContain("w=");
  });
});

describe("full config round-trip through the share URL", () => {
  let initial;
  beforeEach(() => {
    initial = { ...state.generator };
  });
  afterEach(() => {
    Object.assign(state.generator, initial);
    window.history.replaceState({}, "", "/");
  });

  it("round-trips every shareable field", () => {
    Object.assign(state.generator, {
      dataType: "wifi",
      dataString: "WIFI:S:Net;T:WPA;P:secret123;H:false;;",
      ecc: "Q",
      width: 512,
      height: 512,
      margin: 6,
      qrRadius: 12,
      dotsColor: "#112233",
      bgColor: "#F0F0F0",
      bgTransparent: true,
      cornersSquareColor: "#445566",
      cornersDotColor: "#778899",
      bgGradient: { type: "radial", rotation: 0, color2: "#AABBCC" },
      dotsGradient: { type: "linear", rotation: 90, color2: "#010203" },
      cornersSquareGradient: { type: "linear", rotation: 180, color2: "#040506" },
      cornersDotGradient: { type: "radial", rotation: 45, color2: "#070809" },
      shapeBody: "dots",
      shapeOuter: "rounded",
      shapeInner: "classy",
      maskType: "star",
      maskCustom: "M0 0 L10 10 Z",
      frameStyle: "dashed",
      frameText: "SCAN",
      frameTextSize: 170,
      frameTextEnabled: true,
      frameFont: "figtree",
      frameColor: "#123ABC",
      frameTextColor: "#DEF012",
      frameGradient: { type: "linear", rotation: 270, color2: "#111213" },
      frameTextGradient: { type: "radial", rotation: 10, color2: "#141516" },
      logoDataUrl: "data:image/png;base64,AAAA",
      logoFilename: "url",
      bgImageDataUrl: "data:image/png;base64,BBBB",
      logoSizeProportion: 0.35,
      imageMargin: 7,
    });

    const url = encodeStateToUrl();
    window.history.replaceState({}, "", new URL(url).hash);
    expect(decodeStateFromUrl()).toBe(true);

    const g = state.generator;
    expect(g.dataType).toBe("wifi");
    expect(g.dataString).toBe("WIFI:S:Net;T:WPA;P:secret123;H:false;;");
    expect(g.ecc).toBe("Q");
    expect(g.width).toBe(512);
    expect(g.height).toBe(512);
    expect(g.margin).toBe(6);
    expect(g.qrRadius).toBe(12);
    expect(g.dotsColor).toBe("#112233");
    expect(g.bgColor).toBe("#F0F0F0");
    expect(g.bgTransparent).toBe(true);
    expect(g.cornersSquareColor).toBe("#445566");
    expect(g.cornersDotColor).toBe("#778899");
    expect(g.bgGradient).toEqual({ type: "radial", rotation: 0, color2: "#AABBCC" });
    expect(g.dotsGradient).toEqual({ type: "linear", rotation: 90, color2: "#010203" });
    expect(g.cornersSquareGradient).toEqual({ type: "linear", rotation: 180, color2: "#040506" });
    expect(g.cornersDotGradient).toEqual({ type: "radial", rotation: 45, color2: "#070809" });
    expect(g.shapeBody).toBe("dots");
    expect(g.shapeOuter).toBe("rounded");
    expect(g.shapeInner).toBe("classy");
    expect(g.maskType).toBe("star");
    expect(g.maskCustom).toBe("M0 0 L10 10 Z");
    expect(g.frameStyle).toBe("dashed");
    expect(g.frameText).toBe("SCAN");
    expect(g.frameTextSize).toBe(170);
    expect(g.frameTextEnabled).toBe(true);
    expect(g.frameFont).toBe("figtree");
    expect(g.frameColor).toBe("#123ABC");
    expect(g.frameTextColor).toBe("#DEF012");
    expect(g.frameGradient).toEqual({ type: "linear", rotation: 270, color2: "#111213" });
    expect(g.frameTextGradient).toEqual({ type: "radial", rotation: 10, color2: "#141516" });
    expect(g.logoDataUrl).toBe("data:image/png;base64,AAAA");
    expect(g.bgImageDataUrl).toBe("data:image/png;base64,BBBB");
    expect(g.logoSizeProportion).toBe(0.35);
    expect(g.imageMargin).toBe(7);
  });
});

describe("frame gradients round-trip through the share URL", () => {
  afterEach(() => {
    state.generator.frameColor = "";
    state.generator.frameTextColor = "";
    state.generator.maskCustom = "";
    state.generator.frameGradient = null;
    state.generator.frameTextGradient = null;
    window.history.replaceState({}, "", window.location.pathname);
  });

  it("round-trips frameGradient and frameTextGradient", () => {
    state.generator.frameGradient = { type: "linear", rotation: 45, color2: "#ABCDEF" };
    state.generator.frameTextGradient = { type: "radial", rotation: 0, color2: "#123456" };
    const url = encodeStateToUrl();
    expect(url).toContain("frameGrad=");
    expect(url).toContain("frameTextGrad=");
    window.history.replaceState({}, "", new URL(url).hash);
    expect(decodeStateFromUrl()).toBe(true);
    expect(state.generator.frameGradient).toEqual({ type: "linear", rotation: 45, color2: "#ABCDEF" });
    expect(state.generator.frameTextGradient).toEqual({ type: "radial", rotation: 0, color2: "#123456" });
  });
});
