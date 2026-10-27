import { useEffect } from "react";
import { animate, motionValue } from "motion/react";
import { inTopEdge } from "../metrics";
import { useNotificationCenter } from "./store";

/** Pull progress of the phone Notification Center: 0 hidden … 1 open. */
export const ncPull = motionValue(0);

/**
 * Update 5 · 6: the release speed of the last pull (progress per second), handed to the settling spring so the
 * sheet carries on at the finger's speed — only after the finger is lifted, and bounded.
 */
export const ncFling = { v: 0 };
const FLING_MAX = 4;
/** Settles without overshoot (critically damped): the sheet never flies past where it stops. */
export const NC_SPRING = { type: "spring", stiffness: 380, damping: 40, restDelta: 0.001 } as const;
export const settleSpring = () => {
  const velocity = Math.max(-FLING_MAX, Math.min(FLING_MAX, ncFling.v));
  ncFling.v = 0;
  return { ...NC_SPRING, velocity };
};

/** Finger speed over the last ~100 ms (px per ms), not the average of the whole gesture. */
export function velocityTracker() {
  const pts: { y: number; t: number }[] = [];
  return {
    add(y: number) {
      const t = performance.now();
      pts.push({ y, t });
      while (pts.length > 2 && t - pts[0]!.t > 100) pts.shift();
    },
    get() {
      if (pts.length < 2) return 0;
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      return performance.now() - b.t > 120 ? 0 : (b.y - a.y) / Math.max(1, b.t - a.t);
    },
  };
}

const ENGAGE_PX = 12;
/** Open when the sheet came a third of the way down, or on a quick flick down. */
const OPEN_AT = 0.33;
const FLICK = 0.45;

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
    let active: { id: number; x: number; y: number; t: number; engaged: boolean; vt: ReturnType<typeof velocityTracker> } | null = null;
    let swallowClick = false;

    const down = (e: PointerEvent) => {
      if (e.button !== 0 || useNotificationCenter.getState().open || !inTopEdge(e.clientY)) return;
      active = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), engaged: false, vt: velocityTracker() };
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
      active.vt.add(e.clientY);
      // Update 5 · 6: 1 : 1 — the sheet's lower edge stays under the finger (it never runs ahead of it).
      ncPull.set(Math.max(0, Math.min(1, e.clientY / window.innerHeight)));
    };
    const finish = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.id) return;
      const a = active;
      active = null;
      if (!a.engaged) return;
      swallowClick = true;
      window.setTimeout(() => (swallowClick = false), 400);
      a.vt.add(e.clientY);
      const v = a.vt.get();
      ncFling.v = (v * 1000) / window.innerHeight;
      // A flick up cancels even past the threshold; a flick down opens even before it.
      const open = v > FLICK || (ncPull.get() > OPEN_AT && v > -FLICK);
      if (open) useNotificationCenter.getState().setOpen(true);
      else void animate(ncPull, 0, settleSpring());
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
