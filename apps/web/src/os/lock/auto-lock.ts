import { useEffect } from "react";
import { api, rawPost } from "@/lib/api";
import { useSecurityStatus } from "@/lib/security";
import { useSession } from "@/lib/session";

/** Locks this device now (only with a code-password: without one there is nothing to unlock with). */
export async function lockNow(): Promise<boolean> {
  try {
    const r = await rawPost<{ locked: boolean }>("/api/auth/lock");
    if (r.locked) useSession.getState().lockLocal();
    return r.locked;
  } catch {
    return false;
  }
}

const HEARTBEAT_MS = 60_000;

/**
 * Auto-lock after the chosen idle time (Settings → Lock screen). Input
 * (pointer, keys, wheel, touch) counts as activity; while the person is
 * active a light heartbeat tells the server, so its own idle check (the real
 * enforcement) never locks someone mid-use. A laptop waking from sleep is
 * checked on return.
 */
export function useAutoLock() {
  const status = useSecurityStatus().data;
  const locked = useSession((s) => s.locked);
  const minutes = status?.passcodeEnabled ? status.autoLockMinutes : 0;

  useEffect(() => {
    if (!status?.passcodeEnabled || locked) return;
    let lastInput = Date.now();
    let lastBeat = Date.now();
    let locking = false;
    const touch = () => {
      lastInput = Date.now();
    };
    const check = () => {
      const now = Date.now();
      if (minutes > 0 && !locking && now - lastInput > minutes * 60_000) {
        locking = true;
        void lockNow().finally(() => (locking = false));
        return;
      }
      if (lastInput > lastBeat && now - lastBeat >= HEARTBEAT_MS) {
        lastBeat = now;
        void api.post("/api/security/activity").catch(() => undefined);
      }
    };
    const onVisible = () => document.visibilityState === "visible" && check();
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "pointermove"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(check, 10_000);
    return () => {
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [status?.passcodeEnabled, minutes, locked]);
}
