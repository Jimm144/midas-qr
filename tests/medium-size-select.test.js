import { describe, it, expect, beforeEach } from "vitest";
import { DOM } from "../src/js/ui/dom.js";
import { state } from "../src/js/state";
import { syncMediumSizeSelect } from "../src/js/generator/generator.js";

const PRESETS = [
  [300, "Low (300px)"],
  [600, "Standard (600px)"],
  [1000, "High (1000px)"],
  [1500, "Very High (1500px)"],
  [2000, "Ultra (2000px)"],
];

function installSelect() {
  const wrapper = document.createElement("div");
  wrapper.className = "custom-select-wrapper";
  const trigger = document.createElement("div");
  trigger.className = "custom-select-trigger";
  const options = document.createElement("div");
  options.className = "custom-select-options";
  const select = document.createElement("select");
  select.id = "qr-size-medium";
  for (const [value, label] of PRESETS) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = label;
    select.appendChild(option);
  }
  wrapper.append(trigger, options, select);
  document.body.appendChild(wrapper);
  DOM.qrSizeMedium = select;
  return { select, trigger, options };
}

beforeEach(() => {
  document.body.innerHTML = "";
  delete DOM.qrSizeMedium;
  state.generator.width = 300;
});

describe("medium size select is preset-only", () => {
  it("selects the matching preset", () => {
    const { select, trigger } = installSelect();
    syncMediumSizeSelect(600);

    expect(select.value).toBe("600");
    expect(trigger.textContent).toBe("Standard (600px)");
  });

  it("shows the nearest preset for a custom width and never injects an option", () => {
    const { select, trigger } = installSelect();
    syncMediumSizeSelect(777);

    expect(select.querySelector("option[data-custom-size]")).toBeNull();
    expect(select.options).toHaveLength(PRESETS.length);
    expect(select.value).toBe("600");
    expect(trigger.textContent).toBe("Standard (600px)");
  });

  it("removes a leftover custom option from an older render", () => {
    const { select } = installSelect();
    const leftover = document.createElement("option");
    leftover.setAttribute("data-custom-size", "true");
    leftover.value = "777";
    leftover.textContent = "Custom (777px)";
    select.appendChild(leftover);

    syncMediumSizeSelect(300);

    expect(select.querySelector("option[data-custom-size]")).toBeNull();
    expect(select.value).toBe("300");
  });
});
