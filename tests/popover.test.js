import { describe, it, expect, vi, afterEach } from "vitest";
import { openPopover, closePopover, isTopPopover } from "../src/js/ui/popover.js";

/** Build a root + trigger pair appended to the body. */
function buildPopover() {
  const root = document.createElement("div");
  const anchor = document.createElement("button");
  anchor.type = "button";
  document.body.append(root, anchor);
  return { root, anchor };
}

describe("popover dismissal seam", () => {
  /** @type {HTMLElement[]} */
  const opened = [];

  /** Register `root` through the public interface and track it for cleanup. */
  const register = (root, options) => {
    opened.push(root);
    openPopover({ root, ...options });
  };

  afterEach(() => {
    opened.forEach((root) => closePopover(root));
    opened.length = 0;
    document.body.innerHTML = "";
  });

  it("outside click closes only the registered top popover", () => {
    const lower = buildPopover();
    const top = buildPopover();
    const closeLower = vi.fn(() => closePopover(lower.root));
    const closeTop = vi.fn(() => closePopover(top.root));
    register(lower.root, { anchor: lower.anchor, onCancel: closeLower });
    register(top.root, { anchor: top.anchor, onCancel: closeTop });

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeLower).not.toHaveBeenCalled();
    expect(isTopPopover(lower.root)).toBe(true);
  });

  it("keeps the popover open for clicks inside its root or anchor", () => {
    const { root, anchor } = buildPopover();
    const onCancel = vi.fn();
    register(root, { anchor, onCancel });

    root.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(isTopPopover(root)).toBe(true);
  });

  it("lets an outside click use a different callback than Escape", () => {
    const { root, anchor } = buildPopover();
    const onCancel = vi.fn();
    const onOutsideClick = vi.fn();
    register(root, { anchor, onCancel, onOutsideClick });

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onOutsideClick).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape closes only the top popover, then the lower one takes over", () => {
    const lower = buildPopover();
    const top = buildPopover();
    const closeLower = vi.fn(() => closePopover(lower.root));
    const closeTop = vi.fn(() => closePopover(top.root));
    register(lower.root, { anchor: lower.anchor, onCancel: closeLower });
    register(top.root, { anchor: top.anchor, onCancel: closeTop });

    top.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeLower).not.toHaveBeenCalled();
    expect(isTopPopover(lower.root)).toBe(true);

    lower.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(closeLower).toHaveBeenCalledTimes(1);
  });

  it("stops Escape from reaching document listeners while a popover handles it", () => {
    const { root, anchor } = buildPopover();
    register(root, { anchor, onCancel: vi.fn(() => closePopover(root)) });
    const onDocumentEscape = vi.fn();
    document.addEventListener("keydown", onDocumentEscape);

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onDocumentEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onDocumentEscape);
  });

  it("closing the top leaves the lower popover registered and dismissible", () => {
    const lower = buildPopover();
    const top = buildPopover();
    const closeLower = vi.fn(() => closePopover(lower.root));
    register(lower.root, { anchor: lower.anchor, onCancel: closeLower });
    register(top.root, { anchor: top.anchor, onCancel: vi.fn() });

    closePopover(top.root);

    expect(isTopPopover(top.root)).toBe(false);
    expect(isTopPopover(lower.root)).toBe(true);

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(closeLower).toHaveBeenCalledTimes(1);
  });

  it("outside click closes without moving focus", () => {
    const { root, anchor } = buildPopover();
    const field = document.createElement("input");
    document.body.appendChild(field);
    register(root, {
      anchor,
      onCancel: vi.fn(),
      onOutsideClick: () => closePopover(root),
      restoreFocus: anchor,
    });

    field.focus();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(isTopPopover(root)).toBe(false);
    expect(document.activeElement).toBe(field);
  });

  it("Escape closes and restores the remembered focus", () => {
    const { root, anchor } = buildPopover();
    const field = document.createElement("input");
    document.body.appendChild(field);
    register(root, {
      anchor,
      onCancel: () => closePopover(root),
      restoreFocus: anchor,
    });

    field.focus();
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(isTopPopover(root)).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });

  it("closePopover alone does not move focus", () => {
    const { root, anchor } = buildPopover();
    const field = document.createElement("input");
    document.body.appendChild(field);
    register(root, { anchor, onCancel: vi.fn(), restoreFocus: anchor });

    field.focus();
    closePopover(root);

    expect(document.activeElement).toBe(field);
  });

  it("re-registering the same root does not stack Escape handlers", () => {
    const { root, anchor } = buildPopover();
    const onCancel = vi.fn(() => closePopover(root));
    register(root, { anchor, onCancel });
    register(root, { anchor, onCancel });

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
