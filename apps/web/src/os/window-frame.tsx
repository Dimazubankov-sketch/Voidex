import { Component, Suspense, useCallback, useEffect, useMemo, useRef, type ErrorInfo, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { RiErrorWarningLine } from "@remixicon/react";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { cx } from "@/lib/cx";
import { Button, Spinner } from "@/ui/controls";
import { CLIENT_APPS } from "./app-registry";
import { AppLockGate } from "./app-lock";
import { WindowContext, type WindowApi } from "./window-context";
import { barDrag, dragRadius, dragScale, gestureBarAction, rubberUp, slideHints } from "./gesture-bar";
import { useGesturePeek } from "./gesture-peek";
import { captureWindow } from "./snapshots";
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
        <AppLockGate appId={win.appId} windowId={win.id}>
          <Suspense fallback={<AppLoading />}>
            <App />
          </Suspense>
        </AppLockGate>
      </AppBoundary>
    </WindowContext.Provider>
  );

  if (ff === "mobile") {
    const origin = win.origin;
    const slid = slideHints.get(win.id);
    const visible = fg && !minimized && !wm.switcherOpen;
    // Step 2.9: where a hidden window rests — slid out sideways (a gesture-bar switch), faded in
    // place under the switcher (the gesture already shrank it), or back into its icon.
    const hiddenTarget =
      slid !== undefined
        ? { x: slid, y: 0, scale: 1, opacity: 1, borderRadius: 0 }
        : wm.switcherOpen && fg
          ? { x: 0, y: 0, scale: 0.62, opacity: 0, borderRadius: 34 }
          : origin
            ? {
                x: origin.x + origin.w / 2 - bounds.w / 2,
                y: origin.y + origin.h / 2 - bounds.h / 2,
                scale: Math.max(0.12, origin.w / bounds.w),
                opacity: 0,
                borderRadius: 60,
              }
            : { x: 0, y: 40, scale: 0.9, opacity: 0, borderRadius: 30 };
    const enterFrom = visible ? slideHints.get(`enter:${win.id}`) : undefined;
    return (
      <motion.section
        aria-label={win.appId}
        data-testid={`window-${win.appId}`}
        data-state={visible ? "open" : "hidden"}
        data-window-id={win.id}
        className="absolute inset-0 flex flex-col"
        style={{ zIndex: z, pointerEvents: visible ? "auto" : "none", visibility: undefined }}
        initial={hiddenTarget}
        animate={
          visible
            ? enterFrom !== undefined
              ? { x: [enterFrom, 0], y: 0, scale: 1, opacity: 1, borderRadius: 0 }
              : { x: 0, y: 0, scale: 1, opacity: 1, borderRadius: 0 }
            : hiddenTarget
        }
        transition={slid !== undefined && !visible ? { duration: 0 } : enterFrom !== undefined ? { duration: 0.34, ease: EASE } : { duration: 0.42, ease: EASE }}
        onAnimationComplete={() => {
          if (visible) {
            slideHints.delete(win.id);
            slideHints.delete(`enter:${win.id}`);
          }
        }}
        aria-hidden={!visible}
      >
        <DraggedApp active={visible}>
          <div className="flex min-h-0 flex-1 flex-col pt-[var(--safe-top)]" data-window-content={win.id}>
            {content}
          </div>
          <HomeIndicator />
        </DraggedApp>
      </motion.section>
    );
  }

  // desktop
  const launcher = launcherRect();
  // Maximized: the whole area above the dock — the window layer already ends at the dock.
  const rect = maximized ? { x: GUTTER, y: GUTTER, w: bounds.w - GUTTER * 2, h: bounds.h - GUTTER } : win.rect;
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
        // Step 2.8: .vx-app carries the account's «Вид приложений» (tokens and background).
        "vx-app absolute left-0 top-0 flex flex-col overflow-hidden",
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
          <div className="absolute bottom-0 right-0 size-4 cursor-nwse-resize" onPointerDown={(e) => startResize(e, "se")} data-testid="window-resize-se" />
        </>
      )}
    </motion.section>
  );
}

/**
 * Step 2.9: the foreground app under the finger. While the gesture bar is
 * dragged the whole app moves with it, shrinks and rounds its corners, and
 * its neighbours come in beside it (see GesturePeek); at rest it is a plain
 * full-screen app.
 */
function DraggedApp({ active, children }: { active: boolean; children: ReactNode }) {
  const height = useWM((s) => s.bounds.h);
  // Step 2.10: each window has its own transform, always bound and back at 0 whenever it is not the one
  // under the finger. (Unbinding the shared values used to leave the last transform on the element, so an
  // app could come back shifted sideways or still scaled.)
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  useEffect(() => {
    if (!active) {
      x.set(0);
      y.set(0);
      return;
    }
    x.set(barDrag.x.get());
    y.set(barDrag.y.get());
    const offX = barDrag.x.on("change", (v) => x.set(v));
    const offY = barDrag.y.on("change", (v) => y.set(v));
    return () => {
      offX();
      offY();
      x.set(0);
      y.set(0);
    };
  }, [active, x, y]);
  const scale = useTransform(y, (v) => dragScale(-v, height));
  const radius = useTransform(y, (v) => dragRadius(-v));
  return (
    <motion.div
      className="vx-app relative flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ x, y, scale, borderRadius: radius, transformOrigin: "50% 100%" }}
      data-dragged-app
    >
      {children}
    </motion.div>
  );
}

const SETTLE = { type: "spring", stiffness: 520, damping: 46 } as const;

/** Sideways switch from the gesture bar: this app slides out, the other one slides in from the other side. */
function slideTo(dir: -1 | 1, width: number) {
  const s = useWM.getState();
  const from = s.focusedId;
  const list = Object.values(s.windows).sort((a, b) => a.openedAt - b.openedAt || a.id.localeCompare(b.id));
  const i = list.findIndex((w) => w.id === from);
  const next = i < 0 ? undefined : list[i + dir];
  if (!from || !next) return false;
  // Right swipe (dir -1, the app before): this one leaves to the right, the other enters from the left.
  const out = dir === -1 ? width : -width;
  slideHints.set(from, out);
  slideHints.delete(next.id);
  slideHints.set(`enter:${next.id}`, -out);
  barDrag.x.set(0);
  barDrag.y.set(0);
  return s.switchAdjacent(dir);
}

/**
 * iPhone-style home indicator (Step 2.9: the app follows the finger):
 *   drag up      the app moves up with the finger, shrinks into a card, the
 *                other open apps appear beside it
 *   release      in the middle → the app switcher; far up or a flick → home;
 *                a small move → the app settles back
 *   sideways     the app slides with the finger; past the threshold (or a
 *                flick) the previous / next app slides in
 * Velocity and distance decide; pointercancel puts everything back; with
 * reduced motion the result is applied without the travel.
 */
function HomeIndicator() {
  const t = useT();
  const goHome = useWM((s) => s.goHome);
  const setSwitcher = useWM((s) => s.setSwitcher);
  const reduced = useReducedMotion();
  const start = useRef<{ x: number; y: number; at: number; id: number; axis: "x" | "y" | null; samples: { x: number; y: number; t: number }[] } | null>(null);
  const settle = () => {
    if (reduced) {
      barDrag.x.set(0);
      barDrag.y.set(0);
      return;
    }
    // Always ends at exactly 0: a spring that "rests" a pixel short would leave the app shifted.
    for (const v of [barDrag.x, barDrag.y]) void animate(v, 0, { ...SETTLE, restDelta: 0.01, restSpeed: 0.5, onComplete: () => v.set(0) });
  };
  const reset = () => {
    start.current = null;
    useGesturePeek.setState({ active: false });
    settle();
  };
  return (
    <div
      className="vx-home-indicator relative flex h-[calc(22px+var(--safe-bottom))] shrink-0 cursor-grab touch-none select-none items-start justify-center"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const fg = foregroundId(useWM.getState());
        // The switcher card shows exactly this screen.
        if (fg) captureWindow(fg);
        start.current = { x: e.clientX, y: e.clientY, at: performance.now(), id: e.pointerId, axis: null, samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s0 = start.current;
        if (!s0 || s0.id !== e.pointerId) return;
        const dx = e.clientX - s0.x;
        const dy = e.clientY - s0.y;
        s0.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
        if (s0.samples.length > 6) s0.samples.shift();
        if (!s0.axis) {
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
          s0.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
          useGesturePeek.setState({ active: true, axis: s0.axis });
        }
        if (reduced) return;
        const height = useWM.getState().bounds.h;
        if (s0.axis === "y") {
          barDrag.y.set(rubberUp(dy, height));
          barDrag.x.set(dx * 0.6);
        } else {
          barDrag.x.set(dx);
          barDrag.y.set(Math.min(0, dy) * 0.2);
        }
      }}
      onPointerUp={(e) => {
        const s0 = start.current;
        start.current = null;
        if (!s0 || s0.id !== e.pointerId) return reset();
        const now = performance.now();
        const first = s0.samples[0]!;
        const dt = Math.max(1, now - first.t);
        const vx = ((e.clientX - first.x) / dt) * 1000;
        const vy = ((e.clientY - first.y) / dt) * 1000;
        const { w, h } = useWM.getState().bounds;
        const action = gestureBarAction(e.clientX - s0.x, e.clientY - s0.y, now - s0.at, { vx, vy, height: h });
        useGesturePeek.setState({ active: false });
        if (action === "prev" || action === "next") {
          if (!slideTo(action === "prev" ? -1 : 1, w)) settle();
          return;
        }
        if (action === "home") goHome();
        else if (action === "switcher") setSwitcher(true);
        settle();
      }}
      onPointerCancel={reset}
      onLostPointerCapture={() => start.current && reset()}
      aria-label={t("os.swipeHome")}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") goHome();
        else if (e.key === "ArrowUp") setSwitcher(true);
        else if (e.key === "ArrowLeft") slideTo(-1, useWM.getState().bounds.w);
        else if (e.key === "ArrowRight") slideTo(1, useWM.getState().bounds.w);
      }}
      data-testid="home-indicator"
    >
      <div className="mt-2 h-[5px] w-32 rounded-full bg-text/80" />
    </div>
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
