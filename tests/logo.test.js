import { describe, it, expect, afterEach } from "vitest";
import { applyLogoToDoc } from "../src/js/generator/logo.js";
import { state } from "../src/js/state";

const LOGO = "data:image/png;base64,BBBB";

const svgWith = (extra = "") =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
  extra +
  '<g id="qr-content"><rect x="0" y="0" width="10" height="10" fill="#000000"/></g>' +
  "</svg>";

const initial = { ...state.generator };

afterEach(() => {
  Object.assign(state.generator, initial);
});

function setup(overrides = {}) {
  state.generator.logoDataUrl = LOGO;
  state.generator.logoSizeProportion = 0.4;
  state.generator.imageMargin = 0;
  state.generator.bgColor = "#ffffff";
  state.generator.bgTransparent = false;
  state.generator.maskType = "none";
  Object.assign(state.generator, overrides);
}

describe("applyLogoToDoc", () => {
  it("adds one centered overlay clipped to the canvas", () => {
    setup();
    const doc = new DOMParser().parseFromString(svgWith(), "image/svg+xml");
    expect(applyLogoToDoc(doc, 300, 300)).toBe(true);
    const group = doc.querySelector(".qr-logo-overlay");
    expect(group).toBeTruthy();
    expect(group.getAttribute("clip-path")).toBe("url(#qr-logo-canvas-clip)");

    const clip = doc.querySelector("#qr-logo-canvas-clip rect");
    expect(clip.getAttribute("width")).toBe("300");
    expect(clip.getAttribute("height")).toBe("300");

    // No backing plate at image margin 0: a transparent logo must not gain a
    // background the user never asked for.
    expect(group.querySelector(".qr-logo-backing")).toBeNull();

    const image = group.querySelector(".qr-logo-image");
    expect(image.getAttribute("href")).toBe(LOGO);
    expect(image.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe(LOGO);
    expect(image.getAttribute("x")).toBe("90");
    expect(image.getAttribute("width")).toBe("120");
  });

  it("paints a padded backing plate once an image margin is set", () => {
    setup({ imageMargin: 8 });
    const doc = new DOMParser().parseFromString(svgWith(), "image/svg+xml");
    applyLogoToDoc(doc, 300, 300);
    const backing = doc.querySelector(".qr-logo-backing");
    expect(backing.getAttribute("x")).toBe("82");
    expect(backing.getAttribute("y")).toBe("82");
    expect(backing.getAttribute("width")).toBe("136");
    expect(backing.getAttribute("height")).toBe("136");
    expect(backing.getAttribute("fill")).toBe("#ffffff");
    // The plate must sit behind the image, not replace it.
    const children = [...doc.querySelector(".qr-logo-overlay").children];
    expect(children[0].getAttribute("class")).toBe("qr-logo-backing");
    expect(children[1].getAttribute("class")).toBe("qr-logo-image");
  });

  it("caps the plate so an oversized margin cannot swallow the code", () => {
    // imageMargin accepts up to 100px. Uncapped, a 0.1 logo on a 300px code
    // produced a 231px plate — most of the code, and nothing left to scan.
    setup({ logoSizeProportion: 0.1, imageMargin: 100 });
    const doc = new DOMParser().parseFromString(svgWith(), "image/svg+xml");
    applyLogoToDoc(doc, 300, 300);
    const backing = doc.querySelector(".qr-logo-backing");
    const size = Number(backing.getAttribute("width"));
    expect(size).toBeLessThanOrEqual(300 * 0.5);
    // Half the canvas, centred: 75..225.
    expect(backing.getAttribute("x")).toBe("75");
    expect(size).toBe(150);
  });

  it("follows the code when a mask shifts it inside the canvas", () => {
    setup({ maskType: "triangle", logoSizeProportion: 0.4 });
    const doc = new DOMParser().parseFromString(
      svgWith('<g class="qr-mask-content" data-qr-dx="4" data-qr-dy="-6"><rect/></g>'),
      "image/svg+xml"
    );
    applyLogoToDoc(doc, 300, 300);
    const image = doc.querySelector(".qr-logo-image");
    // Canvas centre 90,90 plus the mask's translate(4,-6).
    expect(image.getAttribute("x")).toBe("94");
    expect(image.getAttribute("y")).toBe("84");
  });

  it("clips the overlay to the mask silhouette when one is active", () => {
    setup({ maskType: "circle" });
    const doc = new DOMParser().parseFromString(
      svgWith('<circle cx="150" cy="150" r="146" fill="#ffffff"/>'),
      "image/svg+xml"
    );
    applyLogoToDoc(doc, 300, 300);
    const group = doc.querySelector(".qr-logo-overlay");
    expect(group.getAttribute("clip-path")).toBe("url(#qr-logo-mask-clip)");
    expect(doc.querySelector("#qr-logo-mask-clip circle").getAttribute("r")).toBe("146");
    expect(doc.querySelector("#qr-logo-canvas-clip")).toBeNull();
  });

  it("clamps the logo proportion to the supported range", () => {
    setup({ logoSizeProportion: 99 });
    let doc = new DOMParser().parseFromString(svgWith(), "image/svg+xml");
    applyLogoToDoc(doc, 300, 300);
    expect(doc.querySelector(".qr-logo-image").getAttribute("width")).toBe("150");

    setup({ logoSizeProportion: 0.01 });
    doc = new DOMParser().parseFromString(svgWith(), "image/svg+xml");
    applyLogoToDoc(doc, 300, 300);
    expect(doc.querySelector(".qr-logo-image").getAttribute("width")).toBe("30");
  });

  it("never leaves duplicate overlays behind", () => {
    setup();
    const doc = new DOMParser().parseFromString(svgWith(), "image/svg+xml");
    applyLogoToDoc(doc, 300, 300);
    applyLogoToDoc(doc, 300, 300);
    expect(doc.querySelectorAll(".qr-logo-overlay")).toHaveLength(1);
  });

  it("targets the nested QR svg for framed output", () => {
    setup();
    const framed =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 26" width="288" height="312">' +
      '<svg x="4" y="4" width="16" height="16" overflow="visible">' +
      svgWith() +
      "</svg>" +
      "</svg>";
    const doc = new DOMParser().parseFromString(framed, "image/svg+xml");
    applyLogoToDoc(doc, 300, 300);
    const nested = doc.documentElement.querySelector("svg");
    expect(nested.querySelectorAll(".qr-logo-overlay")).toHaveLength(1);
    expect([...doc.documentElement.children].some((el) => el.classList?.contains("qr-logo-overlay"))).toBe(
      false
    );
  });
});
