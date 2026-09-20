import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Regression guard for the boot stale-state guard (main.js: maskType="none",
 * qrRadius=0) and for any explicit qrRadius coming from a share URL or from
 * history. syncConfigToUI() writes the current frame style into the select and
 * dispatches `change`; the frame-style handler used to treat that programmatic
 * sync as a user pick and overwrite qrRadius with the frame's default (6 for
 * "dashed"), resurrecting the value the guard had just cleared.
 */
async function setupDomAndModules() {
  vi.resetModules();
  document.body.innerHTML = "";
  const domMod = await import("../src/js/ui/dom.js");
  const stateMod = await import("../src/js/state");
  const radius = document.createElement("input");
  radius.id = "qr-radius";
  const frameStyle = document.createElement("select");
  for (const value of ["none", "dashed", "rounded", "label"]) {
    const opt = document.createElement("option");
    opt.value = value;
    frameStyle.appendChild(opt);
  }
  const frameText = document.createElement("input");
  frameText.id = "qr-frame-text";
  const frameSize = document.createElement("input");
  frameSize.id = "qr-frame-size";
  const frameTextEnabled = document.createElement("input");
  frameTextEnabled.type = "checkbox";
  frameTextEnabled.id = "qr-frame-text-enabled";
  const logoOptions = document.createElement("div");
  const btnClearLogo = document.createElement("button");
  document.body.append(radius, frameStyle, frameText, frameSize, frameTextEnabled, logoOptions, btnClearLogo);
  domMod.DOM.qrRadius = radius;
  domMod.DOM.qrFrameStyle = frameStyle;
  domMod.DOM.qrFrameText = frameText;
  domMod.DOM.qrFrameSize = frameSize;
  domMod.DOM.qrFrameTextEnabled = frameTextEnabled;
  domMod.DOM.logoOptions = logoOptions;
  domMod.DOM.btnClearLogo = btnClearLogo;
  const controls = await import("../src/js/generator/controls.js");
  const generator = await import("../src/js/generator/generator.js");
  controls.initShapeAndFrameControls();
  return { DOM: domMod.DOM, state: stateMod.state, syncConfigToUI: generator.syncConfigToUI };
}

describe("stale-state guard — programmatic frame sync must not resurrect qrRadius", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the boot guard's qrRadius=0 through syncConfigToUI", async () => {
    const { DOM, state, syncConfigToUI } = await setupDomAndModules();
    state.generator.frameStyle = "dashed";
    state.generator.qrRadius = 0;

    syncConfigToUI();

    expect(state.generator.qrRadius).toBe(0);
    expect(DOM.qrRadius.value).toBe("0");
  });

  it("keeps an explicit qrRadius decoded from a share URL", async () => {
    const { DOM, state, syncConfigToUI } = await setupDomAndModules();
    state.generator.frameStyle = "dashed";
    state.generator.qrRadius = 42;

    syncConfigToUI();

    expect(state.generator.qrRadius).toBe(42);
    expect(DOM.qrRadius.value).toBe("42");
  });

  it("keeps a qrRadius restored from history", async () => {
    const { DOM, state, syncConfigToUI } = await setupDomAndModules();
    state.generator.frameStyle = "dashed";
    state.generator.qrRadius = 20;

    syncConfigToUI();

    expect(state.generator.qrRadius).toBe(20);
    expect(DOM.qrRadius.value).toBe("20");
  });

  it("still applies the frame's default radius on a real user change", async () => {
    const { DOM, state } = await setupDomAndModules();
    state.generator.frameStyle = "none";
    state.generator.qrRadius = 0;

    DOM.qrFrameStyle.value = "rounded";
    DOM.qrFrameStyle.dispatchEvent(new Event("change"));

    expect(state.generator.frameStyle).toBe("rounded");
    expect(state.generator.qrRadius).toBe(8);
    expect(DOM.qrRadius.value).toBe("8");
  });

  it("applies 0 for a frame with no default radius on a real user change", async () => {
    const { DOM, state } = await setupDomAndModules();
    state.generator.frameStyle = "rounded";
    state.generator.qrRadius = 8;

    DOM.qrFrameStyle.value = "none";
    DOM.qrFrameStyle.dispatchEvent(new Event("change"));

    expect(state.generator.qrRadius).toBe(0);
    expect(DOM.qrRadius.value).toBe("0");
  });
});

describe("frame-text toggle — style defaults and control state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("hides the text and disables its inputs on a real open-frame change", async () => {
    const { DOM, state } = await setupDomAndModules();
    state.generator.frameStyle = "none";
    state.generator.frameTextEnabled = true;

    DOM.qrFrameStyle.value = "dashed";
    DOM.qrFrameStyle.dispatchEvent(new Event("change"));

    expect(state.generator.frameTextEnabled).toBe(false);
    expect(DOM.qrFrameTextEnabled.checked).toBe(false);
    expect(DOM.qrFrameText.disabled).toBe(true);
    expect(DOM.qrFrameSize.disabled).toBe(true);
  });

  it("shows the text and re-enables its inputs on a real bar-frame change", async () => {
    const { DOM, state } = await setupDomAndModules();
    state.generator.frameStyle = "dashed";
    state.generator.frameTextEnabled = false;
    DOM.qrFrameText.disabled = true;
    DOM.qrFrameSize.disabled = true;

    DOM.qrFrameStyle.value = "label";
    DOM.qrFrameStyle.dispatchEvent(new Event("change"));

    expect(state.generator.frameTextEnabled).toBe(true);
    expect(DOM.qrFrameTextEnabled.checked).toBe(true);
    expect(DOM.qrFrameText.disabled).toBe(false);
    expect(DOM.qrFrameSize.disabled).toBe(false);
  });

  it("keeps an explicit toggle through a programmatic sync", async () => {
    const { DOM, state, syncConfigToUI } = await setupDomAndModules();
    state.generator.frameStyle = "dashed";
    state.generator.frameTextEnabled = true;

    syncConfigToUI();

    expect(state.generator.frameTextEnabled).toBe(true);
    expect(DOM.qrFrameTextEnabled.checked).toBe(true);
    expect(DOM.qrFrameText.disabled).toBe(false);
    expect(DOM.qrFrameSize.disabled).toBe(false);
  });

  it("toggles state and input availability from the checkbox", async () => {
    const { DOM, state } = await setupDomAndModules();
    state.generator.frameStyle = "label";
    state.generator.frameTextEnabled = true;

    DOM.qrFrameTextEnabled.checked = false;
    DOM.qrFrameTextEnabled.dispatchEvent(new Event("change"));

    expect(state.generator.frameTextEnabled).toBe(false);
    expect(DOM.qrFrameText.disabled).toBe(true);
    expect(DOM.qrFrameSize.disabled).toBe(true);

    DOM.qrFrameTextEnabled.checked = true;
    DOM.qrFrameTextEnabled.dispatchEvent(new Event("change"));

    expect(state.generator.frameTextEnabled).toBe(true);
    expect(DOM.qrFrameText.disabled).toBe(false);
    expect(DOM.qrFrameSize.disabled).toBe(false);
  });
});
