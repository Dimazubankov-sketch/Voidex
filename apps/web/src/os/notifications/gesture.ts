import { useEffect } from "react";
import { animate, motionValue } from "motion/react";
import { inTopEdge } from "../metrics";
import { useNotificationCenter } from "./store";

/** Pull progress of the phone Notification Center: 0 hidden … 1 open. */
export const ncPull = motionValue(0);

const ENGAGE_PX = 12;
const OPEN_AT = 0.28;

/**
 * Gesture priority on phones (Step 2.3) — one place decides who owns a touch:
 *
 *   1. starts in the top edge zone (safe area + 28 px), moves down
 *        → Notification Center (on the home screen AND inside apps)
 *   2. starts in the left edge zone inside an app with a side menu
 *        → that app's edge swipe (Vibex), see useEdgeSwipe
 *   3. anything else → the surface below: home pages / pull-down search /
 *        icon drag, or the app's own scrolling.
 *
 * The edge gesture listens in the capture phase and only takes over after a
 * clear downward drag (no accidental opening on taps); once engaged it blocks
 * the browser's scrolling for that touch and swallows the click that follows.
 */
export function useTopEdgeGesture(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let active: { id: number; x: number; y: number; t: number; engaged: boolean } | null = null;
    let swallowClick = false;

    const down = (e: PointerEvent) => {
      if (e.button !== 0 || useNotificationCenter.getState().open || !inTopEdge(e.clientY)) return;
      active = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), engaged: false };
    };
    const move = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.id) return;
      const dx = e.clientX - active.x;
      const dy = e.clientY - active.y;
      if (!active.engaged) {
        if (dy < ENGAGE_PX || Math.abs(dx) > dy) {
          if (Math.abs(dx) > ENGAGE_PX * 2 || dy < -ENGAGE_PX) active = null; // sideways / up: not ours
          return;
        }
        active.engaged = true;
      }
      ncPull.set(Math.max(0, Math.min(1, dy / (window.innerHeight * 0.55))));
    };
    const finish = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.id) return;
      const a = active;
      active = null;
      if (!a.engaged) return;
      swallowClick = true;
      window.setTimeout(() => (swallowClick = false), 400);
      const dy = e.clientY - a.y;
      const v = dy / Math.max(1, performance.now() - a.t);
      if (ncPull.get() > OPEN_AT || v > 0.8) useNotificationCenter.getState().setOpen(true);
      else void animate(ncPull, 0, { duration: 0.22 });
    };
    // While engaged the page must not scroll under the finger.
    const touchMove = (e: TouchEvent) => {
      if (active?.engaged && e.cancelable) e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };

    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    window.addEventListener("touchmove", touchMove, { capture: true, passive: false });
    window.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      window.removeEventListener("touchmove", touchMove, true);
      window.removeEventListener("click", click, true);
    };
  }, [enabled]);
}
