const CACHE_VERSION = 'sg-nearby-bus-stops-v7';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './offline.html',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then(response => response || caches.match('./offline.html')))
    );
    return;
  }

  // Bundled datasets: network-first so refreshed data is picked up, with the
  // cached copy as an offline fallback.
  const dataPath = new URL(request.url).pathname;
  if (dataPath.endsWith('/bus-stops.jsonl') || dataPath.endsWith('/streets.jsonl') || dataPath.endsWith('/malls.jsonl') || dataPath.endsWith('/mrt.jsonl') || dataPath.endsWith('/places.jsonl')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        return cached;
      }

      const url = new URL(request.url);
      const shouldRuntimeCache =
        url.origin === self.location.origin ||
        url.hostname === 'unpkg.com';

      return fetch(request)
        .then(response => {
          if (!shouldRuntimeCache || !response || (response.status !== 200 && response.type !== 'opaque')) {
            return response;
          }

          const responseCopy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, responseCopy));
          return response;
        })
        .catch(() => caches.match('./offline.html'));
    })
  );
});
