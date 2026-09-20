import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initCustomSelect, initCustomSelects, refreshCustomSelect } from "../src/js/ui/components.js";

const CAMERA_WRAPPER = `
  <div class="custom-select-wrapper">
    <div class="custom-select-trigger" tabindex="0"></div>
    <div class="custom-select-options">
      <div class="custom-select-option selected" data-index="0">Front</div>
      <div class="custom-select-option" data-index="1">Back</div>
    </div>
    <select id="camera-select" aria-label="Camera">
      <option value="user" selected>Front</option>
      <option value="environment">Back</option>
    </select>
  </div>`;

describe("custom select refresh", () => {
  const wrapper = () => document.querySelector(".custom-select-wrapper");
  const trigger = () => wrapper().querySelector(".custom-select-trigger");
  const select = () => wrapper().querySelector("select");
  const options = () => Array.from(wrapper().querySelectorAll(".custom-select-options > *"));

  beforeEach(() => {
    document.body.innerHTML = CAMERA_WRAPPER;
    initCustomSelects();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("rebuilds trigger and option state after the native options change", () => {
    const sel = select();
    sel.innerHTML =
      '<option value="a">Alpha</option><option value="b">Beta</option><option value="c" disabled>Gamma</option>';
    sel.value = "b";

    refreshCustomSelect(sel);

    expect(trigger().textContent).toBe("Beta");
    const opts = options();
    expect(opts).toHaveLength(3);
    expect(opts.map((opt) => opt.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
    opts.forEach((opt, idx) => {
      expect(opt.getAttribute("data-index")).toBe(String(idx));
      expect(opt.getAttribute("role")).toBe("option");
    });
    expect(opts[0].getAttribute("aria-selected")).toBe("false");
    expect(opts[1].getAttribute("aria-selected")).toBe("true");
    expect(opts[2].getAttribute("aria-selected")).toBe("false");
    expect(opts[1].classList.contains("selected")).toBe(true);
    expect(opts[0].classList.contains("selected")).toBe(false);
  });

  it("keeps the generated option markup identical to the scanner rebuild", () => {
    const sel = select();
    sel.innerHTML = '<option value="a">Alpha</option><option value="b">Beta</option>';
    sel.value = "b";

    refreshCustomSelect(sel);

    const opts = options();
    expect(opts[0].className).toBe("custom-select-option text-xs font-bold");
    expect(opts[1].className).toBe("custom-select-option text-xs font-bold selected");
  });

  it("handles clicks on options created by the refresh", () => {
    const sel = select();
    const changes = [];
    sel.addEventListener("change", (e) => changes.push(e));
    sel.innerHTML = '<option value="a">Alpha</option><option value="b">Beta</option>';
    refreshCustomSelect(sel);

    options()[1].click();

    expect(sel.selectedIndex).toBe(1);
    expect(trigger().textContent).toBe("Beta");
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    expect(options()[0].getAttribute("aria-selected")).toBe("false");
    expect(wrapper().classList.contains("open")).toBe(false);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("change");
    expect(changes[0].target).toBe(sel);
    expect(changes[0].bubbles).toBe(false);
  });

  it("ignores clicks on disabled refreshed options", () => {
    const sel = select();
    const onChange = vi.fn();
    sel.addEventListener("change", onChange);
    sel.innerHTML = '<option value="a">Alpha</option><option value="b" disabled>Beta</option>';
    refreshCustomSelect(sel);

    options()[1].click();

    expect(sel.selectedIndex).toBe(0);
    expect(trigger().textContent).toBe("Alpha");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps keyboard navigation in step with refreshed options", () => {
    const sel = select();
    const changes = [];
    sel.addEventListener("change", (e) => changes.push(e));
    sel.innerHTML = '<option value="a">Alpha</option><option value="b">Beta</option>';
    refreshCustomSelect(sel);

    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    expect(sel.selectedIndex).toBe(1);
    expect(trigger().textContent).toBe("Beta");
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    expect(changes).toHaveLength(1);
    expect(changes[0].target).toBe(sel);
    expect(changes[0].bubbles).toBe(false);
  });

  it("reuses matching option nodes so icons survive a value-only change", () => {
    document.body.innerHTML = `
      <div class="custom-select-wrapper">
        <div class="custom-select-trigger" tabindex="0"></div>
        <div class="custom-select-options">
          <div class="custom-select-option selected" data-index="0"><span class="theme-dot"></span><span>Neutral</span></div>
          <div class="custom-select-option" data-index="1"><span class="theme-dot"></span><span>Stone</span></div>
        </div>
        <select id="theme-select" aria-label="Theme"><option>Neutral</option><option>Stone</option></select>
      </div>`;
    initCustomSelects();
    const firstOption = options()[0];

    select().value = "Stone";
    refreshCustomSelect(select());

    expect(options()[0]).toBe(firstOption);
    expect(options()[0].querySelector(".theme-dot")).not.toBeNull();
    expect(trigger().textContent).toBe("Stone");
    expect(options()[1].classList.contains("selected")).toBe(true);
  });

  it("stays silent for selects without a wrapper or without options", () => {
    expect(() => refreshCustomSelect(null)).not.toThrow();
    expect(() => refreshCustomSelect(undefined)).not.toThrow();
    const bare = document.createElement("select");
    bare.innerHTML = "<option>A</option>";
    expect(() => refreshCustomSelect(bare)).not.toThrow();

    document.body.innerHTML = `
      <div class="custom-select-wrapper">
        <div class="custom-select-trigger"></div>
        <select aria-label="No listbox"><option>A</option></select>
      </div>`;
    expect(() => refreshCustomSelect(document.querySelector("select"))).not.toThrow();
  });
});

describe("initCustomSelect", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("wires a single select and stays idempotent", () => {
    document.body.innerHTML = CAMERA_WRAPPER;
    const wrapper = document.querySelector(".custom-select-wrapper");
    const select = wrapper.querySelector("select");
    const trigger = wrapper.querySelector(".custom-select-trigger");

    initCustomSelect(select);
    initCustomSelect(select);

    expect(trigger.getAttribute("role")).toBe("combobox");
    expect(trigger.getAttribute("aria-controls")).toBe("camera-select-listbox");
    trigger.click();
    expect(wrapper.classList.contains("open")).toBe(true);
    trigger.click();
    expect(wrapper.classList.contains("open")).toBe(false);
  });
});
