// VOIDEX service worker RETIREMENT (P0 hotfix). Replaces the caching worker of release e94bf99.
// No fetch handler: nothing is intercepted, every request goes to the network as if no worker existed.
// On activation it deletes the caches it created and unregisters itself; the page then runs without a worker.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf("vx-") === 0; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.registration.unregister(); }),
  );
});
