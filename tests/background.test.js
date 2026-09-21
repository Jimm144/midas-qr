import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyBackgroundImage } from "./helpers/svg-doc.js";
import { state } from "../src/js/state";
import { encodeStateToUrl, decodeStateFromUrl } from "../src/js/share.js";

const BG_IMAGE = "data:image/png;base64,AAAA";
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
  '<defs><clipPath id="clip-path-background-color-0"><rect x="0" y="0" width="300" height="300"/></clipPath></defs>' +
  '<rect x="0" y="0" width="300" height="300" fill="#000000" clip-path="url(#clip-path-background-color-0)"/>' +
  '<rect x="0" y="0" width="300" height="300" fill="#ffffff" clip-path="url(#clip-path-dot-color-0)"/>' +
  '<g id="qr-content"><rect x="0" y="0" width="10" height="10" fill="#ffffff"/></g>' +
  "</svg>";

describe("applyBackgroundImage", () => {
  const initial = { ...state.generator };

  beforeEach(() => {
    state.generator.bgImageDataUrl = null;
  });

  afterEach(() => {
    Object.assign(state.generator, initial);
  });

  it("is a no-op without a background image", () => {
    expect(applyBackgroundImage(SVG, 300, 300)).toBe(SVG);
  });

  it("inserts one cover-fit image right after the background rect", () => {
    state.generator.bgImageDataUrl = BG_IMAGE;
    const out = applyBackgroundImage(SVG, 300, 300);

    expect(out).not.toBe(SVG);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const images = doc.querySelectorAll("image");
    expect(images).toHaveLength(1);

    const image = images[0];
    expect(image.getAttribute("href")).toBe(BG_IMAGE);
    expect(image.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe(BG_IMAGE);
    expect(image.getAttribute("x")).toBe("0");
    expect(image.getAttribute("y")).toBe("0");
    expect(image.getAttribute("width")).toBe("300");
    expect(image.getAttribute("height")).toBe("300");
    expect(image.getAttribute("preserveAspectRatio")).toBe("xMidYMid slice");

    const children = [...doc.documentElement.children];
    const rectIdx = children.findIndex((el) => el.tagName === "rect");
    const imageIdx = children.findIndex((el) => el.tagName === "image");
    expect(imageIdx).toBe(rectIdx + 1);
    expect(children[imageIdx + 1].tagName).toBe("rect");
    expect(doc.querySelector("defs image")).toBeNull();
  });

  it("skips a stray first rect and anchors the image to the canvas background", () => {
    state.generator.bgImageDataUrl = BG_IMAGE;
    const stray =
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
      '<rect x="10" y="10" width="50" height="50" fill="#ff0000"/>' +
      '<rect x="0" y="0" width="300" height="300" fill="#ffffff"/>' +
      '<g id="qr-content"><rect x="0" y="0" width="10" height="10" fill="#000000"/></g>' +
      "</svg>";
    const out = applyBackgroundImage(stray, 300, 300);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    expect([...doc.documentElement.children].map((el) => el.tagName)).toEqual([
      "rect",
      "rect",
      "image",
      "rect",
      "g",
    ]);
  });

  it("is a no-op on a broken SVG", () => {
    state.generator.bgImageDataUrl = BG_IMAGE;
    const broken = "<svg><broken";
    expect(applyBackgroundImage(broken, 300, 300)).toBe(broken);
  });

  it("targets the nested QR svg for framed output", () => {
    state.generator.bgImageDataUrl = BG_IMAGE;
    const framed =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 26" width="288" height="312">' +
      '<g fill="none"><path d="M1 1h22v24H1z"/></g>' +
      '<svg x="4" y="4" width="16" height="16" overflow="visible">' +
      '<defs><clipPath id="c"><rect width="16" height="16"/></clipPath></defs>' +
      '<rect x="0" y="0" width="16" height="16" fill="#000000"/>' +
      "</svg>" +
      "</svg>";
    const out = applyBackgroundImage(framed, 300, 300);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const nested = doc.documentElement.querySelector("svg");
    expect(nested.querySelectorAll("image")).toHaveLength(1);
    expect(nested.querySelector("image").getAttribute("href")).toBe(BG_IMAGE);
    expect([...doc.documentElement.children].some((el) => el.tagName === "image")).toBe(false);
  });

  it("places the image above the mask silhouette and clips it to that shape", () => {
    state.generator.maskType = "circle";
    state.generator.bgImageDataUrl = BG_IMAGE;
    const masked =
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
      '<defs><clipPath id="clip-path-dot-color-0"><rect x="0" y="0" width="300" height="300"/></clipPath></defs>' +
      '<circle cx="150" cy="150" r="146" fill="#ffffff"/>' +
      '<g id="qr-content"><rect x="0" y="0" width="10" height="10" fill="#000000"/></g>' +
      "</svg>";
    const out = applyBackgroundImage(masked, 300, 300);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");

    const children = [...doc.documentElement.children];
    const tags = children.map((el) => el.tagName);
    const circleIdx = tags.indexOf("circle");
    const imageIdx = tags.indexOf("image");
    const scrimIdx = children.findIndex((el) => el.tagName === "rect" && el.hasAttribute("fill-opacity"));
    const contentIdx = children.findIndex((el) => el.getAttribute("id") === "qr-content");
    expect(circleIdx).toBeGreaterThanOrEqual(0);
    // Silhouette -> image -> scrim -> code: the image is no longer hidden
    // behind the opaque silhouette or drawn over the code.
    expect(imageIdx).toBe(circleIdx + 1);
    expect(scrimIdx).toBe(imageIdx + 1);
    expect(contentIdx).toBeGreaterThan(scrimIdx);

    const image = children[imageIdx];
    const scrim = children[scrimIdx];
    expect(image.getAttribute("clip-path")).toBe("url(#qr-bg-image-mask-clip)");
    expect(scrim.getAttribute("clip-path")).toBe("url(#qr-bg-image-mask-clip)");
    const clip = doc.querySelector("#qr-bg-image-mask-clip");
    expect(clip.querySelector("circle").getAttribute("r")).toBe("146");
  });

  it("clips the image to a nested mask for framed output", () => {
    state.generator.maskType = "circle";
    state.generator.bgImageDataUrl = BG_IMAGE;
    const framed =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 26" width="288" height="312">' +
      '<svg x="4" y="4" width="16" height="16" overflow="visible">' +
      '<defs><clipPath id="c"><rect width="16" height="16"/></clipPath></defs>' +
      '<circle cx="150" cy="150" r="146" fill="#ffffff"/>' +
      '<g id="qr-content"><rect x="0" y="0" width="10" height="10" fill="#000000"/></g>' +
      "</svg>" +
      "</svg>";
    const out = applyBackgroundImage(framed, 300, 300);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const nested = doc.documentElement.querySelector("svg");
    const image = nested.querySelector("image");
    expect(image).toBeTruthy();
    expect(image.getAttribute("clip-path")).toBe("url(#qr-bg-image-mask-clip)");
    expect(nested.querySelector("defs").querySelector("#qr-bg-image-mask-clip")).toBeTruthy();
  });

  it("inserts the image inside the radius clip group so rounded corners stay clean", () => {
    state.generator.maskType = "none";
    state.generator.bgImageDataUrl = BG_IMAGE;
    const rounded =
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
      '<defs><clipPath id="qr-canvas-radius-clip"><rect x="0" y="0" width="300" height="300" rx="13"/></clipPath></defs>' +
      '<rect x="0" y="0" width="300" height="300" rx="13" fill="#ffffff"/>' +
      '<g clip-path="url(#qr-canvas-radius-clip)"><rect x="4" y="4" width="292" height="292" fill="#000000"/></g>' +
      "</svg>";
    const out = applyBackgroundImage(rounded, 300, 300);
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const group = [...doc.documentElement.children].find((el) => el.tagName === "g");
    const inner = [...group.children];
    expect(inner[0].tagName).toBe("image");
    expect(inner[1].tagName).toBe("rect");
    expect(inner[1].getAttribute("fill-opacity")).toBe("0.78");
    expect(inner[2].tagName).toBe("rect");
    expect(inner[2].getAttribute("fill")).toBe("#000000");
    // The visible background rect stays outside the group.
    const directRects = [...doc.documentElement.children].filter((el) => el.tagName === "rect");
    expect(directRects).toHaveLength(1);
    expect(directRects[0].getAttribute("rx")).toBe("13");
  });
});

describe("bgImage share round-trip", () => {
  beforeEach(() => {
    state.generator.dataType = "url";
    state.generator.dataString = "";
    state.generator.bgImageDataUrl = null;
  });

  afterEach(() => {
    state.generator.bgImageDataUrl = null;
    window.history.replaceState({}, "", window.location.pathname);
  });

  it("encodes a small safe bitmap and decodes it back", () => {
    state.generator.bgImageDataUrl = BG_IMAGE;
    const url = encodeStateToUrl();
    expect(url).toContain("bgImage=");

    window.history.replaceState({}, "", new URL(url).hash);
    expect(decodeStateFromUrl()).toBe(true);
    expect(state.generator.bgImageDataUrl).toBe(BG_IMAGE);
  });

  it("refuses to encode a non-bitmap data URL", () => {
    state.generator.bgImageDataUrl = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    expect(encodeStateToUrl()).not.toContain("bgImage=");
  });

  it("rejects an SVG data URL on decode", () => {
    const svg = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    window.history.replaceState({}, "", "?bgImage=" + encodeURIComponent(svg));
    decodeStateFromUrl();
    expect(state.generator.bgImageDataUrl).toBe(null);
  });
});
