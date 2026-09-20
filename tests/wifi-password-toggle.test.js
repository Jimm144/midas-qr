import { describe, it, expect, vi } from "vitest";

vi.mock("../src/js/generator/generator.js", () => ({ compileDataString: vi.fn() }));

async function setup() {
  vi.resetModules();
  document.body.innerHTML = "";
  const { DOM } = await import("../src/js/ui/dom.js");
  const enc = document.createElement("select");
  enc.id = "wifi-enc";
  enc.innerHTML = `<option value="WPA">WPA/WPA2</option><option value="nopass">Unsecured</option>`;
  const pass = document.createElement("input");
  pass.id = "wifi-pass";
  pass.type = "password";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "btn-toggle-pass";
  const eye = document.createElement("span");
  eye.id = "icon-eye";
  const eyeOff = document.createElement("span");
  eyeOff.id = "icon-eye-off";
  document.body.append(enc, pass, toggle, eye, eyeOff);
  DOM.wifiEnc = enc;
  DOM.wifiPass = pass;

  const { initInputHandlers } = await import("../src/js/generator/inputs.js");
  initInputHandlers();
  return { enc, pass, toggle };
}

describe("Wi-Fi security select and password reveal", () => {
  it("disables the password field and reveal toggle for unsecured networks", async () => {
    const { enc, pass, toggle } = await setup();
    expect(pass.disabled).toBe(false);
    expect(toggle.disabled).toBe(false);

    enc.value = "nopass";
    enc.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pass.disabled).toBe(true);
    expect(toggle.disabled).toBe(true);
    expect(toggle.style.opacity).toBe("0.3");

    enc.value = "WPA";
    enc.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pass.disabled).toBe(false);
    expect(toggle.disabled).toBe(false);
    expect(toggle.style.opacity).toBe("0.7");
  });

  it("still toggles password visibility when the network is secured", async () => {
    const { pass, toggle } = await setup();
    expect(pass.type).toBe("password");
    toggle.click();
    expect(pass.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    toggle.click();
    expect(pass.type).toBe("password");
  });
});
