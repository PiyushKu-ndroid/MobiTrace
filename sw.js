const CACHE_NAME = "mobitrace-cache-v1";
const urlsToCache = [
  "/",
  "/index.html",
  "/app.js",
  "/style.css",
  "/bus-icon (192).png",
  "/bus-icon (512).png"
];

// Install: cache all files
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

// Activate
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Fetch: serve cached files if offline
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});


