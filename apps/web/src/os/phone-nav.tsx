import { useRef } from "react";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { useHomeUi } from "./home/ui-store";
import { useNotificationCenter } from "./notifications/store";
import { foregroundId, useWM } from "./window-manager";

/**
 * Step 2.15: phone system navigation (Settings → Desktop → «Навигация»).
 *
 *   «Полоской»   the gesture bar: in an app it is the home indicator of the
 *                window (see window-frame.tsx); on the home screen a swipe up
 *                on it opens the app switcher.
 *   «Кнопками»   three system buttons at the bottom: back, home, open apps.
 */

/** Event sent to the foreground app on «Назад»; an app that went back itself calls preventDefault(). */
export const BACK_EVENT = "voidex:back";
export type BackEventDetail = { windowId: string };

/** A dialog / menu that is on screen now (not one kept mounted out of sight, like the closed Notification Center). */
function openDialog(): boolean {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"]')].some((el) => {
    if (el.closest('[aria-hidden="true"]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
  });
}

/** Closes the top system layer (or dialog) if there is one. */
function closeTopLayer(): boolean {
  const nc = useNotificationCenter.getState();
  if (nc.open) {
    nc.setOpen(false);
    return true;
  }
  const wm = useWM.getState();
  if (wm.switcherOpen) {
    wm.setSwitcher(false);
    return true;
  }
  const ui = useHomeUi.getState();
  if (ui.menu) return ui.closeMenu(), true;
  if (ui.search.open) return ui.setSearch({ open: false, query: "" }), true;
  if (ui.widgetsOpen) return ui.setWidgetsOpen(false), true;
  if (ui.brushOpen) return ui.setBrushOpen(false), true;
  if (ui.launcherOpen) return ui.setLauncherOpen(false), true;
  if (ui.openFolder) return ui.setOpenFolder(null), true;
  // A sheet or dialog (shell or app) that is really on screen: they all close on Escape.
  if (openDialog()) {
    const target = (document.activeElement as HTMLElement | null) ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    return true;
  }
  if (ui.editing) return ui.setEditing(false), true;
  return false;
}

/**
 * «Назад»: the top layer closes; otherwise the foreground app goes one step
 * back (it listens for BACK_EVENT); at its first screen the app goes home.
 */
export function systemBack() {
  if (closeTopLayer()) return;
  const wm = useWM.getState();
  const fg = foregroundId(wm);
  if (!fg) return;
  const ev = new CustomEvent<BackEventDetail>(BACK_EVENT, { detail: { windowId: fg }, cancelable: true });
  window.dispatchEvent(ev);
  if (!ev.defaultPrevented) wm.goHome();
}

export function systemHome() {
  useNotificationCenter.getState().setOpen(false);
  useHomeUi.getState().setSearch({ open: false, query: "" });
  useWM.getState().goHome();
}

export function systemRecents() {
  useNotificationCenter.getState().setOpen(false);
  const wm = useWM.getState();
  wm.setSwitcher(!wm.switcherOpen);
}

/** Lets an app handle «Назад» for its own window (return true when it went back). */
export function onSystemBack(windowId: string, handler: () => boolean) {
  const h = (e: Event) => {
    const d = (e as CustomEvent<BackEventDetail>).detail;
    if (d?.windowId === windowId && handler()) e.preventDefault();
  };
  window.addEventListener(BACK_EVENT, h);
  return () => window.removeEventListener(BACK_EVENT, h);
}

/** Height of the button bar (without the safe area). */
export const NAV_BUTTONS_H = 48;

/** «Кнопками»: back (triangle), home (circle), open apps (square). */
export function NavButtons({ className }: { className?: string }) {
  const t = useT();
  const btn = "pressable flex h-full w-[76px] items-center justify-center rounded-full text-text/75 hover:text-text active:bg-text/[0.06]";
  return (
    <nav
      className={cx("vx-nav-buttons relative flex shrink-0 select-none items-start justify-center gap-6 sm:gap-10", className)}
      style={{ height: `calc(${NAV_BUTTONS_H}px + var(--safe-bottom))` }}
      aria-label={t("os.navigation")}
      data-no-home-gesture
      data-testid="nav-buttons"
    >
      <div className="flex items-center justify-center gap-6 sm:gap-10" style={{ height: NAV_BUTTONS_H }}>
        <button type="button" className={btn} onClick={systemBack} aria-label={t("os.navBack")} title={t("os.navBack")} data-testid="nav-back">
          <svg viewBox="0 0 24 24" className="size-[20px]" aria-hidden>
            <path d="M16.5 4.8v14.4a.8.8 0 0 1-1.2.7L4.9 12.7a.8.8 0 0 1 0-1.4l10.4-7.2a.8.8 0 0 1 1.2.7Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className={btn} onClick={systemHome} aria-label={t("os.navHome")} title={t("os.navHome")} data-testid="nav-home">
          <svg viewBox="0 0 24 24" className="size-[21px]" aria-hidden>
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
        <button type="button" className={btn} onClick={systemRecents} aria-label={t("os.switcher")} title={t("os.switcher")} data-testid="nav-recents">
          <svg viewBox="0 0 24 24" className="size-[19px]" aria-hidden>
            <rect x="5" y="5" width="14" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>
    </nav>
  );
}

/**
 * «Полоской» on the home screen: the same bar as in apps. A swipe up opens
 * the app switcher (there is no app to shrink, the switcher simply comes).
 */
export function HomeGestureBar() {
  const t = useT();
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  return (
    <div
      className="relative flex h-[calc(22px+var(--safe-bottom))] shrink-0 cursor-grab touch-none select-none items-start justify-center"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointer */
        }
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        // Up far enough: the switcher opens while the finger is still moving (like the bar in an app).
        if (s.y - e.clientY > 36 && Math.abs(e.clientX - s.x) < (s.y - e.clientY) * 1.4) {
          start.current = null;
          useWM.getState().setSwitcher(true);
        }
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "Enter") useWM.getState().setSwitcher(true);
      }}
      role="button"
      tabIndex={0}
      aria-label={t("os.switcher")}
      data-no-home-gesture
      data-home-control
      data-testid="home-gesture-bar"
    >
      <div className="mt-2 h-[5px] w-32 rounded-full bg-text/80" />
    </div>
  );
}
