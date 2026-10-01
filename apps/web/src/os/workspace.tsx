import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiWifiOffLine } from "@remixicon/react";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { ApprovalPrompt } from "./approval-prompt";
import { useConnection, useServerEvents } from "./events";
import { AppSwitcher } from "./app-switcher";
import { DesktopDock, dockZone } from "./home/dock";
import { useWorkspaceLayout } from "./home/layout";
import { HomeScreen } from "./home/home-screen";
import { WindowFrame } from "./window-frame";
import { foregroundId, useWM, type Rect } from "./window-manager";

function rectOf(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/**
 * The VOIDEX workspace — the OS shell. Grey desk, the home screen (icons,
 * folders, widgets, wallpaper — see ./home) and app windows above it. PC: the
 * glass dock at the bottom, above every window. Phone: no dock — the round
 * "Desktops" button and the home indicator.
 */
export function Workspace() {
  const ff = useFormFactor();
  const userId = useSession((s) => s.user!.id);
  const wm = useWM();
  const layer = useRef<HTMLDivElement>(null);
  const launcherBtn = useRef<HTMLButtonElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const { layout } = useWorkspaceLayout();

  useServerEvents();

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

  // PC: only the current virtual desktop's windows count as open.
  const fg = ff === "desktop" ? foregroundId(wm, wm.space) : foregroundId(wm);
  const anyVisible = !!fg;
  // PC dock: windows, also maximized ones, end right above it and never cover it.
  const zone = ff === "desktop" ? dockZone(layout.desktop.dockScale) : 0;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background" data-testid="workspace">
      <HomeScreen receded={anyVisible && ff === "desktop"} hidden={anyVisible && ff === "mobile"} launcherBtn={launcherBtn} />
      <div ref={layer} className="pointer-events-none absolute inset-x-0 top-0 [&>*]:pointer-events-auto" style={{ zIndex: 20, bottom: zone }} data-testid="window-layer">
        {hydrated && wm.order.map((id) => wm.windows[id] && <WindowFrame key={id} win={wm.windows[id]!} launcherRect={() => rectOf(launcherBtn.current)} />)}
      </div>
      {ff === "desktop" && <DesktopDock />}
      {ff === "mobile" && <AppSwitcher />}
      <OfflineBanner />
      <ApprovalPrompt />
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
