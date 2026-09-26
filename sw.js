// Midas QR Service Worker — offline-first caching.
// Cache-bump policy: on every shipped change, bump CACHE_NAME and the
// style.min.css ?v= query here AND in index.html in the same commit;
// tools/check-sw.mjs fails the build if those two versions drift.
//
// Update flow (verified by tests/sw.test.js): install always revalidates
// (`no-cache`), so a CACHE_NAME bump precaches the current bytes — reused from
// the HTTP cache on a 304, fetched in full when the file changed — even when
// the host allows long-lived HTTP caching of unversioned files. The new
// worker skipWaits + claims, so the first reload after a deploy may still run
// the previously cached bundle while the update installs, and the *next*
// reload is served entirely from the new precache: the installed app updates
// reliably within two reloads.
const CACHE_NAME = "midas-qr-v258";
// Runtime additions (theme fonts, offline navigation targets) are capped so a
// long-lived worker cannot grow storage without bound. Precache is never pruned.
const RUNTIME_CACHE_LIMIT = 60;
const PRECACHE = [
  // The root URL is served from ./index.html by the navigation fallback
  // below, so precaching "./" would only fetch the same ~100 KB document a
  // second time (no-cache still costs a revalidation round-trip during
  // install).
  "./index.html",
  "./404.html",
  // Sitemap stays (index.html links it); robots.txt was dropped because the
  // shell never requests it and every precache entry costs install bytes.
  "./sitemap.xml",
  "./manifest.json",
  "./favicon.svg",
  "./favicon.svg?v=11",
  "./icon-192x192.png",
  "./icon-512x512.png",
  "./dist/bundle.js",
  // Precache the exact versioned stylesheet URL the page requests so the
  // first controlled load is both fresh and offline-capable.
  "./src/css/style.min.css?v=156",
  // Figtree is the default theme font; the other theme families are cached on
  // first use of their theme (stale-while-revalidate below), which keeps the
  // install payload small.
  "./src/fonts/figtree-var-latin.woff2",
  "./src/fonts/figtree-var-latin-ext.woff2",
  "./src/lib/qr-code-styling.min.js",
  "./src/lib/jsqr.min.js",
  "./src/lib/qrcode.min.js",
  "./src/js/scanner/worker.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Requests are built with cache: "no-cache" so every precache fetch
      // revalidates with the server: unchanged files return 304 and reuse the
      // HTTP-cached bytes (no re-download), while a changed file returns its
      // full fresh body — a new CACHE_NAME can never install stale bytes. The
      // revalidation still costs one network round-trip per entry; addAll
      // stays atomic: one failed entry aborts the update, leaving the previous
      // worker (and a fully working offline app) in place.
      await cache.addAll(PRECACHE.map((entry) => new Request(entry, { cache: "no-cache" })));
      // Take over as soon as the new worker is ready instead of waiting for
      // every tab to close: long-lived tabs otherwise stay pinned to a stale
      // asset set indefinitely (the update banner + controllerchange handle
      // telling the user to reload).
      await self.skipWaiting();
    })()
  );
});

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

// Exact origin comparison: a naive `url.startsWith(origin)` would also match
// lookalike hosts such as "https://<origin>.evil.example/", letting this worker
// intercept and cache third-party requests. Cross-origin requests are left to
// the network.
function isSameOrigin(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch (_err) {
    return false;
  }
}

// Absolute URLs of every precache entry, used to keep those entries untouched
// by runtime pruning.
function precacheKeys() {
  return new Set(PRECACHE.map((entry) => new URL(entry, self.location.href).href));
}

// Drops the oldest runtime (non-precache) entries beyond RUNTIME_CACHE_LIMIT.
// cache.keys() is ordered oldest-first, so this is a simple LRU-ish trim; even
// if that order were ever unspecified, the worst case is evicting a different
// runtime entry, never a precached one.
async function trimRuntimeCache(cache) {
  const keep = precacheKeys();
  const keys = await cache.keys();
  const runtime = keys.filter((request) => !keep.has(new URL(request.url).href));
  const excess = runtime.length - RUNTIME_CACHE_LIMIT;
  for (let i = 0; i < excess; i++) await cache.delete(runtime[i]);
}

// Stores a response and trims. Only call with an ok response: non-200, opaque
// and error responses must never enter the cache.
function storeResponse(cache, request, response) {
  return cache
    .put(request, response.clone())
    .then(() => trimRuntimeCache(cache))
    .catch(() => {});
}

function offlineResponse() {
  return new Response("Offline and app shell unavailable.", {
    status: 503,
    headers: new Headers({ "Content-Type": "text/plain" }),
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !isSameOrigin(request.url)) return;

  // Navigations: network-first -> fallback to cached index.html, then 404.html, then 503.
  if (isNavigationRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            event.waitUntil(storeResponse(cache, request, networkResponse));
            return networkResponse;
          }
          // Non-200 navigation: serve cached shell so the SPA handles it.
          const cachedIndex = await caches.match("./index.html");
          return cachedIndex || networkResponse;
        } catch (_err) {
          const cachedRequest = await caches.match(request);
          if (cachedRequest) return cachedRequest;
          const shell = await caches.match("./index.html");
          if (shell) return shell;
          const notFound = await caches.match("./404.html");
          if (notFound) return notFound;
          return offlineResponse();
        }
      })()
    );
    return;
  }

  // Everything else: stale-while-revalidate, same-origin only. Versioned
  // asset URLs are precached exactly, so matches stay exact and every ?v=
  // bump ships fresh files on the next service-worker update.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cachedResponse) => {
        const revalidation = fetch(request).then((networkResponse) => {
          if (!networkResponse.ok) return networkResponse;
          return storeResponse(cache, request, networkResponse).then(() => networkResponse);
        });
        // Keep the worker alive for the cache write even when the cached copy
        // is served immediately; revalidation failures never surface.
        event.waitUntil(
          revalidation.then(
            () => {},
            () => {}
          )
        );
        if (cachedResponse) return cachedResponse;
        return revalidation.catch(() => offlineResponse());
      })
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // A failed stale-cache delete must not block the new worker from
      // activating: settle every delete instead of rejecting the event.
      await Promise.all(keys.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name).catch(() => {})));
      // Clear runtime clutter accumulated under earlier behavior; precache stays.
      const cache = await caches.open(CACHE_NAME);
      await trimRuntimeCache(cache);
      await self.clients.claim();
    })()
  );
});
