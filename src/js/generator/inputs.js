/**
 * Data-input wiring for the generator: panel switching per data type, live
 * compile listeners and the per-type Generate buttons. Split out of main.js.
 */
import { DOM } from "../ui/dom.js";
import { state } from "../state";
import { compileDataString } from "./generator.js";
import { updateExportFilenamePlaceholder } from "./export.js";

const TYPE_TO_PANEL = {
  text: "inputContainerText",
  url: "inputContainerUrl",
  wifi: "inputContainerWifi",
  contact: "inputContainerContact",
  crypto: "inputContainerCrypto",
  geo: "inputContainerGeo",
  event: "inputContainerEvent",
  sms: "inputContainerSms",
  phone: "inputContainerPhone",
  email: "inputContainerEmail",
};

const INPUT_PANELS = Object.values(TYPE_TO_PANEL);

let dataInputPanelsReady = false;

/** Wire the data-type select to show/hide input panels and recompile the payload. */
export function initDataInputPanels() {
  if (dataInputPanelsReady || !DOM.dataType) return;
  dataInputPanelsReady = true;
  DOM.dataType.addEventListener("change", (e) => {
    state.generator.dataType = e.target.value;
    INPUT_PANELS.forEach((key) => {
      if (DOM[key]) DOM[key].classList.add("hidden");
    });
    const panelKey = TYPE_TO_PANEL[state.generator.dataType];
    if (panelKey && DOM[panelKey]) DOM[panelKey].classList.remove("hidden");
    updateExportFilenamePlaceholder();
    compileDataString();
  });
}

/** Helper: for live single-input containers (URL/SMS/Email), auto-generate. For structured forms with a Generate button, only compile on input and generate on button click or Enter. */
function wireContainerListeners(container, hasGenerateButton = false) {
  if (!container) return;
  container.addEventListener("focusout", (e) => {
    if (!container.contains(e.relatedTarget)) {
      compileDataString(!hasGenerateButton, true);
    }
  });
  container.addEventListener("input", () => {
    compileDataString(!hasGenerateButton, false);
  });
  if (hasGenerateButton) {
    container.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
        e.preventDefault();
        const genBtn = container.querySelector("button[id^='btn-generate-']");
        if (genBtn) genBtn.click();
        else compileDataString(true, true);
      }
    });
  }
}

let inputHandlersReady = false;

/** Wire all data-input listeners (text/url/wifi/contact/crypto/geo/event/sms/phone + password + wifi-hidden + generate buttons). */
export function initInputHandlers() {
  if (inputHandlersReady) return;
  inputHandlersReady = true;
  if (DOM.inputText) {
    DOM.inputText.addEventListener("blur", () => compileDataString(true, true));
    DOM.inputText.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey) compileDataString(true, true);
    });
    DOM.inputText.addEventListener("input", () => compileDataString(true, false));
  }

  [
    { c: DOM.inputContainerUrl, gen: false },
    { c: DOM.inputContainerSms, gen: false },
    { c: DOM.inputContainerEmail, gen: false },
    { c: DOM.inputContainerWifi, gen: true },
    { c: DOM.inputContainerContact, gen: true },
    { c: DOM.inputContainerCrypto, gen: true },
    { c: DOM.inputContainerGeo, gen: true },
    { c: DOM.inputContainerEvent, gen: true },
  ].forEach(({ c, gen }) => {
    if (c) wireContainerListeners(c, gen);
  });

  if (DOM.phoneNumber) {
    DOM.phoneNumber.addEventListener("blur", () => compileDataString(true, true));
    DOM.phoneNumber.addEventListener("keypress", (e) => {
      if (e.key === "Enter") compileDataString(true, true);
    });
    DOM.phoneNumber.addEventListener("input", () => compileDataString(true, false));
  }

  const btnTogglePass = document.getElementById("btn-toggle-pass");
  if (btnTogglePass) {
    // Static icons: resolve once instead of on every toggle click.
    const iconEye = document.getElementById("icon-eye");
    const iconEyeOff = document.getElementById("icon-eye-off");
    const syncTogglePassUI = () => {
      const isPass = DOM.wifiPass.type === "password";
      btnTogglePass.setAttribute("aria-pressed", isPass ? "false" : "true");
      btnTogglePass.style.opacity = isPass ? "0.7" : "1";
      if (iconEye && iconEyeOff) {
        iconEye.classList.toggle("hidden", !isPass);
        iconEyeOff.classList.toggle("hidden", isPass);
      }
    };
    syncTogglePassUI();
    btnTogglePass.addEventListener("click", () => {
      DOM.wifiPass.type = DOM.wifiPass.type === "password" ? "text" : "password";
      syncTogglePassUI();
    });
  }

  if (DOM.wifiEnc) {
    DOM.wifiEnc.addEventListener("change", () => {
      const isNoPass = DOM.wifiEnc.value === "nopass";
      DOM.wifiPass.disabled = isNoPass;
      DOM.wifiPass.classList.toggle("opacity-50", isNoPass);
      DOM.wifiPass.classList.toggle("pointer-events-none", isNoPass);
      if (btnTogglePass) {
        // The reveal toggle has nothing to reveal while the password field is
        // disabled; leave the tab order instead of acting like a live control.
        // Opacity is inline (see syncTogglePassUI) so it must be set here too.
        btnTogglePass.disabled = isNoPass;
        btnTogglePass.classList.toggle("pointer-events-none", isNoPass);
        btnTogglePass.style.opacity = isNoPass ? "0.3" : DOM.wifiPass.type === "password" ? "0.7" : "1";
      }
      compileDataString(false, false);
    });
  }

  if (DOM.wifiHidden) {
    DOM.wifiHidden.addEventListener("change", () => {
      compileDataString(false, false);
    });
  }

  [
    "btn-generate-wifi",
    "btn-generate-contact",
    "btn-generate-crypto",
    "btn-generate-geo",
    "btn-generate-event",
  ].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => compileDataString(true, true));
  });
}

/** Blank the four primary sample input containers on fresh load (kept for legacy parity). */
export function resetSampleForms() {
  ["input-container-text", "input-container-url", "input-container-wifi", "input-container-contact"].forEach(
    (id) => {
      const container = document.getElementById(id);
      if (container) {
        container.querySelectorAll("input, textarea").forEach((el) => {
          if (el.type === "checkbox") el.checked = false;
          else if (el.type !== "file") {
            if (el.id === "input-url") el.value = "https://example.com";
            else el.value = "";
          }
        });
      }
    }
  );
}
