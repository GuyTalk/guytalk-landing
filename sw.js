// GuyTalk service worker — minimal offline support.
//
// On install: pre-cache the homepage and the brief archive (stable URLs).
// On fetch: network-first for page navigations, falling back to the cached copy
// (then the homepage) when offline. Every visited page is cached as you go, so
// "today's brief" is available offline after its first view without the SW
// needing to hardcode a daily-changing issue URL.
const CACHE = 'guytalk-v2';
const CORE = ['/']; // homepage only — a clean 200; everything else is runtime-cached

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .catch(() => {}) // never let a precache miss block activation
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Only intercept top-level page navigations; let everything else (API calls,
  // images, fonts) hit the network normally so we never serve stale live data.
  if (req.mode !== 'navigate') return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
  );
});
