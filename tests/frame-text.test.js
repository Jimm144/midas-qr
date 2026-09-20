import { describe, it, expect, afterEach, vi } from "vitest";
import { getCombinedSvgString, frameTextFill, frameTextOutline } from "../src/js/generator/frame.js";
import { framesConfig } from "../src/js/frames";
import { state } from "../src/js/state";

const QR_STUB =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
  '<rect x="0" y="0" width="300" height="300" fill="#ffffff"/>' +
  '<g id="qr-content"><rect x="0" y="0" width="10" height="10" fill="#000000"/></g>' +
  "</svg>";

let initial;

afterEach(() => {
  Object.assign(state.generator, initial);
});

const baseState = () => {
  initial = { ...state.generator };
  state.generator.frameStyle = "label";
  state.generator.frameText = "Scan me!";
  state.generator.frameTextSize = 115;
  state.generator.frameTextEnabled = true;
  state.generator.frameFont = "theme";
  state.generator.frameColor = "#000000";
  state.generator.frameTextColor = "";
  state.generator.frameGradient = null;
  state.generator.frameTextGradient = null;
  state.generator.bgColor = "#ffffff";
  state.generator.dotsColor = "#000000";
  state.generator.bgTransparent = false;
};

async function combined() {
  const out = await getCombinedSvgString(300, 300, 4, 25, null, QR_STUB);
  return new DOMParser().parseFromString(out, "image/svg+xml");
}

describe("frame background placement", () => {
  const rootRects = (doc) =>
    [...doc.documentElement.children].filter((el) => el.tagName === "rect");

  it("keeps the background behind the QR instead of spanning the frame card", async () => {
    baseState();
    state.generator.bgColor = "#123456";
    const doc = await combined();
    // No full-card background rect: the frame card stays transparent around
    // the code, whatever the background colour.
    expect(rootRects(doc)).toHaveLength(0);
    // The QR keeps its own background inside the placed QR area.
    const inner = doc.querySelector('svg > svg[x="4"]');
    expect(inner).not.toBeNull();
    expect(inner.querySelector("rect")).not.toBeNull();
  });

  it("does the same for the opposite bar frame", async () => {
    baseState();
    state.generator.frameStyle = "badge";
    state.generator.bgColor = "#123456";
    const doc = await combined();
    expect(rootRects(doc)).toHaveLength(0);
  });
});

describe("frame label readability over gradients", () => {
  it("outlines a black label on a black-to-white bar", async () => {
    baseState();
    state.generator.frameGradient = { type: "linear", rotation: 0, color2: "#ffffff" };
    const doc = await combined();
    const text = doc.querySelector("text");
    expect(text.getAttribute("fill")).toBe("#000000");
    expect(text.getAttribute("stroke")).toBe("#ffffff");
    expect(text.getAttribute("stroke-width")).toBe("0.28");
    expect(text.getAttribute("paint-order")).toBe("stroke");
  });

  it("uses the background colour when the gradient stops stay clear of it", async () => {
    baseState();
    state.generator.frameGradient = { type: "linear", rotation: 0, color2: "#333333" };
    const doc = await combined();
    const text = doc.querySelector("text");
    expect(text.getAttribute("fill")).toBe("#ffffff");
    expect(text.getAttribute("stroke")).toBeNull();
  });

  it("falls back when an explicit label colour collides with a gradient stop", () => {
    baseState();
    state.generator.frameGradient = { type: "linear", rotation: 0, color2: "#ffffff" };
    state.generator.frameTextColor = "#ffffff";
    state.generator.bgColor = "#123456";
    expect(frameTextFill(framesConfig.label)).toBe("#123456");
  });

  it("keeps the frame/dots colour for open frames (label sits outside the bar)", async () => {
    baseState();
    state.generator.frameStyle = "scan";
    state.generator.frameColor = "#112233";
    state.generator.frameGradient = { type: "linear", rotation: 0, color2: "#ffffff" };
    const doc = await combined();
    const text = doc.querySelector("text");
    expect(text.getAttribute("fill")).toBe("#112233");
    expect(text.getAttribute("stroke")).toBeNull();
  });

  it("never outlines text painted by a gradient", () => {
    baseState();
    state.generator.frameGradient = { type: "linear", rotation: 0, color2: "#ffffff" };
    state.generator.frameTextGradient = { type: "radial", rotation: 0, color2: "#00ff00" };
    expect(frameTextOutline("url(#qr-frame-text-grad)", framesConfig.label)).toBe("");
  });
});

describe("frame label fitting", () => {
  it("scales the label font size from the percent value", async () => {
    baseState();
    state.generator.frameTextSize = 60;
    const doc = await combined();
    const text = doc.querySelector("text");
    expect(Number(text.getAttribute("font-size"))).toBeCloseTo(framesConfig.label.textArea.size * 0.6, 5);
  });

  it("clamps a long large label to the bar width", async () => {
    baseState();
    state.generator.frameText = "WWWWWWWWWWWWWWW";
    state.generator.frameTextSize = 170;
    const doc = await combined();
    const text = doc.querySelector("text");
    expect(text.getAttribute("textLength")).toBe("18.5");
    expect(text.getAttribute("lengthAdjust")).toBe("spacingAndGlyphs");
    expect(Number(text.getAttribute("font-size"))).toBeCloseTo(framesConfig.label.textArea.size * 1.7, 5);
  });

  it("clamps a long label on an open frame to the card width", async () => {
    baseState();
    state.generator.frameStyle = "scan";
    state.generator.frameText = "WWWWWWWWWWWWWWW";
    state.generator.frameTextSize = 170;
    const doc = await combined();
    const text = doc.querySelector("text");
    expect(text.getAttribute("textLength")).toBe("22");
  });

  it("accounts for wide glyphs so CJK labels cannot overflow the bar", async () => {
    baseState();
    state.generator.frameText = "二维码工作室二维码工作室";
    state.generator.frameTextSize = 170;
    const doc = await combined();
    const text = doc.querySelector("text");
    expect(text.getAttribute("textLength")).toBe("18.5");
  });

  it("leaves short labels unstretched", async () => {
    baseState();
    state.generator.frameText = "Hi";
    const doc = await combined();
    const text = doc.querySelector("text");
    expect(text.getAttribute("textLength")).toBeNull();
    expect(text.getAttribute("lengthAdjust")).toBeNull();
  });

  it("escapes markup in the label", async () => {
    baseState();
    state.generator.frameText = '<b>&"';
    const doc = await combined();
    const text = doc.querySelector("text");
    expect(text.textContent).toBe('<b>&"');
    expect(text.querySelector("b")).toBeNull();
  });
});

describe("frame label position", () => {
  it("centres labels on the frame's text area", async () => {
    baseState();
    const doc = await combined();
    const text = doc.querySelector("text");
    expect(text.getAttribute("x")).toBe("12");
    expect(text.getAttribute("text-anchor")).toBe("middle");
  });

  it("keeps a linear text gradient centred on the text area", async () => {
    baseState();
    state.generator.frameTextGradient = { type: "linear", rotation: 0, color2: "#00ff00" };
    const doc = await combined();
    const gradient = doc.querySelector("#qr-frame-text-grad");
    const x1 = Number(gradient.getAttribute("x1"));
    const x2 = Number(gradient.getAttribute("x2"));
    expect((x1 + x2) / 2).toBeCloseTo(12, 5);
  });

  it("keeps a radial text gradient centred on the text area", async () => {
    baseState();
    state.generator.frameTextGradient = { type: "radial", rotation: 0, color2: "#00ff00" };
    const doc = await combined();
    expect(doc.querySelector("#qr-frame-text-grad").getAttribute("cx")).toBe("12");
  });
});

describe("frame text toggle", () => {
  it("renders no text band at all when the toggle is off", async () => {
    baseState();
    state.generator.frameTextEnabled = false;
    const doc = await combined();
    expect(doc.querySelector("text")).toBeNull();
    expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 24 24");
    // The label's bar disappears with the text, leaving the plain frame.
    expect(doc.querySelector('rect[y="22.6"]')).toBeNull();
    const nested = doc.querySelector("svg > svg");
    expect(nested.getAttribute("y")).toBe("4");
    expect(nested.getAttribute("height")).toBe("16");
  });

  it("collapses the text band when the text is empty even while enabled", async () => {
    baseState();
    state.generator.frameText = "";
    state.generator.frameTextEnabled = true;
    const doc = await combined();
    expect(doc.querySelector("text")).toBeNull();
    expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(doc.querySelector('rect[y="22.6"]')).toBeNull();
  });

  it("keeps the 28-unit band and the bar while the text is on", async () => {
    baseState();
    const doc = await combined();
    expect(doc.querySelector("text").textContent).toBe("Scan me!");
    expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 24 28");
    expect(doc.querySelector('rect[y="22.6"]')).not.toBeNull();
  });

  it("drops the badge's top bar and re-centres the QR when text is off", async () => {
    baseState();
    state.generator.frameStyle = "badge";
    state.generator.frameTextEnabled = false;
    const doc = await combined();
    expect(doc.querySelector("text")).toBeNull();
    expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(doc.querySelector('rect[y="1.2"]')).toBeNull();
    const nested = doc.querySelector("svg > svg");
    expect(nested.getAttribute("y")).toBe("4");
    expect(nested.getAttribute("height")).toBe("16");
  });

  it("never renders text-gradient defs when the text is off", async () => {
    baseState();
    state.generator.frameTextEnabled = false;
    state.generator.frameTextGradient = { type: "radial", rotation: 0, color2: "#00ff00" };
    const doc = await combined();
    expect(doc.querySelector("#qr-frame-text-grad")).toBeNull();
  });
});

describe("frame label fonts", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  });

  it("renders a newly added hosted family in the label", async () => {
    baseState();
    state.generator.frameStyle = "scan";
    state.generator.frameFont = "anton";
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    const doc = await combined();
    const text = doc.querySelector("text");
    expect(text.getAttribute("font-family")).toContain("Anton");
  });
});
