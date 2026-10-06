// Midas QR Service Worker — offline-first caching.
// Cache-bump policy: on every shipped change, bump CACHE_NAME. The asset ?v=
// queries below (favicon, bundle, stylesheet) are NOT hand-maintained: the build
// stamps each one with a hash of the file's own bytes (tools/stamp-assets.mjs),
// and tools/check-sw.mjs re-derives it, so a version that fails to move when its
// file changes fails the build instead of shipping.
//
// Those versions matter because navigations are network-first (below): a deploy
// serves the new index.html immediately while every other asset still comes from
// the previous precache. Without a version that moves, the new markup is paired
// with the previous bundle until the second reload, which crashed the app
// outright when a release removed DOM ids the old bundle required.
//
// Update flow (verified by tests/sw.test.js): install revalidates the
// unversioned shell (`no-cache`), so a CACHE_NAME bump precaches the current
// bytes — reused from the HTTP cache on a 304, fetched in full when the file
// changed — even when the host allows long-lived HTTP caching of unversioned
// files. Content-hashed (?v=) assets are immutable, so they install straight
// from the HTTP cache without a revalidation round-trip. The new worker
// skipWaits + claims, so the first reload after a deploy may still run the
// previously cached bundle while the update installs, and the *next* reload is
// served entirely from the new precache: the installed app updates reliably
// within two reloads.
const CACHE_NAME = "midas-qr-v262";
// Only caches under this prefix are managed by the worker: activation deletes
// stale app caches but must never touch another library's or app's storage.
const APP_CACHE_PREFIX = "midas-qr-";
// Runtime additions (theme fonts, offline navigation targets) are capped so a
// long-lived worker cannot grow storage without bound. Precache is never pruned.
const RUNTIME_CACHE_LIMIT = 60;
// Canonical key every successful navigation is stored under. Navigations used
// to be cached per-URL, duplicating the same ~100 KB shell once per visited
// address; one shared entry covers them all.
const SHELL_CACHE_KEY = "./index.html";
// Critical app shell: small, unversioned, revalidated on every install so a
// cache bump can never install stale bytes. Kept deliberately lean —
// fonts, libraries and icons join the runtime cache on first use instead of
// inflating every install (~800 KB of double-fetch before).
const PRECACHE = [
  "./index.html",
  "./404.html",
  // Sitemap stays (index.html links it); robots.txt was dropped because the
  // shell never requests it and every precache entry costs install bytes.
  "./sitemap.xml",
  "./manifest.json",
  "./icon-192x192.png",
  "./src/js/scanner/worker.js",
];
// Content-hashed, immutable assets: the ?v= moves with the bytes, so these
// install from the HTTP cache as-is — no revalidation round-trip. (Versions
// stamped by tools/stamp-assets.mjs, verified by tools/check-sw.mjs.)
const PRECACHE_IMMUTABLE = [
  "./favicon.svg?v=76aeff07",
  "./dist/bundle.js?v=b126f71b",
  // Precache the exact versioned stylesheet URL the page requests so the
  // first controlled load is both fresh and offline-capable.
  "./src/css/style.min.css?v=9b9562f4",
];
// Lazy runtime set, cached stale-while-revalidate on first use (never
// precached): theme fonts, the on-demand non-default font sheet, vendored
// libraries, the manifest-only large icon.
// Dropped from the precache: the bare favicon.svg duplicate (the versioned URL
// is the one the shell requests), figtree latin-ext (no @font-face references
// it) and icon-512 (manifest-only; served from the runtime cache offline).
const RUNTIME_SWR_PATTERNS = [/\/src\/fonts\//, /\/src\/lib\//, /\/icon-.*\.png$/, /\/favicon\.svg$/];

function isRuntimeSwr(url) {
  try {
    const parsed = new URL(url, self.location.href);
    const path = parsed.pathname + parsed.search;
    if (/(^|[?&])v=[0-9a-z]+/.test(parsed.search)) return true;
    return RUNTIME_SWR_PATTERNS.some((pattern) => pattern.test(path));
  } catch (_err) {
    return false;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Unversioned shell requests revalidate with the server: unchanged files
      // return 304 and reuse the HTTP-cached bytes (no re-download), while a
      // changed file returns its full fresh body — a new CACHE_NAME can never
      // install stale bytes. addAll stays atomic: one failed entry aborts the
      // update, leaving the previous worker (and a fully working offline app)
      // in place.
      await cache.addAll(PRECACHE.map((entry) => new Request(entry, { cache: "no-cache" })));
      // Immutable assets need no revalidation: the URL already encodes the
      // content, and a forced no-cache here re-downloaded every byte on each
      // update even when the HTTP cache held them.
      await cache.addAll(PRECACHE_IMMUTABLE.map((entry) => new Request(entry)));
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
  return new Set(
    [...PRECACHE, ...PRECACHE_IMMUTABLE].map((entry) => new URL(entry, self.location.href).href)
  );
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
  // Explicit no-store (analytics beacons and friends) opts out of the cache
  // entirely: pass it through and never store the response.
  if (request.cache === "no-store") {
    event.respondWith(fetch(request));
    return;
  }

  // Navigations: network-first -> fallback to cached shell, then 404.html,
  // then 503. A successful navigation refreshes the single shared shell entry
  // (./index.html), never a per-URL duplicate.
  if (isNavigationRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            event.waitUntil(storeResponse(cache, SHELL_CACHE_KEY, networkResponse));
            return networkResponse;
          }
          // Online but the server answered an error: hand that status through
          // untouched. Substituting the cached 200 shell here turns every real
          // 404 into a soft-404 that crawlers and clients can never see.
          return networkResponse;
        } catch (_err) {
          const shell = await caches.match(SHELL_CACHE_KEY);
          if (shell) return shell;
          const notFound = await caches.match("./404.html");
          if (notFound) return notFound;
          return offlineResponse();
        }
      })()
    );
    return;
  }

  // Content-hashed (?v=) assets are immutable: cache-first, no revalidation.
  // The URL moves whenever the bytes do, so a hit can never be stale and a
  // miss fetches (and keeps) exactly the bytes the shell asked for.
  const isImmutable = /(^|[?&])v=[0-9a-z]+/.test(new URL(request.url, self.location.href).search);
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(request);
      if (cachedResponse && isImmutable) return cachedResponse;
      if (cachedResponse && !isRuntimeSwr(request.url)) return cachedResponse;
      if (!cachedResponse) {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok && (isImmutable || isRuntimeSwr(request.url))) {
            await storeResponse(cache, request, networkResponse);
          }
          return networkResponse;
        } catch (_err) {
          return offlineResponse();
        }
      }
      // Stale-while-revalidate, fonts/libraries/icons only: serve the cached
      // copy immediately and refresh it in the background. Revalidation
      // failures never surface; a failed cache write still keeps the copy.
      event.waitUntil(
        fetch(request).then(
          (networkResponse) => {
            if (!networkResponse.ok) return;
            return storeResponse(cache, request, networkResponse);
          },
          () => {}
        )
      );
      return cachedResponse;
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Only this app's own prefixed caches are managed here: deleting every
      // other cache evicted storage belonging to other libraries and apps
      // sharing the origin. A failed stale-cache delete must not block the new
      // worker from activating: settle every delete instead of rejecting.
      await Promise.all(
        keys
          .filter((name) => name !== CACHE_NAME && name.startsWith(APP_CACHE_PREFIX))
          .map((name) => caches.delete(name).catch(() => {}))
      );
      // Clear runtime clutter accumulated under earlier behavior; precache stays.
      const cache = await caches.open(CACHE_NAME);
      await trimRuntimeCache(cache);
      await self.clients.claim();
    })()
  );
});
