const CACHE_NAME = "nomio-shell-v2";
const BASE_PATH = new URL("./", self.location.href).pathname;
const asset = (path) => `${BASE_PATH}${path}`;
const PRECACHE_URLS = [
  asset(""),
  asset("manifest.webmanifest"),
  asset("nomio-icon.svg"),
  asset("icons/icon-192.png"),
  asset("icons/icon-512.png"),
  asset("offline.html"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("nomio-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => {
            void cache.put(asset(""), copy);
            void cache.put(request, response.clone());
          });
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached ?? caches.match(asset("offline.html"))),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      });
    }),
  );
});
