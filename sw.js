// ABION FORGE — service worker
// Caches the app shell (this is a single-page app, so that's just the
// handful of local files) so the UI still loads offline or on a flaky
// connection. It does NOT cache API calls to your configured endpoint —
// those always go straight to the network, since cached chat responses
// would be meaningless (and stale keys/models would be actively wrong).

const CACHE_NAME = 'abion-forge-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept cross-origin requests — that's your AI API endpoint,
  // CDN fonts/scripts, etc. Let those hit the network normally.
  if (url.origin !== self.location.origin) return;

  // App shell: cache-first, falling back to network, then updating the
  // cache in the background so the next load picks up any redeploy.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
