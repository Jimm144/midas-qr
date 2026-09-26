import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// pwa.js wires up listeners at import time, so each test installs a fresh
// navigator.serviceWorker mock, resets the module registry, then dynamically
// imports it and fires the lifecycle events by hand.

function makeSwMock() {
  const regListeners = {};
  const containerListeners = {};
  const registration = {
    installing: null,
    addEventListener(type, fn) {
      (regListeners[type] ||= []).push(fn);
    },
    update: vi.fn(async () => {}),
  };
  const container = {
    controller: null,
    register: vi.fn(async () => registration),
    addEventListener(type, fn) {
      (containerListeners[type] ||= []).push(fn);
    },
  };
  return { container, registration, regListeners, containerListeners };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let originalSwDescriptor;
let btn;

beforeEach(() => {
  vi.resetModules();
  originalSwDescriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
  document.body.innerHTML = "";
  btn = document.createElement("button");
  btn.id = "btn-install";
  btn.className = "hidden";
  document.body.appendChild(btn);
  delete window.__qrInstallPrompt;
});

afterEach(() => {
  if (originalSwDescriptor) Object.defineProperty(navigator, "serviceWorker", originalSwDescriptor);
  else delete navigator.serviceWorker;
  delete window.__qrInstallPrompt;
});

async function boot(mock, { hadController = false } = {}) {
  mock.container.controller = hadController ? {} : null;
  Object.defineProperty(navigator, "serviceWorker", { value: mock.container, configurable: true });
  // Invoke only the fresh module's load listener. Dispatching a window "load"
  // event would also re-run listeners left behind by earlier module instances,
  // which then re-register against this test's mock and pollute it.
  const originalAdd = window.addEventListener.bind(window);
  let loadHandler = null;
  const addSpy = vi.spyOn(window, "addEventListener").mockImplementation((type, fn, options) => {
    if (type === "load") {
      loadHandler = fn;
      return;
    }
    originalAdd(type, fn, options);
  });
  let mod;
  try {
    mod = await import("../src/js/pwa.js");
  } finally {
    addSpy.mockRestore();
  }
  if (typeof loadHandler === "function") loadHandler(new Event("load"));
  await tick();
  return mod;
}

function installUpdate(mock) {
  const stateChangeHandlers = [];
  mock.registration.installing = {
    state: "installing",
    addEventListener(type, fn) {
      if (type === "statechange") stateChangeHandlers.push(fn);
    },
  };
  for (const fn of mock.regListeners.updatefound || []) fn();
  mock.registration.installing.state = "installed";
  for (const fn of stateChangeHandlers) fn();
}

describe("service worker update banner", () => {
  it("registers the worker with a fresh update check and re-checks on visibility", async () => {
    const mock = makeSwMock();
    await boot(mock);
    expect(mock.container.register).toHaveBeenCalledWith("sw.js", { scope: "./", updateViaCache: "none" });

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await tick();
    expect(mock.registration.update).toHaveBeenCalled();
  });

  it("re-checks for an update on the hourly timer", async () => {
    // Spying on setInterval rather than faking timers: boot() awaits a
    // real-timer tick, so fake timers deadlock the module under test.
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      const mock = makeSwMock();
      await boot(mock);
      const hourly = intervalSpy.mock.calls.find(([, delay]) => delay === 60 * 60 * 1000);
      expect(hourly, "an hourly update interval must be scheduled").toBeTruthy();

      const callsBefore = mock.registration.update.mock.calls.length;
      hourly[0]();
      expect(mock.registration.update.mock.calls.length).toBeGreaterThan(callsBefore);
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it("shows the banner when a new worker installs over an existing controller", async () => {
    const mock = makeSwMock();
    await boot(mock, { hadController: true });
    installUpdate(mock);
    expect(document.getElementById("sw-update-banner")).not.toBeNull();

    // A second notification must not stack another banner.
    installUpdate(mock);
    expect(document.querySelectorAll("#sw-update-banner").length).toBe(1);
  });

  it("stays silent for first-time visitors when clients.claim() takes over", async () => {
    const mock = makeSwMock();
    await boot(mock, { hadController: false });
    installUpdate(mock);
    expect(document.getElementById("sw-update-banner")).toBeNull();

    for (const fn of mock.containerListeners.controllerchange || []) fn();
    expect(document.getElementById("sw-update-banner")).toBeNull();
  });

  it("shows the banner when an update follows a first-visit clients.claim()", async () => {
    const mock = makeSwMock();
    await boot(mock, { hadController: false });

    // First install claims the tab: the tab becomes controlled, no banner.
    mock.container.controller = {};
    for (const fn of mock.containerListeners.controllerchange || []) fn();
    expect(document.getElementById("sw-update-banner")).toBeNull();

    // A later update must now surface the banner.
    installUpdate(mock);
    expect(document.getElementById("sw-update-banner")).not.toBeNull();
  });

  it("surfaces an update after an install that itself claimed a first-visit tab", async () => {
    const mock = makeSwMock();
    await boot(mock, { hadController: false });

    // clients.claim() races the statechange: the controller is already there
    // when the first install completes, so it is not an update.
    mock.container.controller = {};
    installUpdate(mock);
    expect(document.getElementById("sw-update-banner")).toBeNull();

    // The matching controllerchange must stay silent too.
    for (const fn of mock.containerListeners.controllerchange || []) fn();
    expect(document.getElementById("sw-update-banner")).toBeNull();

    // The next install is a real update.
    installUpdate(mock);
    expect(document.getElementById("sw-update-banner")).not.toBeNull();
  });

  it("shows the banner on controllerchange for an update, reload button included", async () => {
    const mock = makeSwMock();
    await boot(mock, { hadController: true });
    for (const fn of mock.containerListeners.controllerchange || []) fn();
    const banner = document.getElementById("sw-update-banner");
    expect(banner).not.toBeNull();
    expect(banner.querySelector("#sw-reload-btn")).not.toBeNull();
  });
});

describe("install prompt", () => {
  function fireInstallPrompt(outcome = "accepted") {
    const event = new Event("beforeinstallprompt");
    event.prompt = vi.fn();
    event.userChoice = Promise.resolve({ outcome });
    window.dispatchEvent(event);
    return event;
  }

  it("reveals the install button and consumes the single-use prompt exactly once", async () => {
    const mock = makeSwMock();
    const mod = await boot(mock);
    mod.initInstallButton();

    expect(btn.classList.contains("hidden")).toBe(true);
    const event = fireInstallPrompt();
    expect(btn.classList.contains("hidden")).toBe(false);
    expect(window.__qrInstallPrompt).toBe(event);

    btn.click();
    await tick();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(btn.classList.contains("hidden")).toBe(true);
    expect(window.__qrInstallPrompt).toBeNull();

    // The event can only be prompted once; a second click must not reuse it.
    btn.click();
    await tick();
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("hides the button and clears the stored prompt once the app is installed", async () => {
    const mock = makeSwMock();
    await boot(mock);
    fireInstallPrompt();
    expect(btn.classList.contains("hidden")).toBe(false);

    window.dispatchEvent(new Event("appinstalled"));
    expect(btn.classList.contains("hidden")).toBe(true);
    expect(window.__qrInstallPrompt).toBeNull();
  });
});
