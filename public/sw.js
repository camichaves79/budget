/* Service worker — network-first runtime cache (2026-09, install-app-signal).
 *
 * Minimal on purpose: NO pre-cache, so a new deploy is picked up on the next
 * load and a stale shell can never outlive a ship. Its presence — a
 * registered worker with a fetch handler, plus manifest.webmanifest — is
 * what makes Chromium treat the site as installable. iOS never needed it
 * ("Add to Home Screen" works from the manifest alone) but benefits from
 * the offline fallback for already-loaded pages.
 */
const CACHE_NAME = 'budget-runtime-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only same-origin GETs. The API (api.5budget.app), Firebase and Lemon
  // Squeezy traffic all live on other origins and pass through untouched.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, copy))
            .catch(() => {
              /* cache write failed — serve the network response anyway */
            });
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? Response.error())),
  );
});
