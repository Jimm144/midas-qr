import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  state,
  STATE_KEY,
  LOGO_STATE_KEY,
  APP_SCHEMA_VERSION,
  serializableGenerator,
  sanitizeGeneratorConfig,
  sanitizeGeneratorHistory,
  sanitizeScannerHistory,
  persistedSchemaVersion,
  migratePersistedState,
  persistAppState,
  persistScannerHistory,
  setupStatePersistence,
  loadState,
  applyGeneratorFields,
  captureGeneratorFields,
} from "../src/js/state";
import {
  MAX_FRAME_TEXT_LEN,
  MAX_GENERATOR_HISTORY,
  MAX_SCAN_HISTORY,
  MAX_STATE_FIELDS,
  MAX_STATE_IMAGE_LEN,
  MAX_STATE_TEXT_LEN,
} from "../src/js/constants.js";
import { initDateTimePickers } from "../src/js/ui/datetime-picker.js";
import { getIntlLocale } from "../src/js/i18n.js";

function datetimeDisplay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  const date = new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
  // The picker formats with the active UI language, not the runtime default,
  // so the expectation has to ask for the same locale.
  const locale = getIntlLocale();
  return {
    date: date.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" }),
    time: date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
  };
}

describe("state schema", () => {
  it("exposes a stable schema version", () => {
    expect(APP_SCHEMA_VERSION).toBe(1);
    expect(STATE_KEY).toBe("qr_state_v1");
  });
});

describe("serializableGenerator", () => {
  it("returns a detached, JSON-serializable copy of the generator state", () => {
    const s = serializableGenerator(state.generator);
    expect(s).not.toBe(state.generator);
    expect(s.dataType).toBe(state.generator.dataType);
    expect(() => JSON.stringify(s)).not.toThrow();
  });
});

describe("persistAppState — quota eviction", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists a small state successfully and writes the version tag", () => {
    const ok = persistAppState(false);
    expect(ok).toBe(true);
    const raw = localStorage.getItem(STATE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw || "{}");
    expect(parsed.v).toBe(APP_SCHEMA_VERSION);
  });

  it("returns false on quota exceeded (simulated) and never throws", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      const err = new DOMException("quota", "QuotaExceededError");
      throw err;
    };
    try {
      const ok = persistAppState(false);
      expect(ok).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("loadState — migration from legacy key", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("migrates a legacy `qr_state` blob into `qr_state_v1` on read", () => {
    const legacy = {
      generatorHistory: [{ id: 1, time: "now", config: { ...state.generator } }],
      scanner: { history: [{ id: 2, content: "https://x", time: "now" }] },
      generator: { ...state.generator, dataType: "text" },
    };
    localStorage.setItem("qr_state", JSON.stringify(legacy));
    loadState();
    expect(state.generator.dataType).toBe("text");
    expect(state.scanner.history.length).toBe(1);
    expect(state.generatorHistory.length).toBe(1);
  });

  it("does not throw when storage is empty", () => {
    expect(() => loadState()).not.toThrow();
  });
});

describe("loadState — restores saved input fields", () => {
  let textInput;
  let checkbox;

  beforeEach(() => {
    localStorage.clear();
    textInput = document.createElement("input");
    textInput.id = "input-text";
    textInput.type = "text";
    checkbox = document.createElement("input");
    checkbox.id = "wifi-hidden";
    checkbox.type = "checkbox";
    document.body.append(textInput, checkbox);
  });

  it("sets input values and checkbox state without calling generateQR or throwing", () => {
    const saved = {
      v: APP_SCHEMA_VERSION,
      generatorHistory: [],
      scanner: { history: [] },
      generator: {
        ...state.generator,
        fields: { "input-text": "hello world", "wifi-hidden": true },
      },
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(saved));
    expect(() => loadState()).not.toThrow();
    expect(textInput.value).toBe("hello world");
    expect(checkbox.checked).toBe(true);
  });

  it("skips fields whose elements are missing without throwing", () => {
    const saved = {
      v: APP_SCHEMA_VERSION,
      generatorHistory: [],
      scanner: { history: [] },
      generator: {
        ...state.generator,
        fields: { "does-not-exist": "x" },
      },
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(saved));
    expect(() => loadState()).not.toThrow();
  });
});

describe("sanitizeGeneratorConfig", () => {
  it("drops wrong-typed fields, unknown keys and malformed gradients", () => {
    const clean = sanitizeGeneratorConfig({
      dataString: 42,
      maskCustom: { evil: true },
      bgColor: null,
      width: 1e6,
      margin: -5,
      logoSizeProportion: "big",
      bgGradient: { type: "linear", rotation: NaN, color2: "#fff" },
      dotsGradient: { type: "radial", rotation: 45, color2: "#AABBCC" },
      fields: { a: "x", b: 1, c: true, d: {} },
      unknownKey: "x",
    });
    expect(clean).not.toHaveProperty("dataString");
    expect(clean).not.toHaveProperty("maskCustom");
    expect(clean).not.toHaveProperty("bgColor");
    expect(clean).not.toHaveProperty("logoSizeProportion");
    expect(clean).not.toHaveProperty("bgGradient");
    expect(clean).not.toHaveProperty("unknownKey");
    expect(clean.width).toBe(2000);
    expect(clean.margin).toBe(0);
    expect(clean.dotsGradient).toEqual({ type: "radial", rotation: 45, color2: "#AABBCC" });
    expect(clean.fields).toEqual({ a: "x", b: 1, c: true });
  });

  it("returns an empty object for non-object input", () => {
    expect(sanitizeGeneratorConfig(null)).toEqual({});
    expect(sanitizeGeneratorConfig("nope")).toEqual({});
    expect(sanitizeGeneratorConfig([1, 2])).toEqual({});
  });
});

describe("loadState — corrupt and hostile persisted state", () => {
  beforeEach(() => {
    localStorage.clear();
    state.generator.dataType = "url";
    state.generator.dataString = "";
    state.generator.bgColor = "#000000";
    state.generator.maskCustom = "";
    state.generator.width = 300;
    state.generatorHistory = [];
    state.scanner.history = [];
  });

  it("does not throw and keeps current state for corrupt JSON", () => {
    localStorage.setItem(STATE_KEY, "{this is not json");
    expect(() => loadState()).not.toThrow();
    expect(state.generator.dataString).toBe("");
    expect(state.generatorHistory).toEqual([]);
  });

  it("survives a truncated (partially written) JSON blob without applying it", () => {
    localStorage.setItem(STATE_KEY, '{"v":1,"generator":{"dataString":"partial"');
    expect(() => loadState()).not.toThrow();
    expect(state.generator.dataString).toBe("");
  });

  it("overwrites a corrupt blob on the next successful persist", () => {
    localStorage.setItem(STATE_KEY, "{broken");
    loadState();
    expect(persistAppState(false)).toBe(true);
    expect(() => JSON.parse(localStorage.getItem(STATE_KEY))).not.toThrow();
  });

  it("prefers the current key over a legacy blob when both exist", () => {
    localStorage.setItem(
      "qr_state",
      JSON.stringify({ generator: { dataType: "text", dataString: "legacy" } })
    );
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ v: APP_SCHEMA_VERSION, generator: { dataType: "url", dataString: "current" } })
    );
    loadState();
    expect(state.generator.dataString).toBe("current");
  });

  it("ignores wrong-shaped state and never applies wrong-typed generator fields", () => {
    const hostile = {
      v: APP_SCHEMA_VERSION,
      generatorHistory: { not: "an array" },
      scanner: { history: "also not an array" },
      generator: {
        width: "wide",
        height: -100,
        bgColor: 42,
        maskCustom: { evil: true },
        frameText: ["x"],
        dataString: 12345,
        fields: "nope",
      },
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(hostile));
    expect(() => loadState()).not.toThrow();
    expect(state.generatorHistory).toEqual([]);
    expect(state.scanner.history).toEqual([]);
    expect(state.generator.bgColor).toBe("#000000");
    expect(state.generator.maskCustom).toBe("");
    expect(state.generator.dataString).toBe("");
    expect(typeof state.generator.width).toBe("number");
    expect(state.generator.height).toBeGreaterThanOrEqual(50);
  });

  it("degrades to fresh state for an unknown future schema version", () => {
    const future = {
      v: 999,
      generatorHistory: [{ id: 1, time: "later", config: { dataString: "from-the-future" } }],
      scanner: { history: [{ id: 2, content: "future", time: "later" }] },
      generator: { dataType: "text", dataString: "from-the-future" },
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(future));
    loadState();
    expect(state.generator.dataType).toBe("url");
    expect(state.generator.dataString).toBe("");
    expect(state.generatorHistory).toEqual([]);
    expect(state.scanner.history).toEqual([]);
  });
});

describe("persist sites — failures are caught, not thrown", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persistAppState returns false without throwing when serialization fails", () => {
    const circular = {};
    circular.self = circular;
    state.generatorHistory = [circular];
    try {
      expect(persistAppState(false)).toBe(false);
    } finally {
      state.generatorHistory = [];
    }
  });

  it("persistScannerHistory reports success and quota failure", () => {
    expect(persistScannerHistory()).toBe(true);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("quota", "QuotaExceededError");
    };
    try {
      expect(persistScannerHistory()).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
describe("applyGeneratorFields", () => {
  it("restores text inputs, checkboxes and custom-select triggers", () => {
    document.body.innerHTML = [
      '<input id="input-url" value="">',
      '<input type="checkbox" id="wifi-hidden">',
      '<div class="custom-select-wrapper">',
      '  <div class="custom-select-trigger"></div>',
      '  <div class="custom-select-options"><div class="custom-select-option"></div><div class="custom-select-option"></div></div>',
      '  <select id="wifi-enc"><option value="WPA">WPA/WPA2</option><option value="WEP">WEP</option></select>',
      "</div>",
    ].join("");
    applyGeneratorFields({ "input-url": "https://x.test", "wifi-hidden": true, "wifi-enc": "WEP" });
    expect(document.getElementById("input-url").value).toBe("https://x.test");
    expect(document.getElementById("wifi-hidden").checked).toBe(true);
    expect(document.getElementById("wifi-enc").value).toBe("WEP");
    expect(document.querySelector(".custom-select-trigger").textContent).toBe("WEP");
    expect(document.querySelectorAll(".custom-select-option.selected").length).toBe(1);
  });

  it("ignores null/array field payloads and unknown ids", () => {
    expect(() => applyGeneratorFields(null)).not.toThrow();
    expect(() => applyGeneratorFields(undefined)).not.toThrow();
    expect(() => applyGeneratorFields([1, 2])).not.toThrow();
    expect(() => applyGeneratorFields({ nope: "x" })).not.toThrow();
  });

  it("round-trips captured field values through applyGeneratorFields", () => {
    document.body.innerHTML =
      '<input id="input-text" value="typed text"><input type="checkbox" id="wifi-hidden" checked>';
    const captured = captureGeneratorFields();
    expect(captured).toEqual({ "input-text": "typed text", "wifi-hidden": true });
    expect(state.generator.fields).toEqual(captured);

    document.getElementById("input-text").value = "";
    document.getElementById("wifi-hidden").checked = false;
    applyGeneratorFields(captured);

    expect(document.getElementById("input-text").value).toBe("typed text");
    expect(document.getElementById("wifi-hidden").checked).toBe(true);
  });

  it("refreshes the datetime trigger labels when restoring event fields", () => {
    document.body.innerHTML = [
      '<div class="dt-field" data-datetime-field>',
      '  <input type="datetime-local" id="event-start" aria-label="Event start time">',
      "</div>",
      '<div class="dt-field" data-datetime-field>',
      '  <input type="datetime-local" id="event-end" aria-label="Event end time">',
      "</div>",
    ].join("");
    initDateTimePickers(document);
    applyGeneratorFields({ "event-start": "2026-09-17T14:30", "event-end": "2026-09-17T16:00" });

    const dateTriggers = document.querySelectorAll(".dt-trigger-date");
    const timeInputs = document.querySelectorAll(".dt-time-input");
    expect(dateTriggers).toHaveLength(2);
    expect(timeInputs).toHaveLength(2);
    const start = datetimeDisplay("2026-09-17T14:30");
    const end = datetimeDisplay("2026-09-17T16:00");
    expect(dateTriggers[0].textContent).toBe(start.date);
    expect(timeInputs[0].value).toBe(start.time);
    expect(dateTriggers[1].textContent).toBe(end.date);
    expect(timeInputs[1].value).toBe(end.time);
    document.body.innerHTML = "";
  });
});

describe("sanitizeGeneratorConfig — every numeric field is clamped", () => {
  const intFields = [
    ["width", 50, 2000],
    ["height", 50, 2000],
    ["margin", 0, 100],
    ["qrRadius", 0, 1000],
    ["imageMargin", 0, 100],
    ["frameTextSize", 60, 200],
  ];

  it.each(intFields)("%s clamps below-min and above-max and rounds fractions", (field, min, max) => {
    expect(sanitizeGeneratorConfig({ [field]: min - 1000 })[field]).toBe(min);
    expect(sanitizeGeneratorConfig({ [field]: max + 1000 })[field]).toBe(max);
    const fraction = min + 10.6;
    expect(sanitizeGeneratorConfig({ [field]: fraction })[field]).toBe(Math.round(fraction));
  });

  it.each(intFields)("%s keeps in-range integers exactly", (field, min, max) => {
    const mid = Math.round((min + max) / 2);
    expect(sanitizeGeneratorConfig({ [field]: mid })[field]).toBe(mid);
  });

  it.each(intFields)("%s drops non-finite and wrong-typed values", (field) => {
    expect(sanitizeGeneratorConfig({ [field]: NaN })).not.toHaveProperty(field);
    expect(sanitizeGeneratorConfig({ [field]: Infinity })).not.toHaveProperty(field);
    expect(sanitizeGeneratorConfig({ [field]: "-Infinity" })).not.toHaveProperty(field);
    expect(sanitizeGeneratorConfig({ [field]: String(300) })).not.toHaveProperty(field);
    expect(sanitizeGeneratorConfig({ [field]: null })).not.toHaveProperty(field);
  });

  it("clamps logoSizeProportion as a float", () => {
    expect(sanitizeGeneratorConfig({ logoSizeProportion: -5 }).logoSizeProportion).toBe(0.1);
    expect(sanitizeGeneratorConfig({ logoSizeProportion: 99 }).logoSizeProportion).toBe(0.5);
    expect(sanitizeGeneratorConfig({ logoSizeProportion: 0.33 }).logoSizeProportion).toBe(0.33);
    expect(sanitizeGeneratorConfig({ logoSizeProportion: NaN })).not.toHaveProperty("logoSizeProportion");
    expect(sanitizeGeneratorConfig({ logoSizeProportion: "0.4" })).not.toHaveProperty("logoSizeProportion");
  });
});

describe("sanitizeGeneratorConfig — frame text size migration", () => {
  it("maps the legacy string presets to percentages", () => {
    expect(sanitizeGeneratorConfig({ frameTextSize: "small" }).frameTextSize).toBe(85);
    expect(sanitizeGeneratorConfig({ frameTextSize: "medium" }).frameTextSize).toBe(100);
    expect(sanitizeGeneratorConfig({ frameTextSize: "large" }).frameTextSize).toBe(125);
  });

  it("is idempotent: a migrated value survives a second pass unchanged", () => {
    const once = sanitizeGeneratorConfig({ frameTextSize: "small" });
    expect(sanitizeGeneratorConfig(once)).toEqual(once);
  });

  it("drops unknown strings, non-numbers and out-of-enum values", () => {
    for (const bad of ["huge", "LARGE", "", true, null, {}, []]) {
      expect(sanitizeGeneratorConfig({ frameTextSize: bad })).not.toHaveProperty("frameTextSize");
    }
  });

  it("keeps the frame-text toggle only as a boolean", () => {
    expect(sanitizeGeneratorConfig({ frameTextEnabled: false }).frameTextEnabled).toBe(false);
    expect(sanitizeGeneratorConfig({ frameTextEnabled: true }).frameTextEnabled).toBe(true);
    for (const bad of ["true", "false", 1, 0, null, {}, []]) {
      expect(sanitizeGeneratorConfig({ frameTextEnabled: bad })).not.toHaveProperty("frameTextEnabled");
    }
  });

  it("drops removed frame styles from persisted configs", () => {
    for (const removed of ["bottom", "top", "swoop", "crop", "squircle"]) {
      expect(sanitizeGeneratorConfig({ frameStyle: removed })).not.toHaveProperty("frameStyle");
    }
  });
});

describe("sanitizeGeneratorConfig — enums, colors, strings, images, gradients", () => {
  it("keeps allow-listed enums and drops every unknown value", () => {
    const good = sanitizeGeneratorConfig({
      dataType: "email",
      ecc: "Q",
      shapeBody: "dots",
      shapeOuter: "rounded",
      shapeInner: "classy",
      maskType: "heart",
      frameStyle: "badge",
      frameTextSize: 170,
      frameTextEnabled: false,
      frameFont: "figtree",
    });
    expect(good).toMatchObject({
      dataType: "email",
      ecc: "Q",
      shapeBody: "dots",
      shapeOuter: "rounded",
      shapeInner: "classy",
      maskType: "heart",
      frameStyle: "badge",
      frameTextSize: 170,
      frameTextEnabled: false,
      frameFont: "figtree",
    });
    const bad = sanitizeGeneratorConfig({
      dataType: "evil",
      ecc: "Z",
      shapeBody: "cross",
      shapeOuter: "cross",
      shapeInner: "cross",
      maskType: "evil",
      frameStyle: "evil",
      frameTextSize: "huge",
      frameTextEnabled: "yes",
      frameFont: "comic",
    });
    expect(bad).toEqual({});
  });

  it("keeps canonical hex colors and drops malformed or wrong-typed ones", () => {
    expect(sanitizeGeneratorConfig({ dotsColor: "#A1b2C3" }).dotsColor).toBe("#A1b2C3");
    expect(sanitizeGeneratorConfig({ dotsColor: "#abc" })).not.toHaveProperty("dotsColor");
    expect(sanitizeGeneratorConfig({ dotsColor: "red" })).not.toHaveProperty("dotsColor");
    expect(sanitizeGeneratorConfig({ bgColor: null })).not.toHaveProperty("bgColor");
    expect(sanitizeGeneratorConfig({ frameColor: "" }).frameColor).toBe("");
    expect(sanitizeGeneratorConfig({ frameTextColor: "#00ff00" }).frameTextColor).toBe("#00ff00");
    expect(sanitizeGeneratorConfig({ frameTextColor: "url(x)" })).not.toHaveProperty("frameTextColor");
  });

  it("caps and cleans string fields", () => {
    const long = "A".repeat(MAX_STATE_TEXT_LEN + 10);
    expect(sanitizeGeneratorConfig({ dataString: long })).not.toHaveProperty("dataString");
    expect(sanitizeGeneratorConfig({ dataString: "ok" }).dataString).toBe("ok");
    expect(sanitizeGeneratorConfig({ maskCustom: long })).not.toHaveProperty("maskCustom");
    expect(sanitizeGeneratorConfig({ maskCustom: 'M0 0" onload="x' }).maskCustom).not.toContain('"');
    expect(sanitizeGeneratorConfig({ frameText: "x".repeat(100) }).frameText).toHaveLength(
      MAX_FRAME_TEXT_LEN
    );
    expect(sanitizeGeneratorConfig({ logoFilename: "f".repeat(1000) }).logoFilename).toHaveLength(256);
  });

  it("accepts only bitmap data URLs or http(s) for persisted images", () => {
    const png = "data:image/png;base64,AAAA";
    expect(sanitizeGeneratorConfig({ logoDataUrl: png }).logoDataUrl).toBe(png);
    expect(sanitizeGeneratorConfig({ logoDataUrl: "https://x.test/a.png" }).logoDataUrl).toBe(
      "https://x.test/a.png"
    );
    expect(sanitizeGeneratorConfig({ logoDataUrl: null }).logoDataUrl).toBeNull();
    expect(sanitizeGeneratorConfig({ logoDataUrl: "data:image/svg+xml;base64,AAAA" })).not.toHaveProperty(
      "logoDataUrl"
    );
    expect(sanitizeGeneratorConfig({ logoDataUrl: "javascript:alert(1)" })).not.toHaveProperty("logoDataUrl");
    expect(sanitizeGeneratorConfig({ bgImageDataUrl: png }).bgImageDataUrl).toBe(png);
    expect(sanitizeGeneratorConfig({ bgImageDataUrl: "data:image/svg+xml,<svg/>" })).not.toHaveProperty(
      "bgImageDataUrl"
    );
    expect(sanitizeGeneratorConfig({ bgImageDataUrl: 42 })).not.toHaveProperty("bgImageDataUrl");
    const huge = "data:image/png;base64," + "A".repeat(MAX_STATE_IMAGE_LEN);
    expect(sanitizeGeneratorConfig({ bgImageDataUrl: huge })).not.toHaveProperty("bgImageDataUrl");
  });

  it("clamps gradient rotation and drops malformed specs", () => {
    expect(
      sanitizeGeneratorConfig({ bgGradient: { type: "linear", rotation: 720.4, color2: "#AABBCC" } })
        .bgGradient
    ).toEqual({ type: "linear", rotation: 360, color2: "#AABBCC" });
    expect(
      sanitizeGeneratorConfig({ bgGradient: { type: "linear", rotation: -5, color2: "#AABBCC" } }).bgGradient
    ).toEqual({ type: "linear", rotation: 0, color2: "#AABBCC" });
    expect(
      sanitizeGeneratorConfig({ dotsGradient: { type: "spiral", rotation: 10, color2: "#AABBCC" } })
    ).not.toHaveProperty("dotsGradient");
    expect(
      sanitizeGeneratorConfig({ dotsGradient: { type: "linear", rotation: Infinity, color2: "#AABBCC" } })
    ).not.toHaveProperty("dotsGradient");
    expect(
      sanitizeGeneratorConfig({ dotsGradient: { type: "linear", rotation: 10, color2: "red" } })
    ).not.toHaveProperty("dotsGradient");
    expect(sanitizeGeneratorConfig({ cornersDotGradient: null }).cornersDotGradient).toBeNull();
  });

  it("caps and cleans the persisted fields bag", () => {
    expect(sanitizeGeneratorConfig({ fields: { a: "x", b: 1, c: true, d: {}, e: NaN } }).fields).toEqual({
      a: "x",
      b: 1,
      c: true,
    });
    const many = {};
    for (let i = 0; i < 500; i++) many["f" + i] = "v";
    expect(Object.keys(sanitizeGeneratorConfig({ fields: many }).fields)).toHaveLength(MAX_STATE_FIELDS);
    const longValue = sanitizeGeneratorConfig({ fields: { big: "y".repeat(10000) } }).fields;
    expect(longValue.big).toHaveLength(MAX_STATE_TEXT_LEN);
  });

  it("drops unknown top-level keys", () => {
    expect(sanitizeGeneratorConfig({ nope: 1, EVIL: { nested: true } })).toEqual({});
  });

  it("is idempotent on its own output", () => {
    const rich = {
      dataType: "wifi",
      dataString: "WIFI:S:Net;T:WPA;P:secret123;H:false;;",
      ecc: "Q",
      width: 512,
      margin: 6,
      qrRadius: 12,
      dotsColor: "#112233",
      frameColor: "",
      frameText: "SCAN",
      frameTextEnabled: false,
      maskCustom: 'M0 0 L10 10" Z',
      dotsGradient: { type: "linear", rotation: 90, color2: "#010203" },
      frameTextGradient: { type: "radial", rotation: 10, color2: "#141516" },
      logoDataUrl: "data:image/png;base64,AAAA",
      bgImageDataUrl: "https://example.com/bg.png",
      logoSizeProportion: 0.35,
      imageMargin: 7,
      fields: { "input-text": "hello", "wifi-hidden": true },
    };
    const once = sanitizeGeneratorConfig(rich);
    const twice = sanitizeGeneratorConfig(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});

describe("persistedSchemaVersion / migratePersistedState", () => {
  it.each([
    [{}, 0],
    [{ v: 0 }, 0],
    [{ v: 1 }, APP_SCHEMA_VERSION],
    [{ v: "1" }, 1],
    [{ v: " 1 " }, 1],
    [{ v: "0" }, 0],
  ])("accepts supported tag %j", (raw, expected) => {
    expect(persistedSchemaVersion(raw)).toBe(expected);
  });

  it.each([
    [{ v: 2 }],
    [{ v: 999 }],
    [{ v: 1.5 }],
    [{ v: -1 }],
    [{ v: NaN }],
    [{ v: null }],
    [{ v: true }],
    [{ v: {} }],
    [{ v: [] }],
    [{ v: "" }],
    [{ v: "abc" }],
    [null],
    [[1]],
  ])("rejects unsupported tag %j and never migrates it", (raw) => {
    expect(persistedSchemaVersion(raw)).toBeNull();
    expect(migratePersistedState(raw)).toEqual({});
  });

  it("passes a supported or legacy blob through unchanged", () => {
    const versioned = { v: 1, generator: { dataType: "text" } };
    const legacy = { generator: { dataType: "text" } };
    expect(migratePersistedState(versioned)).toBe(versioned);
    expect(migratePersistedState(legacy)).toBe(legacy);
  });
});

describe("loadState — history and image sanitizing", () => {
  beforeEach(() => {
    localStorage.clear();
    state.generator.dataType = "url";
    state.generator.dataString = "";
    state.generator.logoDataUrl = null;
    state.generatorHistory = [];
    state.scanner.history = [];
  });

  it("caps oversized generator history arrays at the newest entries", () => {
    const items = Array.from({ length: MAX_GENERATOR_HISTORY + 20 }, (_, i) => ({
      id: i,
      time: "t",
      config: { dataString: "d" + i },
    }));
    localStorage.setItem(STATE_KEY, JSON.stringify({ v: 1, generatorHistory: items }));
    loadState();
    expect(state.generatorHistory).toHaveLength(MAX_GENERATOR_HISTORY);
    expect(state.generatorHistory.every((item) => item && typeof item.config === "object")).toBe(true);
  });

  it("drops non-object generator history entries", () => {
    const items = [
      { id: 1, time: "t", config: { dataString: "keep" } },
      null,
      "bad",
      { id: 2 },
      { id: 3, config: "nope" },
      { id: 4, time: 42, config: { dataString: "keep-too" } },
    ];
    localStorage.setItem(STATE_KEY, JSON.stringify({ v: 1, generatorHistory: items }));
    loadState();
    expect(state.generatorHistory).toHaveLength(2);
    expect(state.generatorHistory.map((item) => item.config.dataString)).toEqual(["keep", "keep-too"]);
    expect(state.generatorHistory[1].time).toBe("");
  });

  it("caps scanner history, drops bad entries and truncates hostile content", () => {
    const history = Array.from({ length: MAX_SCAN_HISTORY + 5 }, (_, i) => ({
      id: i,
      content: "x".repeat(MAX_STATE_TEXT_LEN + 100),
      time: "t",
    }));
    history.push({ id: 99, content: 42, time: "t" }, null);
    localStorage.setItem(STATE_KEY, JSON.stringify({ v: 1, scanner: { history } }));
    loadState();
    expect(state.scanner.history).toHaveLength(MAX_SCAN_HISTORY);
    expect(state.scanner.history.every((h) => h.content.length <= MAX_STATE_TEXT_LEN)).toBe(true);
  });

  it("ignores a generator payload that is not an object", () => {
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ v: 1, generator: [1, 2, 3], generatorHistory: [], scanner: { history: [] } })
    );
    expect(() => loadState()).not.toThrow();
    expect(state.generator.dataType).toBe("url");
  });

  it("sanitizes hostile logo payloads stored under the logo key", () => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ v: 1, generator: { dataType: "text" } }));
    localStorage.setItem(LOGO_STATE_KEY, "data:image/svg+xml;base64,AAAA");
    loadState();
    expect(state.generator.logoDataUrl).toBeNull();
    expect(localStorage.getItem(LOGO_STATE_KEY)).toBeNull();
  });

  it("rewrites an invalid stored logo from the legacy in-blob logo on the next persist", () => {
    localStorage.setItem(LOGO_STATE_KEY, "data:image/svg+xml;base64,AAAA");
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ v: 1, generator: { logoDataUrl: "data:image/png;base64,AAAA" } })
    );
    loadState();
    expect(state.generator.logoDataUrl).toBe("data:image/png;base64,AAAA");
    persistAppState(false);
    expect(localStorage.getItem(LOGO_STATE_KEY)).toBe("data:image/png;base64,AAAA");
  });

  it("sanitizeGeneratorHistory/sanitizeScannerHistory tolerate non-arrays", () => {
    expect(sanitizeGeneratorHistory(null)).toEqual([]);
    expect(sanitizeGeneratorHistory("nope")).toEqual([]);
    expect(sanitizeScannerHistory({})).toEqual([]);
    expect(sanitizeScannerHistory(undefined)).toEqual([]);
  });
});

describe("loadState — schema version migration safety", () => {
  beforeEach(() => {
    localStorage.clear();
    state.generator.dataType = "url";
    state.generator.dataString = "";
    state.generatorHistory = [];
    state.scanner.history = [];
  });

  it.each([undefined, 0, 1, "1"])("loads blobs with supported tag %j", (v) => {
    const blob = {
      generator: { dataType: "text", dataString: "ok" },
      generatorHistory: [],
      scanner: { history: [] },
    };
    if (v !== undefined) blob.v = v;
    localStorage.setItem(STATE_KEY, JSON.stringify(blob));
    loadState();
    expect(state.generator.dataType).toBe("text");
    expect(state.generator.dataString).toBe("ok");
  });

  it.each([2, 1.5, -1, null, true])("ignores blobs with unsupported tag %j", (v) => {
    const blob = {
      v,
      generator: { dataType: "text", dataString: "bad" },
      generatorHistory: [{ id: 1, time: "t", config: { dataString: "bad" } }],
      scanner: { history: [{ id: 1, content: "bad", time: "t" }] },
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(blob));
    loadState();
    expect(state.generator.dataType).toBe("url");
    expect(state.generator.dataString).toBe("");
    expect(state.generatorHistory).toEqual([]);
    expect(state.scanner.history).toEqual([]);
  });
});

describe("loadState — inverted stock palette migration is legacy-only", () => {
  const whiteBg = {
    bgColor: "#ffffff",
    dotsColor: "#000000",
    cornersSquareColor: "#000000",
    cornersDotColor: "#000000",
  };

  beforeEach(() => {
    localStorage.clear();
    Object.assign(state.generator, { bgTransparent: false, ...whiteBg });
  });

  it("flips a pre-versioned legacy white-bg blob to the new stock palette", () => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ generator: { ...whiteBg } }));
    loadState();
    expect(state.generator.bgColor).toBe("#000000");
    expect(state.generator.dotsColor).toBe("#ffffff");
    expect(state.generator.cornersSquareColor).toBe("#ffffff");
    expect(state.generator.cornersDotColor).toBe("#ffffff");
  });

  it("flips a v0 blob but leaves a current-schema white-bg design untouched", () => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ v: 0, generator: { ...whiteBg } }));
    loadState();
    expect(state.generator.bgColor).toBe("#000000");
    expect(state.generator.dotsColor).toBe("#ffffff");

    Object.assign(state.generator, whiteBg);
    localStorage.setItem(STATE_KEY, JSON.stringify({ v: APP_SCHEMA_VERSION, generator: { ...whiteBg } }));
    loadState();
    expect(state.generator.bgColor).toBe("#ffffff");
    expect(state.generator.dotsColor).toBe("#000000");
  });

  it("keeps a current-schema white-bg design stable across repeated loads", () => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ v: APP_SCHEMA_VERSION, generator: { ...whiteBg } }));
    loadState();
    loadState();
    expect(state.generator.bgColor).toBe("#ffffff");
    expect(state.generator.dotsColor).toBe("#000000");
    expect(state.generator.cornersSquareColor).toBe("#000000");
    expect(state.generator.cornersDotColor).toBe("#000000");
  });
});

describe("persistAppState — field snapshot and quota-name robustness", () => {
  beforeEach(() => {
    localStorage.clear();
    state.generator.bgImageDataUrl = null;
    state.generator.logoDataUrl = null;
    state.generator.fields = undefined;
  });

  it("keeps the live field snapshot when a history write excludes fields", () => {
    state.generator.fields = { "input-text": "typed" };
    expect(persistAppState(false)).toBe(true);
    expect(state.generator.fields).toEqual({ "input-text": "typed" });
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY));
    expect(parsed.generator.fields).toEqual({});
  });

  it("loadState keeps the restored field snapshot in state", () => {
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ v: APP_SCHEMA_VERSION, generator: { fields: { "input-text": "restored" } } })
    );
    loadState();
    expect(state.generator.fields).toEqual({ "input-text": "restored" });
  });

  it("treats a plain Error named QuotaExceededError as quota and retries without the image", () => {
    const bg = "data:image/png;base64," + "Q".repeat(5000);
    state.generator.bgImageDataUrl = bg;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (typeof value === "string" && value.includes("QQQQQQ")) {
        const err = new Error("quota");
        err.name = "QuotaExceededError";
        throw err;
      }
      return original.call(this, key, value);
    };
    try {
      expect(persistAppState(true)).toBe(true);
    } finally {
      Storage.prototype.setItem = original;
    }
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY));
    expect(parsed.generator.bgImageDataUrl).toBeNull();
    expect(state.generator.bgImageDataUrl).toBe(bg);
    state.generator.bgImageDataUrl = null;
  });
});

describe("persistAppState — quota fallback keeps images in memory", () => {
  beforeEach(() => {
    localStorage.clear();
    state.generator.bgImageDataUrl = null;
    state.generator.logoDataUrl = null;
  });

  it("retries without the background image and keeps it in memory", () => {
    const bg = "data:image/png;base64," + "Q".repeat(5000);
    state.generator.bgImageDataUrl = bg;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (typeof value === "string" && value.includes("QQQQQQ")) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      return original.call(this, key, value);
    };
    let ok;
    try {
      ok = persistAppState(true);
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(ok).toBe(true);
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY));
    expect(parsed.generator.bgImageDataUrl).toBeNull();
    expect(state.generator.bgImageDataUrl).toBe(bg);
    state.generator.bgImageDataUrl = null;
  });

  it("returns false when even the reduced blob cannot be written", () => {
    state.generator.bgImageDataUrl = "data:image/png;base64,AAAA";
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("quota", "QuotaExceededError");
    };
    try {
      expect(persistAppState(true)).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
      state.generator.bgImageDataUrl = null;
    }
  });

  it("setupStatePersistence evicts the separately-stored logo and retries", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    setupStatePersistence();
    const entry = addSpy.mock.calls.find(([type]) => type === "beforeunload");
    addSpy.mockRestore();
    expect(entry).toBeTruthy();
    const saveState = entry[1];
    const logo = "data:image/png;base64,LOGO";
    localStorage.setItem(LOGO_STATE_KEY, logo);
    state.generator.logoDataUrl = logo;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("quota", "QuotaExceededError");
    };
    try {
      expect(() => saveState()).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
      state.generator.logoDataUrl = null;
    }
    expect(localStorage.getItem(LOGO_STATE_KEY)).toBeNull();
  });
});
