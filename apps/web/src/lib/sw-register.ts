import { checkForUpdate } from "./app-update";
import { reportClientEvent } from "./boot";

/**
 * Registers /sw.js (see apps/web/sw/sw.template.js for what it does and does not do). The page never reloads
 * because of the worker: a freshly activated worker only tells the page to look at /version.json, and the
 * updater applies the new build when it is safe.
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  // Kill switch: /?nosw removes the worker and its caches, then continues without it.
  if (new URL(location.href).searchParams.has("nosw")) {
    void unregisterAll();
    return;
  }

  navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
    if ((e.data as { type?: string } | null)?.type === "sw-activated") void checkForUpdate(true);
  });

  const start = () => {
    // Not during start-up: the first paint and the session restore come first.
    window.setTimeout(() => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          let last = Date.now();
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && Date.now() - last > 5 * 60_000) {
              last = Date.now();
              void reg.update().catch(() => undefined);
            }
          });
        })
        .catch((err: unknown) => reportClientEvent({ kind: "sw_error", phase: "register", detail: String((err as Error)?.message ?? err) }));
    }, 3000);
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

export async function unregisterAll(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    if ("caches" in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {
    /* nothing to remove / blocked */
  }
}
