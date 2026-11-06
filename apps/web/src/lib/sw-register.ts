/**
 * P0 hotfix: the caching service worker of release e94bf99 is retired. Pages no longer register one, and any worker
 * that an earlier visit installed is unregistered here together with the caches it created (vx-*). The server also
 * ships /sw.js as a self-removing worker, so devices that cannot run this code yet clean up on their next update check.
 */
export async function retireServiceWorkers(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("vx-")).map((k) => caches.delete(k)));
    }
  } catch {
    /* nothing to remove / blocked */
  }
}
