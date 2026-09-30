import { Component, Suspense, useCallback, useMemo, useRef, type ErrorInfo, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion, type PanInfo } from "motion/react";
import { RiErrorWarningLine } from "@remixicon/react";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { cx } from "@/lib/cx";
import { Button, Spinner } from "@/ui/controls";
import { CLIENT_APPS } from "./app-registry";
import { WindowContext, type WindowApi } from "./window-context";
import { foregroundId, useWM, type AppWindow, type Rect } from "./window-manager";

const EASE = [0.22, 1, 0.36, 1] as const;
const GUTTER = 10;

/** One app window. Desktop: floating, draggable, resizable. Mobile: full-screen card. */
export function WindowFrame({ win, launcherRect }: { win: AppWindow; launcherRect: () => Rect | null }) {
  const ff = useFormFactor();
  const wm = useWM();
  const z = wm.order.indexOf(win.id) + 10;
  const focused = wm.focusedId === win.id;
  const fg = foregroundId(wm) === win.id;
  // PC virtual desktops: windows of other desktops step aside (they keep their state).
  const offSpace = ff === "desktop" && win.space !== wm.space;
  const minimized = win.state === "minimized" || offSpace;
  const maximized = win.state === "maximized";
  const { bounds } = wm;

  const dragStart = useRef<{ px: number; py: number; rect: Rect } | null>(null);
  const startDrag = useCallback(
    (e: ReactPointerEvent) => {
      if (maximized || e.button !== 0) return;
      const cur = useWM.getState().windows[win.id];
      if (!cur) return;
      dragStart.current = { px: e.clientX, py: e.clientY, rect: cur.rect };
      const move = (ev: PointerEvent) => {
        const s = dragStart.current;
        if (!s) return;
        useWM.getState().setRect(win.id, { ...s.rect, x: s.rect.x + ev.clientX - s.px, y: s.rect.y + ev.clientY - s.py });
      };
      const up = () => {
        dragStart.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      document.body.style.cursor = "grabbing";
    },
    [maximized, win.id],
  );

  const startResize = (e: ReactPointerEvent, edge: "e" | "s" | "se") => {
    e.stopPropagation();
    e.preventDefault();
    const s = { px: e.clientX, py: e.clientY, rect: win.rect };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - s.px;
      const dy = ev.clientY - s.py;
      useWM.getState().setRect(win.id, {
        ...s.rect,
        w: edge === "s" ? s.rect.w : s.rect.w + dx,
        h: edge === "e" ? s.rect.h : s.rect.h + dy,
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const api: WindowApi = useMemo(
    () => ({
      windowId: win.id,
      appId: win.appId,
      formFactor: ff,
      focused,
      maximized,
      params: win.params,
      paramsVersion: win.paramsVersion,
      startDrag: ff === "desktop" ? startDrag : undefined,
      toggleMaximize: () => wm.toggleMaximize(win.id),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [win.id, win.appId, ff, focused, maximized, win.params, win.paramsVersion, startDrag],
  );

  const App = CLIENT_APPS[win.appId].Component;
  const content = (
    <WindowContext.Provider value={api}>
      <AppBoundary>
        <Suspense fallback={<AppLoading />}>
          <App />
        </Suspense>
      </AppBoundary>
    </WindowContext.Provider>
  );

  if (ff === "mobile") {
    const origin = win.origin;
    const hiddenTarget = origin
      ? {
          x: origin.x + origin.w / 2 - bounds.w / 2,
          y: origin.y + origin.h / 2 - bounds.h / 2,
          scale: Math.max(0.12, origin.w / bounds.w),
          opacity: 0,
          borderRadius: 60,
        }
      : { x: 0, y: 40, scale: 0.9, opacity: 0, borderRadius: 30 };
    const visible = fg && !minimized && !wm.switcherOpen;
    return (
      <motion.section
        aria-label={win.appId}
        data-testid={`window-${win.appId}`}
        data-state={visible ? "open" : "hidden"}
        className="absolute inset-0 flex flex-col overflow-hidden bg-surface"
        style={{ zIndex: z, pointerEvents: visible ? "auto" : "none", visibility: undefined }}
        initial={hiddenTarget}
        animate={visible ? { x: 0, y: 0, scale: 1, opacity: 1, borderRadius: 0 } : hiddenTarget}
        transition={{ duration: 0.42, ease: EASE }}
        aria-hidden={!visible}
      >
        <div className="flex min-h-0 flex-1 flex-col pt-[var(--safe-top)]">{content}</div>
        <HomeIndicator />
      </motion.section>
    );
  }

  // desktop
  const launcher = launcherRect();
  const rect = maximized ? { x: GUTTER, y: GUTTER, w: bounds.w - GUTTER * 2, h: bounds.h - GUTTER * 2 } : win.rect;
  const minimizedTarget = offSpace
    ? { x: rect.x - 80, y: rect.y, scale: 0.97, opacity: 0 }
    : launcher
    ? { x: launcher.x + launcher.w / 2 - rect.w / 2, y: launcher.y - rect.h / 2, scale: 0.08, opacity: 0 }
    : { x: rect.x, y: rect.y + 60, scale: 0.9, opacity: 0 };
  const openFrom = win.origin
    ? { x: win.origin.x + win.origin.w / 2 - rect.w / 2, y: win.origin.y + win.origin.h / 2 - rect.h / 2, scale: 0.12, opacity: 0 }
    : { x: rect.x, y: rect.y + 16, scale: 0.96, opacity: 0 };

  return (
    <motion.section
      aria-label={win.appId}
      data-testid={`window-${win.appId}`}
      data-state={minimized ? "hidden" : "open"}
      className={cx(
        "absolute left-0 top-0 flex flex-col overflow-hidden bg-surface",
        maximized ? "rounded-[22px]" : "rounded-[22px]",
        focused ? "shadow-window" : "shadow-surface",
      )}
      style={{ zIndex: z, width: rect.w, height: rect.h, pointerEvents: minimized ? "none" : "auto", transformOrigin: "center" }}
      initial={openFrom}
      animate={minimized ? minimizedTarget : { x: rect.x, y: rect.y, scale: 1, opacity: 1 }}
      transition={dragStart.current ? { duration: 0 } : { duration: 0.34, ease: EASE }}
      onPointerDownCapture={() => !focused && wm.focus(win.id)}
      aria-hidden={minimized}
    >
      {!focused && <div className="pointer-events-none absolute inset-0 z-50 rounded-[inherit] bg-background/25" />}
      {content}
      {!maximized && (
        <>
          <div className="absolute inset-y-4 right-0 w-2 cursor-ew-resize" onPointerDown={(e) => startResize(e, "e")} />
          <div className="absolute inset-x-4 bottom-0 h-2 cursor-ns-resize" onPointerDown={(e) => startResize(e, "s")} />
          <div className="absolute bottom-0 right-0 size-4 cursor-nwse-resize" onPointerDown={(e) => startResize(e, "se")} />
        </>
      )}
    </motion.section>
  );
}

/** iPhone-style home indicator: swipe up → workspace, swipe up and hold → app switcher. */
function HomeIndicator() {
  const t = useT();
  const goHome = useWM((s) => s.goHome);
  const setSwitcher = useWM((s) => s.setSwitcher);
  const onEnd = (_: unknown, info: PanInfo) => {
    const dy = -info.offset.y;
    if (dy < 40) return;
    if (dy > 160 || -info.velocity.y > 700) goHome();
    else setSwitcher(true);
  };
  return (
    <motion.div
      className="relative flex h-[calc(22px+var(--safe-bottom))] shrink-0 cursor-grab touch-none items-start justify-center"
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.3, bottom: 0 }}
      dragSnapToOrigin
      onDragEnd={onEnd}
      aria-label={t("os.swipeHome")}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && goHome()}
      data-testid="home-indicator"
    >
      <div className="mt-2 h-[5px] w-32 rounded-full bg-text/80" />
    </motion.div>
  );
}

function AppLoading() {
  const t = useT();
  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-[14px] text-text-secondary">
      <Spinner className="text-primary" /> {t("os.loadingApp")}
    </div>
  );
}

class AppBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App crashed", error, info.componentStack);
  }
  override render() {
    if (this.state.error) return <AppCrashed onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

function AppCrashed({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <RiErrorWarningLine className="size-10 text-danger" />
      <div className="font-semibold">{t("os.appFailed")}</div>
      <Button variant="secondary" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
