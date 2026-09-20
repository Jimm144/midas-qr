import { describe, it, expect, vi } from "vitest";
import { isTextEntryContext, shortcutActionFor } from "../src/js/ui/shell.js";

const keydown = (key, init = {}) => new KeyboardEvent("keydown", { cancelable: true, key, ...init });

const ctx = (overrides = {}) => ({
  activeTab: "generator",
  saveDisabled: false,
  copyDisabled: false,
  hasSelection: false,
  typing: false,
  ...overrides,
});

describe("isTextEntryContext", () => {
  it("recognizes inputs, textareas, selects and contenteditable hosts", () => {
    expect(isTextEntryContext(document.createElement("input"))).toBe(true);
    expect(isTextEntryContext(document.createElement("textarea"))).toBe(true);
    expect(isTextEntryContext(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isTextEntryContext(editable)).toBe(true);
    const notEditable = document.createElement("div");
    notEditable.setAttribute("contenteditable", "false");
    expect(isTextEntryContext(notEditable)).toBe(false);
  });

  it("does not treat buttons, links or null as text entry", () => {
    expect(isTextEntryContext(document.createElement("button"))).toBe(false);
    expect(isTextEntryContext(document.createElement("a"))).toBe(false);
    expect(isTextEntryContext(document.body)).toBe(false);
    expect(isTextEntryContext(null)).toBe(false);
  });
});

describe("shortcutActionFor", () => {
  it("maps Ctrl+S and Cmd+S to save on the generator tab", () => {
    expect(shortcutActionFor(keydown("s", { ctrlKey: true }), ctx())).toBe("save");
    expect(shortcutActionFor(keydown("s", { metaKey: true }), ctx())).toBe("save");
    expect(shortcutActionFor(keydown("S", { ctrlKey: true }), ctx())).toBe("save");
  });

  it("does not save when the button is disabled or another tab is active", () => {
    expect(shortcutActionFor(keydown("s", { ctrlKey: true }), ctx({ saveDisabled: true }))).toBeNull();
    expect(shortcutActionFor(keydown("s", { ctrlKey: true }), ctx({ activeTab: "scanner" }))).toBeNull();
  });

  it("maps Ctrl+C to copy only when nothing is being typed or selected", () => {
    expect(shortcutActionFor(keydown("c", { ctrlKey: true }), ctx())).toBe("copy");
    expect(shortcutActionFor(keydown("c", { ctrlKey: true }), ctx({ typing: true }))).toBeNull();
    expect(shortcutActionFor(keydown("c", { ctrlKey: true }), ctx({ hasSelection: true }))).toBeNull();
    expect(shortcutActionFor(keydown("c", { ctrlKey: true }), ctx({ copyDisabled: true }))).toBeNull();
    expect(shortcutActionFor(keydown("c", { ctrlKey: true }), ctx({ activeTab: "history" }))).toBeNull();
  });

  it("maps plain R to re-render on the generator tab while not typing", () => {
    expect(shortcutActionFor(keydown("r"), ctx())).toBe("rerender");
    expect(shortcutActionFor(keydown("R"), ctx())).toBe("rerender");
    expect(shortcutActionFor(keydown("r"), ctx({ typing: true }))).toBeNull();
    expect(shortcutActionFor(keydown("r"), ctx({ activeTab: "scanner" }))).toBeNull();
  });

  it("ignores repeated R, modifiers and already-handled events", () => {
    expect(shortcutActionFor(keydown("r", { repeat: true }), ctx())).toBeNull();
    expect(shortcutActionFor(keydown("r", { ctrlKey: true }), ctx())).toBeNull();
    expect(shortcutActionFor(keydown("r", { altKey: true }), ctx())).toBeNull();
    expect(shortcutActionFor(keydown("r", { shiftKey: true }), ctx())).toBeNull();
    const handled = keydown("s", { ctrlKey: true });
    handled.preventDefault();
    expect(shortcutActionFor(handled, ctx())).toBeNull();
  });

  it("only reads the selection thunk for Ctrl/Cmd+C", () => {
    const hasSelection = vi.fn(() => false);
    expect(shortcutActionFor(keydown("s", { ctrlKey: true }), ctx({ hasSelection }))).toBe("save");
    expect(shortcutActionFor(keydown("r"), ctx({ hasSelection }))).toBe("rerender");
    expect(shortcutActionFor(keydown("a"), ctx({ hasSelection }))).toBeNull();
    expect(hasSelection).not.toHaveBeenCalled();

    expect(shortcutActionFor(keydown("c", { ctrlKey: true }), ctx({ hasSelection }))).toBe("copy");
    expect(shortcutActionFor(keydown("c", { metaKey: true }), ctx({ hasSelection: () => true }))).toBeNull();
    // A typing context short-circuits before the selection is consulted.
    expect(shortcutActionFor(keydown("c", { ctrlKey: true }), ctx({ typing: true, hasSelection }))).toBeNull();
    expect(hasSelection).toHaveBeenCalledTimes(1);
  });

  it("leaves unrelated keys alone", () => {
    expect(shortcutActionFor(keydown("a"), ctx())).toBeNull();
    expect(shortcutActionFor(keydown("Escape"), ctx())).toBeNull();
    expect(shortcutActionFor(keydown("s"), ctx())).toBeNull();
  });
});
