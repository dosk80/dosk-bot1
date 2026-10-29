const CACHE_NAME = "dosk-panel-v1";
self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
});
self.addEventListener("fetch", (e) => {
  // Network first
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
