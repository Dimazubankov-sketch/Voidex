import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { RiCloseLine, RiMoreFill, RiWifiOffLine } from "@remixicon/react";
import { APP_REGISTRY, type AppId, type InstalledAppDto } from "@voidex/shared";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { formatDate, useLanguage, useT } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useMailSummary } from "@/lib/mail-summary";
import { AppTile } from "@/brand/brand";
import { IconButton } from "@/ui/controls";
import { Popover, Sheet, usePopover } from "@/ui/overlays";
import { CLIENT_APPS } from "./app-registry";
import { ApprovalPrompt } from "./approval-prompt";
import { useConnection, useServerEvents } from "./events";
import { WorkspaceMenu } from "./system-menu";
import { WindowFrame } from "./window-frame";
import { foregroundId, useWM, type Rect } from "./window-manager";

const EASE = [0.22, 1, 0.36, 1] as const;

function rectOf(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export function useInstalledApps() {
  const order = useSession((s) => s.user?.preferences.workspace.appOrder) ?? [];
  const q = useQuery({ queryKey: qk.apps, queryFn: () => api.get<InstalledAppDto[]>("/api/apps"), staleTime: 60_000 });
  const apps = [...(q.data ?? [])].sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return { ...q, apps };
}

/**
 * The VOIDEX workspace — the OS shell. Grey desk, a white home surface with
 * the installed apps, and app windows above it. Top-right: [...] system menu
 * and the 9-dot launcher. No dock, no bottom navigation.
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

  const fg = foregroundId(wm);
  const anyVisible = !!fg;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background" data-testid="workspace">
      <HomeSurface receded={anyVisible && ff === "desktop"} hidden={anyVisible && ff === "mobile"} launcherBtn={launcherBtn} />
      <div ref={layer} className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto" style={{ zIndex: 20 }}>
        {hydrated && wm.order.map((id) => wm.windows[id] && <WindowFrame key={id} win={wm.windows[id]!} launcherRect={() => rectOf(launcherBtn.current)} />)}
      </div>
      {ff === "mobile" && <AppSwitcher />}
      <OfflineBanner />
      <ApprovalPrompt />
    </div>
  );
}

function HomeSurface({ receded, hidden, launcherBtn }: { receded: boolean; hidden: boolean; launcherBtn: RefObject<HTMLButtonElement | null> }) {
  const t = useT();
  const ff = useFormFactor();
  const { apps, isLoading } = useInstalledApps();
  const menu = usePopover();
  const [launcherOpen, setLauncherOpen] = useState(false);

  return (
    <motion.main
      className={cx(
        "absolute flex flex-col overflow-hidden bg-surface shadow-surface",
        ff === "mobile" ? "inset-[10px] top-[max(var(--safe-top),10px)] bottom-[max(var(--safe-bottom),10px)] rounded-[32px]" : "inset-[14px] rounded-[34px]",
      )}
      animate={receded ? { opacity: 0.55, scale: 0.985 } : hidden ? { opacity: 0.6, scale: 0.94 } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: EASE }}
      aria-hidden={hidden || undefined}
    >
      {/* the violet light line from the concept, without the user notch */}
      <div aria-hidden className="absolute inset-x-[18%] top-0 h-[3px] rounded-b-full bg-gradient-to-r from-transparent via-[#8c7dff] to-transparent animate-glow" />
      <div aria-hidden className="absolute inset-x-[25%] -top-6 h-12 rounded-full bg-primary/25 blur-2xl" />

      <header className="relative flex h-16 shrink-0 items-center gap-2 px-5 sm:px-7">
        <Clock />
        <div className="flex-1" />
        <IconButton ref={menu.anchor} label={t("os.menu")} onClick={menu.toggle} data-testid="workspace-menu">
          <RiMoreFill className="size-5" />
        </IconButton>
        <IconButton ref={launcherBtn} label={t("os.launcher")} onClick={() => setLauncherOpen((o) => !o)} data-testid="launcher-button" active={launcherOpen}>
          <NineDots />
        </IconButton>
      </header>

      <div className="scroll-area flex-1 px-5 pb-10 pt-4 sm:px-10 sm:pt-10">
        <div className={cx("mx-auto", ff === "mobile" ? "grid max-w-[360px] grid-cols-3 gap-x-4 gap-y-7" : "flex max-w-[760px] flex-wrap justify-center gap-x-6 gap-y-8 pt-[6vh] [&>*]:w-[120px]")}>
          {isLoading && Array.from({ length: 2 }, (_, i) => <div key={i} className="mx-auto size-[76px] rounded-[24px] skeleton" />)}
          {apps.map((a, i) => (
            <AppIconButton key={a.id} app={a} index={i} />
          ))}
        </div>
      </div>

      <Popover open={menu.open} onClose={menu.close} anchor={menu.anchor} width={250} testId="workspace-menu-popover">
        <WorkspaceMenu onDone={menu.close} />
      </Popover>
      <Launcher open={launcherOpen} onClose={() => setLauncherOpen(false)} anchor={launcherBtn} />
    </motion.main>
  );
}

function AppCaption({ appId }: { appId: AppId }) {
  const lang = useLanguage();
  const t = useT();
  const summary = useMailSummary(appId === "mail");
  if (appId === "mail" && summary.data?.unread.inbox) {
    return <span className="font-medium text-primary">{t("os.unread", { n: summary.data.unread.inbox })}</span>;
  }
  return <>{APP_REGISTRY[appId].caption[lang]}</>;
}

function AppIconButton({ app, index }: { app: InstalledAppDto; index: number }) {
  const lang = useLanguage();
  const open = useWM((s) => s.open);
  const running = useWM((s) => Object.values(s.windows).some((w) => w.appId === app.id));
  const ref = useRef<HTMLButtonElement>(null);
  const { Icon } = CLIENT_APPS[app.id];
  const unread = useMailSummary(app.id === "mail").data?.unread.inbox ?? 0;
  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={() => open(app.id, { origin: rectOf(ref.current?.querySelector("[data-tile]") ?? null) })}
      className="group flex flex-col items-center gap-2 rounded-3xl py-1 outline-none"
      initial={{ opacity: 0, y: 12, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.08 + index * 0.05, duration: 0.45, ease: EASE }}
      whileTap={{ scale: 0.92 }}
      data-testid={`app-${app.id}`}
    >
      <span data-tile className="relative">
        <AppTile size={76} className="transition-transform duration-200 group-hover:-translate-y-0.5 group-focus-visible:ring-4 group-focus-visible:ring-primary/30">
          <Icon className="size-11" />
        </AppTile>
        {app.id === "mail" && unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-[12px] font-semibold text-white shadow-glow animate-pop">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </span>
      <span className="text-[14px] font-semibold text-text">{app.manifest.name[lang]}</span>
      <span className="-mt-1.5 max-w-[120px] truncate text-[12px] text-text-tertiary">
        <AppCaption appId={app.id} />
      </span>
      <span className={cx("-mt-1 size-1.5 rounded-full transition-opacity", running ? "bg-primary opacity-100" : "opacity-0")} />
    </motion.button>
  );
}

/** 9-dot launcher: installed apps, with the ones currently open marked. */
function Launcher({ open, onClose, anchor }: { open: boolean; onClose: () => void; anchor: RefObject<HTMLButtonElement | null> }) {
  const t = useT();
  const ff = useFormFactor();
  const lang = useLanguage();
  const { apps } = useInstalledApps();
  const wm = useWM();
  const body = (
    <div data-testid="launcher">
      {ff === "desktop" && <div className="px-2 pb-2 pt-1 text-[12px] font-medium uppercase tracking-wide text-text-tertiary">{t("os.apps")}</div>}
      <div className="grid grid-cols-3 gap-1">
        {apps.map((a) => {
          const { Icon } = CLIENT_APPS[a.id];
          const running = Object.values(wm.windows).some((w) => w.appId === a.id);
          return (
            <button
              key={a.id}
              className="pressable flex flex-col items-center gap-1.5 rounded-2xl py-3 hover:bg-surface-hover"
              onClick={(e) => {
                onClose();
                wm.open(a.id, { origin: rectOf(e.currentTarget.querySelector("[data-tile]")) });
              }}
              data-testid={`launcher-${a.id}`}
            >
              <span data-tile>
                <AppTile size={52}>
                  <Icon className="size-8" />
                </AppTile>
              </span>
              <span className="text-[13px] font-medium">{a.manifest.name[lang]}</span>
              <span className={cx("size-1 rounded-full", running ? "bg-primary" : "bg-transparent")} />
            </button>
          );
        })}
      </div>
    </div>
  );
  if (ff === "mobile") {
    return (
      <Sheet open={open} onClose={onClose} title={t("os.apps")}>
        {body}
      </Sheet>
    );
  }
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} width={300} testId="launcher-popover">
      <div className="p-1.5">{body}</div>
    </Popover>
  );
}

/** Mobile multitasking: cards of open apps; tap to switch, swipe up to close. */
function AppSwitcher() {
  const t = useT();
  const lang = useLanguage();
  const wm = useWM();
  const open = wm.switcherOpen;
  const items = [...wm.order].reverse().map((id) => wm.windows[id]!).filter(Boolean);
  useEffect(() => {
    if (open && items.length === 0) wm.setSwitcher(false);
  }, [open, items.length, wm]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-[100] flex flex-col bg-background/80 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={() => wm.goHome()}
          data-testid="app-switcher"
        >
          <div className="flex items-center justify-between px-5 pt-[max(var(--safe-top),16px)]">
            <div className="text-[13px] font-semibold uppercase tracking-wide text-text-secondary">{t("os.switcher")}</div>
          </div>
          <div className="no-scrollbar flex flex-1 snap-x snap-mandatory items-center gap-4 overflow-x-auto px-[15vw]" onClick={(e) => e.stopPropagation()}>
            {items.map((w, i) => {
              const { Icon } = CLIENT_APPS[w.appId];
              return (
                <motion.div
                  key={w.id}
                  className="flex shrink-0 snap-center flex-col gap-3"
                  initial={{ opacity: 0, y: 40, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -200 }}
                  transition={{ delay: i * 0.04, duration: 0.35, ease: EASE }}
                  drag="y"
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0.9, bottom: 0.1 }}
                  onDragEnd={(_, info) => (info.offset.y < -120 || info.velocity.y < -800) && wm.close(w.id)}
                >
                  <div className="flex items-center gap-2 px-1">
                    <AppTile size={28}>
                      <Icon className="size-4" />
                    </AppTile>
                    <span className="text-[14px] font-semibold">{APP_REGISTRY[w.appId].name[lang]}</span>
                    <span className="flex-1" />
                    <IconButton label={t("os.closeApp", { app: APP_REGISTRY[w.appId].name[lang] })} size="sm" onClick={() => wm.close(w.id)}>
                      <RiCloseLine className="size-4" />
                    </IconButton>
                  </div>
                  <button
                    className="flex h-[58vh] w-[70vw] max-w-[320px] flex-col overflow-hidden rounded-[28px] bg-surface text-left shadow-window"
                    onClick={() => wm.focus(w.id)}
                    data-testid={`switcher-card-${w.appId}`}
                  >
                    <div className="flex h-14 items-center gap-2 border-b px-4">
                      <div className="h-3 w-24 rounded-full bg-surface-secondary" />
                    </div>
                    <div className="flex flex-1 flex-col items-center justify-center gap-3">
                      <AppTile size={84} glow>
                        <Icon className="size-12" />
                      </AppTile>
                      <span className="text-[16px] font-semibold">{APP_REGISTRY[w.appId].name[lang]}</span>
                    </div>
                  </button>
                </motion.div>
              );
            })}
          </div>
          <div className="pb-[max(var(--safe-bottom),20px)] text-center text-[12px] text-text-tertiary">{t("os.swipeHome")}</div>
        </motion.div>
      )}
    </AnimatePresence>
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

function Clock() {
  const lang = useLanguage();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="flex items-baseline gap-2 text-text-secondary">
      <span className="text-[15px] font-semibold tabular-nums text-text">{new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(now)}</span>
      <span className="hidden text-[13px] sm:inline">{formatDate(now, lang, { weekday: "short", day: "numeric", month: "long" })}</span>
    </div>
  );
}

function NineDots() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
      {[3.5, 10, 16.5].flatMap((y) => [3.5, 10, 16.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.9" fill="currentColor" />))}
    </svg>
  );
}
