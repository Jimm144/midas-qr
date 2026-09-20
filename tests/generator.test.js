import { describe, it, expect } from "vitest";
import { compileDataString } from "../src/js/generator/generator.js";
import { gradientOptions } from "../src/js/generator/qr-instance.js";
import { DOM } from "../src/js/ui/dom.js";
import { state } from "../src/js/state";

describe("gradientOptions", () => {
  it("maps a stored spec onto the qr-code-styling gradient shape", () => {
    const out = gradientOptions({ type: "linear", rotation: 90, color2: "#FF0000" }, "#000000");
    expect(out.gradient.type).toBe("linear");
    expect(out.gradient.rotation).toBeCloseTo(Math.PI / 2, 5);
    expect(out.gradient.colorStops).toEqual([
      { offset: 0, color: "#000000" },
      { offset: 1, color: "#FF0000" },
    ]);
  });

  it("returns {} for missing or invalid specs", () => {
    expect(gradientOptions(null, "#000000")).toEqual({});
    expect(gradientOptions(undefined, "#000000")).toEqual({});
    expect(gradientOptions({ type: "spiral", rotation: 10, color2: "#FFFFFF" }, "#000000")).toEqual({});
    expect(gradientOptions({ type: "linear", rotation: 10, color2: "red" }, "#000000")).toEqual({});
  });
});

describe("compileDataString aria wiring", () => {
  const initial = { ...state.generator };

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
      Object.assign(state.generator, initial);
    }
  };

  it("marks the URL input invalid and clears it again for a valid URL", () => {
    const inputUrl = document.createElement("input");
    const urlWarning = document.createElement("span");
    withDom({ inputUrl, urlWarning }, () => {
      state.generator.dataType = "url";
      inputUrl.value = "not a url";
      compileDataString(false, true);
      expect(inputUrl.getAttribute("aria-invalid")).toBe("true");
      expect(urlWarning.classList.contains("hidden")).toBe(false);

      inputUrl.value = "https://example.com";
      compileDataString(false, true);
      expect(inputUrl.getAttribute("aria-invalid")).toBe("false");
      expect(urlWarning.classList.contains("hidden")).toBe(true);
      expect(state.generator.dataString).toBe("https://example.com");
      expect(state.generator.isValid).toBe(true);
    });
  });

  it("attributes a missing SSID error to the SSID input and a short password error to the password input", () => {
    const refs = {
      wifiSsid: document.createElement("input"),
      wifiPass: document.createElement("input"),
      wifiEnc: document.createElement("select"),
      wifiHidden: document.createElement("input"),
      wifiWarning: document.createElement("span"),
    };
    withDom(refs, () => {
      state.generator.dataType = "wifi";
      refs.wifiEnc.value = "WPA";
      refs.wifiHidden.checked = false;

      refs.wifiPass.value = "secret123";
      compileDataString(false, true);
      expect(refs.wifiSsid.getAttribute("aria-invalid")).toBe("true");
      expect(refs.wifiPass.getAttribute("aria-invalid")).toBe("false");

      refs.wifiSsid.value = "MyNetwork";
      refs.wifiPass.value = "short";
      compileDataString(false, true);
      expect(refs.wifiPass.getAttribute("aria-invalid")).toBe("true");
      expect(refs.wifiSsid.getAttribute("aria-invalid")).toBe("false");
    });
  });
});
