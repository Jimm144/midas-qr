import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/js/generator/generator.js", () => ({
  generateQR: vi.fn(),
  syncConfigToUI: vi.fn(),
  renderOnce: vi.fn(),
}));

async function setup() {
  vi.resetModules();
  document.body.innerHTML = "";
  const { DOM } = await import("../src/js/ui/dom.js");
  const { state } = await import("../src/js/state");

  const width = document.createElement("input");
  width.type = "number";
  const height = document.createElement("input");
  height.type = "number";
  DOM.qrWidth = width;
  DOM.qrHeight = height;
  state.generator.width = 300;
  state.generator.height = 300;

  const { initDimensionControls } = await import("../src/js/generator/controls.js");
  initDimensionControls();
  return { width, height, state };
}

describe("dimension inputs clamp to the shared numeric bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates on input without clobbering the draft, then commits on change", async () => {
    const { width, height, state } = await setup();
    width.value = "99999";
    width.dispatchEvent(new Event("input"));

    // Draft preserved: no writeback and no state commit mid-keystroke.
    expect(width.value).toBe("99999");
    expect(state.generator.width).toBe(300);

    width.dispatchEvent(new Event("change"));
    expect(state.generator.width).toBe(2000);
    expect(state.generator.height).toBe(2000);
    expect(width.value).toBe("2000");
    expect(height.value).toBe("2000");
  });

  it("clamps an undersized height on commit and mirrors into width", async () => {
    const { width, height, state } = await setup();
    height.value = "1";
    height.dispatchEvent(new Event("input"));
    expect(height.value).toBe("1");

    height.dispatchEvent(new Event("change"));
    expect(state.generator.height).toBe(50);
    expect(state.generator.width).toBe(50);
    expect(height.value).toBe("50");
    expect(width.value).toBe("50");
  });

  it("keeps an in-range value untouched and still syncs both fields", async () => {
    const { width, height, state } = await setup();
    width.value = "777";
    width.dispatchEvent(new Event("change"));

    expect(state.generator.width).toBe(777);
    expect(state.generator.height).toBe(777);
    expect(width.value).toBe("777");
    expect(height.value).toBe("777");
  });
});

describe("radius and margin inputs clamp and write back", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setup() {
    vi.resetModules();
    document.body.innerHTML = "";
    const { DOM } = await import("../src/js/ui/dom.js");
    const { state } = await import("../src/js/state");
    const radius = document.createElement("input");
    const margin = document.createElement("input");
    DOM.qrRadius = radius;
    DOM.qrMargin = margin;
    state.generator.qrRadius = 0;
    state.generator.margin = 4;
    const { initDimensionControls } = await import("../src/js/generator/controls.js");
    initDimensionControls();
    return { radius, margin, state };
  }

  it("clamps an oversized radius on commit instead of trusting the HTML max", async () => {
    const { radius, state } = await setup();
    radius.value = "5000";
    radius.dispatchEvent(new Event("input"));
    // Draft preserved while typing.
    expect(radius.value).toBe("5000");

    radius.dispatchEvent(new Event("change"));
    // The old handler stored the raw parseInt, so state and the field
    // disagreed until the next load silently changed the QR.
    expect(state.generator.qrRadius).toBeLessThanOrEqual(1000);
    expect(radius.value).toBe(String(state.generator.qrRadius));
  });

  it("clamps a negative margin to zero and writes it back on commit", async () => {
    const { margin, state } = await setup();
    margin.value = "-20";
    margin.dispatchEvent(new Event("change"));

    expect(state.generator.margin).toBe(0);
    expect(margin.value).toBe("0");
  });

  it("clamps an oversized margin on commit", async () => {
    const { margin, state } = await setup();
    margin.value = "5000";
    margin.dispatchEvent(new Event("change"));

    expect(state.generator.margin).toBeLessThanOrEqual(100);
    expect(margin.value).toBe(String(state.generator.margin));
  });
});
