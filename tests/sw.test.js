import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";

// Service-worker harness: sw.js is a classic script, so it is evaluated with
// injected worker globals (self/caches/fetch/Response/Request/Headers) and the
// install/activate/fetch events are dispatched by hand. This is the only place
// the offline-layer promises (fresh precache on CACHE_NAME bump, bounded
// runtime cache, offline navigation chain) are exercised as code.

const BASE = "https://app.test/";
const SW_SOURCE = fs.readFileSync("sw.js", "utf8");
const INDEX = fs.readFileSync("index.html", "utf8");

class MockHeaders {
  constructor(init = {}) {
    this.map = new Map(Object.entries(init).map(([k, v]) => [k.toLowerCase(), String(v)]));
  }
  get(name) {
    return this.map.get(String(name).toLowerCase());
  }
}

class MockResponse {
  constructor(body = "", init = {}) {
    this._body = body;
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.type = init.type || "basic";
    this.headers = new MockHeaders(init.headers || {});
  }
  clone() {
    return new MockResponse(this._body, { status: this.status, type: this.type });
  }
  text() {
    return Promise.resolve(String(this._body));
  }
}

class MockRequest {
  constructor(input, init = {}) {
    const source = typeof input === "string" ? { url: input } : input;
    this.url = new URL(source.url, BASE).href;
    this.method = init.method || source.method || "GET";
    this.mode = init.mode || source.mode || "cors";
    this.cache = init.cache || source.cache || "default";
  }
}

const normalize = (value) => (typeof value === "string" ? new URL(value, BASE).href : value.url).split("#")[0];

function setupHarness({ stores = new Map(), source = SW_SOURCE } = {}) {
  const listeners = { install: [], activate: [], fetch: [] };
  const network = { calls: [], resolve: null, handler: null };

  const makeCache = (name) => {
    const entries = new Map();
    return {
      name,
      entries,
      async addAll(requests) {
        for (const request of requests) {
          network.calls.push({ url: request.url, cache: request.cache });
          const response = await network.resolve(request.url);
          if (!response || !response.ok) throw new TypeError("addAll failed for " + request.url);
          entries.set(request.url, response);
        }
      },
      async put(request, response) {
        entries.set(normalize(request), response);
      },
      async match(request) {
        return entries.get(normalize(request));
      },
      async delete(request) {
        return entries.delete(normalize(request));
      },
      async keys() {
        return [...entries.keys()].map((url) => new MockRequest(url));
      },
    };
  };

  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, makeCache(name));
      return stores.get(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async match(request) {
      for (const store of stores.values()) {
        const hit = await store.match(request);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const self = {
    location: { origin: "https://app.test", href: BASE },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const skipWaitingCalls = [];
  const claimCalls = [];
  self.skipWaiting = async () => {
    skipWaitingCalls.push(true);
  };
  self.clients.claim = async () => {
    claimCalls.push(true);
  };

  const fetchMock = (request) => network.handler(request);

  // Default virtual network: serve precache files from disk.
  network.resolve = async (url) => {
    const rel = new URL(url).pathname.slice(1).split("?")[0];
    const file = rel === "" || rel === "index.html" ? "index.html" : rel;
    try {
      fs.statSync(file);
      return new MockResponse(file, { status: 200 });
    } catch {
      return new MockResponse("", { status: 404 });
    }
  };
  network.handler = async (request) => {
    const response = await network.resolve(request.url);
    return response;
  };

  const factory = new Function(
    "self",
    "caches",
    "fetch",
    "Response",
    "Request",
    "Headers",
    "URL",
    "console",
    `${source}\nreturn { CACHE_NAME, RUNTIME_CACHE_LIMIT, PRECACHE, isSameOrigin };`
  );
  const sw = factory(self, caches, fetchMock, MockResponse, MockRequest, MockHeaders, URL, console);

  const dispatch = (type, event) => {
    for (const fn of listeners[type] || []) fn(event);
  };
  const makeEvent = (request) => {
    const waits = [];
    let responsePromise = null;
    return {
      request,
      waits,
      waitUntil(promise) {
        waits.push(Promise.resolve(promise));
      },
      respondWith(promise) {
        responsePromise = Promise.resolve(promise);
      },
      get response() {
        return responsePromise;
      },
      get handled() {
        return responsePromise !== null;
      },
    };
  };
  const settle = async (event) => {
    const response = event.response ? await event.response : undefined;
    await Promise.allSettled(event.waits);
    return response;
  };

  return { stores, network, caches, self, sw, dispatch, makeEvent, settle, skipWaitingCalls, claimCalls, listeners };
}

describe("sw.js precache list", () => {
  const harness = setupHarness();

  it("includes every precache entry on disk and every local asset index.html requests", () => {
    for (const entry of harness.sw.PRECACHE) {
      const path = entry.replace(/\?.*$/, "");
      if (path === "./") continue;
      expect(fs.existsSync(path), `missing ${entry}`).toBe(true);
    }
    const refs = [
      ...new Set([
        ...[...INDEX.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]),
        ...[...INDEX.matchAll(/loadScript\('([^']+)'\)/g)].map((m) => m[1]),
      ]),
    ];
    for (const ref of refs) {
      if (/^(#|data:|https?:|mailto:|\/\/|javascript:)/i.test(ref)) continue;
      const exact = `./${ref}`;
      expect(harness.sw.PRECACHE, `${ref} must be precached`).toContain(exact);
    }
  });
});

describe("sw.js install", () => {
  let h;
  beforeEach(() => {
    h = setupHarness();
  });

  it("precaches every entry with a revalidating request, then takes over", async () => {
    const event = h.makeEvent(new MockRequest(BASE));
    h.dispatch("install", event);
    const results = await Promise.allSettled(event.waits);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(h.skipWaitingCalls.length).toBe(1);

    const cache = await h.caches.open(h.sw.CACHE_NAME);
    for (const entry of h.sw.PRECACHE) {
      expect(cache.entries.has(new URL(entry, BASE).href), `cached ${entry}`).toBe(true);
    }
    expect(h.network.calls.length).toBe(h.sw.PRECACHE.length);
    expect(h.network.calls.every((call) => call.cache === "no-cache")).toBe(true);
    expect(h.network.calls.every((call) => call.url.startsWith(BASE))).toBe(true);
  });

  it("rejects the install when an entry cannot be fetched (old worker stays active)", async () => {
    h.network.resolve = async (url) =>
      url.endsWith("dist/bundle.js") ? new MockResponse("", { status: 404 }) : new MockResponse("ok");
    const event = h.makeEvent(new MockRequest(BASE));
    h.dispatch("install", event);
    const results = await Promise.allSettled(event.waits);
    expect(results[0].status).toBe("rejected");
    expect(h.skipWaitingCalls.length).toBe(0);
  });
});

describe("sw.js activate", () => {
  let h;
  beforeEach(() => {
    h = setupHarness();
  });

  it("deletes every old cache, trims runtime entries, and claims clients", async () => {
    h.stores.set("midas-qr-v157", { entries: new Map() });
    const cache = await h.caches.open(h.sw.CACHE_NAME);
    await cache.put(`${BASE}dist/bundle.js`, new MockResponse("precache"));
    for (let i = 0; i < h.sw.RUNTIME_CACHE_LIMIT + 7; i++) {
      await cache.put(`${BASE}runtime/${i}.woff2`, new MockResponse("runtime"));
    }

    const event = h.makeEvent(new MockRequest(BASE));
    h.dispatch("activate", event);
    await Promise.allSettled(event.waits);

    expect(h.stores.has("midas-qr-v157")).toBe(false);
    expect(h.stores.has(h.sw.CACHE_NAME)).toBe(true);
    expect(h.claimCalls.length).toBe(1);

    const keys = [...cache.entries.keys()];
    expect(keys).toContain(`${BASE}dist/bundle.js`);
    const runtimeKeys = keys.filter((key) => key.includes("/runtime/"));
    expect(runtimeKeys.length).toBe(h.sw.RUNTIME_CACHE_LIMIT);
    // Oldest runtime entries are the ones dropped.
    expect(runtimeKeys).not.toContain(`${BASE}runtime/0.woff2`);
    expect(runtimeKeys).toContain(`${BASE}runtime/${h.sw.RUNTIME_CACHE_LIMIT + 6}.woff2`);
  });
});

describe("sw.js version bumps", () => {
  it("installs fresh precache bytes immediately and drops the previous cache", async () => {
    const stores = new Map();

    const oldWorker = setupHarness({ stores });
    oldWorker.network.resolve = async () => new MockResponse("OLD-BYTES");
    const oldInstall = oldWorker.makeEvent(new MockRequest(BASE));
    oldWorker.dispatch("install", oldInstall);
    await Promise.allSettled(oldInstall.waits);

    // Simulate the orchestrator's CACHE_NAME bump for the next deploy: the new
    // worker must revalidate (no-cache) instead of reusing the previous cache.
    // Derived from the source so this test survives every future bump.
    const currentVersion = Number((SW_SOURCE.match(/midas-qr-v(\d+)/) || [])[1]);
    const oldCacheName = `midas-qr-v${currentVersion}`;
    const nextCacheName = `midas-qr-v${currentVersion + 1}`;
    const newSource = SW_SOURCE.replace(oldCacheName, nextCacheName);
    const newWorker = setupHarness({ stores, source: newSource });
    newWorker.network.resolve = async () => new MockResponse("NEW-BYTES");
    const newInstall = newWorker.makeEvent(new MockRequest(BASE));
    newWorker.dispatch("install", newInstall);
    await Promise.allSettled(newInstall.waits);

    expect(newWorker.network.calls.every((call) => call.cache === "no-cache")).toBe(true);
    const fresh = await newWorker.caches.open(nextCacheName);
    expect(await fresh.entries.get(`${BASE}dist/bundle.js`).text()).toBe("NEW-BYTES");

    const newActivate = newWorker.makeEvent(new MockRequest(BASE));
    newWorker.dispatch("activate", newActivate);
    await Promise.allSettled(newActivate.waits);
    expect(stores.has(oldCacheName)).toBe(false);
    expect(stores.has(nextCacheName)).toBe(true);
  });
});

describe("sw.js fetch", () => {
  let h;
  beforeEach(async () => {
    h = setupHarness();
    await h.caches.open(h.sw.CACHE_NAME);
  });

  it("trims the runtime cache to the bound after a revalidation write", async () => {
    const cache = await h.caches.open(h.sw.CACHE_NAME);
    for (let i = 0; i < h.sw.RUNTIME_CACHE_LIMIT; i++) {
      await cache.put(`${BASE}runtime/${i}.bin`, new MockResponse("old"));
    }
    h.network.handler = async () => new MockResponse("new");
    const url = `${BASE}runtime/fresh.bin`;
    const event = h.makeEvent(new MockRequest(url));
    h.dispatch("fetch", event);
    await h.settle(event);

    const runtimeKeys = [...cache.entries.keys()].filter((key) => key.includes("/runtime/"));
    expect(runtimeKeys.length).toBe(h.sw.RUNTIME_CACHE_LIMIT);
    expect(cache.entries.has(url)).toBe(true);
    expect(cache.entries.has(`${BASE}runtime/0.bin`)).toBe(false);
  });

  it("serves the cached shell when a navigation fails offline", async () => {
    const cache = await h.caches.open(h.sw.CACHE_NAME);
    await cache.put(`${BASE}index.html`, new MockResponse("INDEX-SHELL"));
    h.network.handler = async () => {
      throw new Error("offline");
    };
    const event = h.makeEvent(new MockRequest(BASE, { mode: "navigate" }));
    h.dispatch("fetch", event);
    const response = await h.settle(event);
    expect(await response.text()).toBe("INDEX-SHELL");
  });

  it("falls back to 404.html, then 503, when no shell is cached", async () => {
    const cache = await h.caches.open(h.sw.CACHE_NAME);
    await cache.put(`${BASE}404.html`, new MockResponse("NOT-FOUND-PAGE"));
    h.network.handler = async () => {
      throw new Error("offline");
    };
    const with404 = h.makeEvent(new MockRequest(`${BASE}deep/link`, { mode: "navigate" }));
    h.dispatch("fetch", with404);
    expect(await (await h.settle(with404)).text()).toBe("NOT-FOUND-PAGE");

    cache.entries.delete(`${BASE}404.html`);
    const noShell = h.makeEvent(new MockRequest(`${BASE}deep/link`, { mode: "navigate" }));
    h.dispatch("fetch", noShell);
    const response = await h.settle(noShell);
    expect(response.status).toBe(503);
  });

  it("serves cached index.html for a non-ok navigation response", async () => {
    const cache = await h.caches.open(h.sw.CACHE_NAME);
    await cache.put(`${BASE}index.html`, new MockResponse("INDEX-SHELL"));
    h.network.handler = async () => new MockResponse("server 404", { status: 404 });
    const event = h.makeEvent(new MockRequest(`${BASE}nope`, { mode: "navigate" }));
    h.dispatch("fetch", event);
    const response = await h.settle(event);
    expect(await response.text()).toBe("INDEX-SHELL");
  });

  it("stores successful navigations in the runtime cache", async () => {
    h.network.handler = async () => new MockResponse("FRESH-PAGE");
    const event = h.makeEvent(new MockRequest(`${BASE}page`, { mode: "navigate" }));
    h.dispatch("fetch", event);
    const response = await h.settle(event);
    expect(await response.text()).toBe("FRESH-PAGE");
    const cache = await h.caches.open(h.sw.CACHE_NAME);
    expect(cache.entries.has(`${BASE}page`)).toBe(true);
  });

  it("serves stale-while-revalidate and refreshes the cache in the background", async () => {
    const url = `${BASE}dist/bundle.js`;
    const cache = await h.caches.open(h.sw.CACHE_NAME);
    await cache.put(url, new MockResponse("OLD-BUNDLE"));
    h.network.handler = async () => new MockResponse("NEW-BUNDLE");

    const event = h.makeEvent(new MockRequest(url));
    h.dispatch("fetch", event);
    const response = await h.settle(event);
    // The cached copy is served immediately; the fresh copy replaces it after.
    expect(await response.text()).toBe("OLD-BUNDLE");
    expect(await (await cache.entries.get(url)).text()).toBe("NEW-BUNDLE");
  });

  it("never caches non-ok runtime responses", async () => {
    const url = `${BASE}missing.png`;
    h.network.handler = async () => new MockResponse("nope", { status: 404 });
    const event = h.makeEvent(new MockRequest(url));
    h.dispatch("fetch", event);
    const response = await h.settle(event);
    expect(response.status).toBe(404);
    const cache = await h.caches.open(h.sw.CACHE_NAME);
    expect(cache.entries.has(url)).toBe(false);
  });

  it("ignores cross-origin lookalike hosts and non-GET requests", async () => {
    const crossOrigin = h.makeEvent(new MockRequest("https://app.test.evil.example/x.png"));
    h.dispatch("fetch", crossOrigin);
    expect(crossOrigin.handled).toBe(false);

    const post = h.makeEvent(new MockRequest(BASE, { method: "POST" }));
    h.dispatch("fetch", post);
    expect(post.handled).toBe(false);
  });
});
