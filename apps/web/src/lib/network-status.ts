import { useEffect, useState } from "react";
import { useConnection } from "@/os/events";
import { queryClient } from "@/lib/query";

/** A problem must last this long before «Обновление...» shows (no flicker on a short blip). */
export const NETWORK_TROUBLE_DELAY_MS = 1500;

/** Right now: is something really wrong with the connection (not just loading)? */
export function networkTroubleNow(): boolean {
  const c = useConnection.getState();
  if (!c.online) return true;
  if (!c.everConnected) return false;
  if (!c.connected) return true;
  // Requests being retried after a failure (timeouts, 5xx, dropped connections).
  return queryClient
    .getQueryCache()
    .getAll()
    .some((q) => q.state.fetchStatus === "fetching" && q.state.fetchFailureCount > 0);
}

/**
 * Step 2.11: «Обновление...» in a header only on a real problem: offline,
 * the realtime stream lost (after it was up once), or requests being retried.
 * Shown after NETWORK_TROUBLE_DELAY_MS of trouble; gone as soon as it is over.
 * No polling: it listens to the connection store and the query cache.
 */
export function useNetworkTrouble(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      if (networkTroubleNow()) {
        if (timer === undefined && !shown) timer = window.setTimeout(() => ((timer = undefined), setShown(networkTroubleNow())), NETWORK_TROUBLE_DELAY_MS);
      } else {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        setShown(false);
      }
    };
    check();
    const offConn = useConnection.subscribe(check);
    const offCache = queryClient.getQueryCache().subscribe(check);
    return () => {
      offConn();
      offCache();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [shown]);
  return shown;
}
