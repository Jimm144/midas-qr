import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openModal, closeModal } from "../src/js/ui/modal.js";

describe("modal focus trap", () => {
  let modal;
  let trigger;

  beforeEach(() => {
    modal = document.createElement("div");
    modal.id = "test-modal";
    modal.className = "hidden";
    modal.innerHTML = `
      <button id="modal-btn-a">A</button>
      <input id="modal-input-b" />
      <button id="modal-btn-c">C</button>
    `;
    document.body.appendChild(modal);
    trigger = document.createElement("button");
    trigger.id = "test-trigger";
    document.body.appendChild(trigger);
  });

  afterEach(() => {
    modal.remove();
    trigger.remove();
  });

  it("openModal removes the `hidden` class", () => {
    openModal(modal, trigger);
    expect(modal.classList.contains("hidden")).toBe(false);
  });

  it("closeModal re-adds the `hidden` class", () => {
    openModal(modal, trigger);
    closeModal(modal);
    expect(modal.classList.contains("hidden")).toBe(true);
  });

  it("openModal moves focus to the first focusable element", () => {
    openModal(modal, trigger);
    expect(document.activeElement?.id).toBe("modal-btn-a");
  });

  it("closeModal restores focus to the trigger element", () => {
    trigger.focus();
    openModal(modal, trigger);
    closeModal(modal);
    expect(document.activeElement).toBe(trigger);
  });

  it("openModal is a no-op when called with a missing modal", () => {
    expect(() => openModal(null, trigger)).not.toThrow();
  });
});

describe("modal trap stack — nested modals", () => {
  let modalA;
  let modalB;
  let trigger;

  beforeEach(() => {
    modalA = document.createElement("div");
    modalA.className = "hidden";
    modalA.innerHTML = `
      <button id="modal-a-first">A1</button>
      <button id="modal-a-last">A2</button>
    `;
    modalB = document.createElement("div");
    modalB.className = "hidden";
    modalB.innerHTML = `<button id="modal-b-first">B1</button>`;
    document.body.append(modalA, modalB);
    trigger = document.createElement("button");
    trigger.id = "nested-trigger";
    document.body.appendChild(trigger);
  });

  afterEach(() => {
    closeModal(modalA);
    closeModal(modalB);
    modalA.remove();
    modalB.remove();
    trigger.remove();
  });

  it("closing the top modal restores focus to the lower modal's first focusable", () => {
    openModal(modalA, trigger);
    expect(document.activeElement?.id).toBe("modal-a-first");
    openModal(modalB, modalA);
    expect(document.activeElement?.id).toBe("modal-b-first");
    closeModal(modalB);
    expect(document.activeElement?.id).toBe("modal-a-first");
  });

  it("the lower modal's trap still wraps focus after the top modal closes", () => {
    openModal(modalA, trigger);
    openModal(modalB, modalA);
    closeModal(modalB);
    const last = modalA.querySelector("#modal-a-last");
    last.focus();
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement?.id).toBe("modal-a-first");
  });

  it("Escape closes only the top-most dialog and restores its opener", () => {
    openModal(modalA, trigger);
    openModal(modalB, modalA);
    modalB.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(modalB.classList.contains("hidden")).toBe(true);
    expect(modalA.classList.contains("hidden")).toBe(false);
    expect(document.activeElement?.id).toBe("modal-a-first");
  });
});

describe("modal a11y semantics and focus fallbacks", () => {
  let modal;
  let trigger;

  beforeEach(() => {
    document.body.innerHTML = "";
    modal = document.createElement("div");
    modal.id = "a11y-modal";
    modal.className = "hidden";
    document.body.appendChild(modal);
    trigger = document.createElement("button");
    trigger.id = "a11y-trigger";
    trigger.textContent = "open";
    document.body.appendChild(trigger);
  });

  afterEach(() => {
    closeModal(modal);
    modal.remove();
    trigger.remove();
  });

  it("moves focus into a dialog that has no focusable content", () => {
    modal.textContent = "Only text";
    openModal(modal, trigger);
    expect(document.activeElement).toBe(modal);
    expect(modal.getAttribute("tabindex")).toBe("-1");

    closeModal(modal);
    expect(modal.hasAttribute("tabindex")).toBe(false);
  });

  it("Shift+Tab from the first focusable wraps to the last", () => {
    modal.innerHTML = '<button id="a11y-first">A</button><button id="a11y-last">B</button>';
    openModal(modal, trigger);
    const first = modal.querySelector("#a11y-first");
    const last = modal.querySelector("#a11y-last");
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(last);
  });

  it("does not strand focus inside the dialog when opened without a restorable trigger", () => {
    modal.innerHTML = '<button id="a11y-ok">OK</button>';
    openModal(modal, document.body);
    expect(document.activeElement).toBe(modal.querySelector("#a11y-ok"));

    closeModal(modal);
    expect(modal.classList.contains("hidden")).toBe(true);
    expect(modal.contains(document.activeElement)).toBe(false);
  });

  it("does not throw when the opener was removed while the dialog was open", () => {
    modal.innerHTML = '<button id="a11y-ok">OK</button>';
    trigger.remove();
    openModal(modal, trigger);
    expect(() => closeModal(modal)).not.toThrow();
    expect(modal.classList.contains("hidden")).toBe(true);
  });

  it("honours data-modal-role and data-modal-label", () => {
    modal.setAttribute("data-modal-role", "alertdialog");
    modal.innerHTML =
      '<span id="a11y-msg" data-modal-label>Something went wrong</span><button id="a11y-dismiss">OK</button>';
    openModal(modal, trigger);
    expect(modal.getAttribute("role")).toBe("alertdialog");
    expect(modal.getAttribute("aria-labelledby")).toBe("a11y-msg");

    closeModal(modal);
    expect(modal.hasAttribute("role")).toBe(false);
    expect(modal.hasAttribute("aria-labelledby")).toBe(false);
  });
});
