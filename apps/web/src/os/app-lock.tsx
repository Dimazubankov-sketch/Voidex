import { useEffect, useState, type ReactNode } from "react";
import { RiLock2Line } from "@remixicon/react";
import type { AppId } from "@voidex/shared";
import { useT } from "@/lib/i18n";
import { ensureStepUp } from "@/lib/security";
import { useSession } from "@/lib/session";
import { useWM } from "./window-manager";

/**
 * Step 2.8: Settings → Apps → <app> → «Face ID / код-пароль». A protected app
 * asks "confirm it's you" (the code-password or Face ID, the same step-up as
 * sensitive Settings sections) when its window opens; cancelling closes it.
 */
export function AppLockGate({ appId, windowId, children }: { appId: AppId; windowId: string; children: ReactNode }) {
  const t = useT();
  // Decided when the window opens: turning the setting on later applies from the next opening.
  const [locked] = useState(() => useSession.getState().user?.preferences.apps?.[appId]?.lock === true);
  const [open, setOpen] = useState(!locked);
  useEffect(() => {
    if (!locked) return;
    let alive = true;
    void ensureStepUp()
      .catch(() => false)
      .then((ok) => {
        if (!alive) return;
        if (ok) setOpen(true);
        else useWM.getState().close(windowId);
      });
    return () => {
      alive = false;
    };
  }, [locked, windowId]);
  if (open) return <>{children}</>;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center" data-testid="app-locked">
      <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
        <RiLock2Line className="size-7" />
      </span>
      <p className="max-w-[260px] text-[14.5px] text-text-secondary">{t("apps.lockedHint")}</p>
    </div>
  );
}
