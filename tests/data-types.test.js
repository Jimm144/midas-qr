import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ALLOWED_DATA_TYPES } from "../src/js/constants.js";
import { DATA_TYPES, fieldsForType } from "../src/js/generator/data-types.js";
import { compileDataString } from "../src/js/generator/generator.js";
import { state } from "../src/js/state";
import { DOM } from "../src/js/ui/dom.js";

const initialGenerator = { ...state.generator };

/** Guarded DOM lookup mirroring share.js's private field(). */
const field = (id) => {
  const el = DOM[id];
  return el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
    ? el
    : null;
};

const withDom = (refs, run) => {
  const previous = {};
  for (const [key, el] of Object.entries(refs)) {
    previous[key] = Object.prototype.hasOwnProperty.call(DOM, key)
      ? { had: true, value: DOM[key] }
      : { had: false };
    DOM[key] = el;
  }
  try {
    run();
  } finally {
    for (const [key, prev] of Object.entries(previous)) {
      if (prev.had) DOM[key] = prev.value;
      else delete DOM[key];
    }
    Object.assign(state.generator, initialGenerator);
  }
};

const SELECT_OPTIONS = {
  wifiEnc: ["WPA", "WEP", "nopass"],
  cryptoCoin: ["bitcoin", "ethereum", "litecoin"],
};

/** One minimal form control per registry field for `type`. */
const stubRefs = (type) => {
  const refs = {};
  for (const prop of fieldsForType(type)) {
    const options = SELECT_OPTIONS[prop];
    const el = document.createElement(options ? "select" : "input");
    if (options) options.forEach((value) => el.appendChild(new Option(value, value)));
    if (prop === "wifiHidden") el.type = "checkbox";
    refs[prop] = el;
  }
  return refs;
};

describe("DATA_TYPES — registry shape", () => {
  it("defines a record for every allowed data type and nothing else", () => {
    expect(Object.keys(DATA_TYPES).sort()).toEqual([...ALLOWED_DATA_TYPES].sort());
    for (const type of ALLOWED_DATA_TYPES) {
      const def = DATA_TYPES[type];
      expect(def, type).toBeTruthy();
      expect(def.fields.length, type).toBeGreaterThan(0);
      expect(typeof def.compile, type).toBe("function");
      expect(typeof def.hydrate, type).toBe("function");
      expect(fieldsForType(type), type).toEqual([...def.fields]);
    }
    expect(fieldsForType("unknown")).toEqual([]);
  });

  it("compiles empty field values without throwing for every type", () => {
    for (const type of ALLOWED_DATA_TYPES) {
      withDom(stubRefs(type), () => {
        state.generator.dataType = type;
        expect(() => compileDataString(false, true), type).not.toThrow();
        expect(state.generator.dataString, type).toBe("");
      });
    }
  });

  it("hydrates an empty payload without throwing for every type", () => {
    for (const type of ALLOWED_DATA_TYPES) {
      withDom(stubRefs(type), () => {
        expect(() => DATA_TYPES[type].hydrate("", { field }), type).not.toThrow();
      });
    }
  });
});

const ROUND_TRIP_CASES = [
  { type: "url", values: { inputUrl: "https://example.com/a?b=1" } },
  { type: "text", values: { inputText: "hello text" } },
  { type: "phone", values: { phoneNumber: "+1 555 123 4567" } },
  { type: "sms", values: { smsPhone: "+15551234567", smsMsg: "Hi: there" } },
  { type: "geo", values: { geoLat: "37.77", geoLon: "-122.41" } },
  {
    type: "wifi",
    values: { wifiSsid: "My Net", wifiPass: "se;cret12", wifiEnc: "WPA", wifiHidden: true },
  },
  {
    type: "crypto",
    values: {
      cryptoCoin: "bitcoin",
      cryptoAddress: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      cryptoAmount: "1.5",
    },
  },
  {
    type: "email",
    values: { emailTo: "a@b.co", emailSubject: "Hi there", emailBody: "Body line" },
  },
];

describe("DATA_TYPES — compile -> hydrate round trips", () => {
  it.each(ROUND_TRIP_CASES)("round-trips a $type payload", ({ type, values }) => {
    const refs = stubRefs(type);
    withDom(refs, () => {
      state.generator.dataType = type;
      for (const [prop, value] of Object.entries(values)) {
        if (refs[prop].type === "checkbox") refs[prop].checked = value;
        else refs[prop].value = value;
      }
      compileDataString(false, true);
      const compiled = state.generator.dataString;
      expect(compiled, type).not.toBe("");
      expect(state.generator.isValid, type).toBe(true);

      for (const prop of fieldsForType(type)) {
        if (refs[prop].type === "checkbox") refs[prop].checked = false;
        else refs[prop].value = "";
      }
      DATA_TYPES[type].hydrate(compiled, { field });

      for (const [prop, value] of Object.entries(values)) {
        if (refs[prop].type === "checkbox") expect(refs[prop].checked, `${type}.${prop}`).toBe(value);
        else expect(refs[prop].value, `${type}.${prop}`).toBe(value);
      }
    });
  });
});

describe("DATA_TYPES fields are covered by the persisted field capture", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("captures every registry field through captureGeneratorFields", async () => {
    const { bootRealDom } = await import("./helpers/dom-fixture.js");
    const freshDom = await bootRealDom();
    const { captureGeneratorFields } = await import("../src/js/state");
    const captured = captureGeneratorFields();
    for (const type of ALLOWED_DATA_TYPES) {
      for (const prop of fieldsForType(type)) {
        const el = freshDom[prop];
        expect(el, `${type}.${prop}`).toBeTruthy();
        expect(Object.keys(captured), `${type}.${prop} (#${el.id})`).toContain(el.id);
      }
    }
  });
});

describe("DATA_TYPES — sms warning is attached to the right field", () => {
  const compileSms = (phone, message) => {
    const calls = [];
    const warning = document.createElement("p");
    const r = DATA_TYPES.sms.compile({
      DOM: { smsPhone: phone, smsMsg: message, smsWarning: warning },
      showWarnings: true,
      setWarning: (el, show, related) => calls.push({ el, show, related }),
      setAriaInvalid: () => {},
    });
    return { r, calls, warning };
  };

  it("points a phone error at the phone input", () => {
    const phone = document.createElement("input");
    phone.value = "abc";
    const message = document.createElement("textarea");
    const { r, calls } = compileSms(phone, message);
    expect(r.isValid).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].show).toBe(true);
    expect(calls[0].related).toBe(phone);
  });

  it("points an over-long body at the message field", () => {
    const phone = document.createElement("input");
    phone.value = "+15551234567";
    const message = document.createElement("textarea");
    message.value = "a".repeat(1601);
    const { r, calls } = compileSms(phone, message);
    expect(r.isValid).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].show).toBe(true);
    expect(calls[0].related).toBe(message);
  });
});
