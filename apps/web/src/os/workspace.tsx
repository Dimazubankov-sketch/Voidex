import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiWifiOffLine } from "@remixicon/react";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { takeReopenApp } from "@/lib/known-accounts";
import { useSession } from "@/lib/session";
import { ApprovalPrompt } from "./approval-prompt";
import { CloseGuard } from "./close-guard";
import { useConnection, useServerEvents } from "./events";
import { AppSwitcher } from "./app-switcher";
import { DesktopDock, dockZone } from "./home/dock";
import { useWorkspaceLayout } from "./home/layout";
import { HomeScreen } from "./home/home-screen";
import { WindowOverview } from "./home/window-overview";
import { WindowFrame } from "./window-frame";
import { SYSTEM_BAR_H } from "./metrics";
import { NotificationCenter } from "./notifications/center";
import { useTopEdgeGesture } from "./notifications/gesture";
import { useNotifications } from "./notifications/store";
import { SystemBar } from "./system-bar";
import { foregroundId, useWM, type Rect } from "./window-manager";

function rectOf(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/**
 * The VOIDEX workspace — the OS shell. Grey desk, the home screen (icons,
 * folders, widgets, wallpaper — see ./home) and app windows above it. PC: the
 * system bar at the top and the glass dock at the bottom, above every window
 * (windows live between them). Phone: no dock — the round app-switcher button
 * on the home screen and the home indicator. Both: the Notification Center.
 */
export function Workspace() {
  const ff = useFormFactor();
  const userId = useSession((s) => s.user!.id);
  const wm = useWM();
  const layer = useRef<HTMLDivElement>(null);
  const launcherBtn = useRef<HTMLButtonElement>(null);
  const brushBtn = useRef<HTMLButtonElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const { layout } = useWorkspaceLayout();

  useServerEvents();
  // One request for the bell's badge; later changes arrive over the event stream.
  useNotifications();
  // Phone: a pull from the very top edge opens the Notification Center (also inside apps).
  useTopEdgeGesture(ff === "mobile");

  // Measure the window layer; windows are positioned inside it.
  useLayoutEffect(() => {
    const el = layer.current;
    if (!el) return;
    const ro = new ResizeObserver(() => useWM.getState().setBounds(el.clientWidth, el.clientHeight));
    ro.observe(el);
    useWM.getState().setBounds(el.clientWidth, el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Restore this device's open apps (minimized) for this account.
  useEffect(() => {
    useWM.getState().hydrate(userId);
    setHydrated(true);
    return () => useWM.getState().reset();
  }, [userId]);

  // An account switch made from an app (Vibex) reopens that app for the new account.
  useEffect(() => {
    if (!hydrated) return;
    const app = takeReopenApp();
    if (app === "vibex") useWM.getState().open("vibex");
  }, [hydrated]);

  // Shared Vibex links (#vibex/post/<id>) open the post inside Vibex.
  useEffect(() => {
    if (!hydrated) return;
    const follow = () => {
      const m = /^#vibex\/post\/([0-9a-f-]{36})$/.exec(window.location.hash);
      if (!m) return;
      history.replaceState(null, "", window.location.pathname + window.location.search);
      useWM.getState().open("vibex", { params: { postId: m[1] } });
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [hydrated]);

  // Step 2.5: shared Notes links (#notes/share/<token>) open read-only in Notes.
  useEffect(() => {
    if (!hydrated) return;
    const follow = () => {
      const m = /^#notes\/share\/([A-Za-z0-9_-]{16,64})$/.exec(window.location.hash);
      if (!m) return;
      history.replaceState(null, "", window.location.pathname + window.location.search);
      useWM.getState().open("notes", { params: { share: m[1] } });
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [hydrated]);

  // PC: only the current virtual desktop's windows count as open.
  const fg = ff === "desktop" ? foregroundId(wm, wm.space) : foregroundId(wm);
  const anyVisible = !!fg;
  // PC: windows, also maximized ones, live between the system bar and the dock and never cover them.
  const zone = ff === "desktop" ? dockZone(layout.desktop.dockScale) : 0;
  const top = ff === "desktop" ? SYSTEM_BAR_H : 0;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background" data-testid="workspace">
      <HomeScreen receded={anyVisible && ff === "desktop"} hidden={anyVisible && ff === "mobile"} launcherBtn={launcherBtn} brushBtn={brushBtn} />
      {ff === "desktop" && <SystemBar launcherBtn={launcherBtn} brushBtn={brushBtn} />}
      <div ref={layer} className="pointer-events-none absolute inset-x-0 [&>*]:pointer-events-auto" style={{ zIndex: 20, top, bottom: zone }} data-testid="window-layer">
        {hydrated && wm.order.map((id) => wm.windows[id] && <WindowFrame key={id} win={wm.windows[id]!} launcherRect={() => rectOf(launcherBtn.current)} />)}
      </div>
      {ff === "desktop" && <DesktopDock />}
      {ff === "desktop" && <WindowOverview />}
      {ff === "mobile" && <AppSwitcher />}
      <NotificationCenter />
      <OfflineBanner />
      <ApprovalPrompt />
      <CloseGuard />
    </div>
  );
}

function OfflineBanner() {
  const t = useT();
  const online = useConnection((s) => s.online);
  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          className="absolute inset-x-0 top-[max(var(--safe-top),12px)] z-[250] mx-auto flex w-fit items-center gap-2 rounded-full bg-text px-4 py-2 text-[13px] font-medium text-white shadow-float"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          role="status"
        >
          <RiWifiOffLine className="size-4" /> {t("os.offline")}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
