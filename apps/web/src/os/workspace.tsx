import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RiWifiOffLine } from "@remixicon/react";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { ApprovalPrompt } from "./approval-prompt";
import { useConnection, useServerEvents } from "./events";
import { AppSwitcher } from "./app-switcher";
import { DOCK_ZONE, DesktopBottomBar } from "./home/dock";
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
 * folders, wallpaper — see ./home) and app windows above it. Top-right: [...]
 * system menu and the 9-dot app menu. No dock, no bottom navigation.
 */
export function Workspace() {
  const ff = useFormFactor();
  const userId = useSession((s) => s.user!.id);
  const wm = useWM();
  const layer = useRef<HTMLDivElement>(null);
  const launcherBtn = useRef<HTMLButtonElement>(null);
  const [hydrated, setHydrated] = useState(false);

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

  // PC: only the current virtual desktop's windows count as open.
  const fg = ff === "desktop" ? foregroundId(wm, wm.space) : foregroundId(wm);
  const anyVisible = !!fg;
  // PC bottom bar (search + dock): windows, also maximized ones, keep clear of it.
  const bar = ff === "desktop";

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background" data-testid="workspace">
      <HomeScreen receded={anyVisible && ff === "desktop"} hidden={anyVisible && ff === "mobile"} launcherBtn={launcherBtn} />
      <div ref={layer} className="pointer-events-none absolute inset-x-0 top-0 [&>*]:pointer-events-auto" style={{ zIndex: 20, bottom: bar ? DOCK_ZONE : 0 }}>
        {hydrated && wm.order.map((id) => wm.windows[id] && <WindowFrame key={id} win={wm.windows[id]!} launcherRect={() => rectOf(launcherBtn.current)} />)}
      </div>
      {ff === "desktop" && <DesktopBottomBar />}
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
