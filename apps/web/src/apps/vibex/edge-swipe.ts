import { useEffect, useRef, type RefObject } from "react";
import { animate } from "motion/react";
import { LEFT_EDGE_PX, inTopEdge } from "@/os/metrics";
import { DRAWER_WIDTH, drawerProgress } from "./sidebar";

const ENGAGE_PX = 12;

/**
 * Phones: a swipe from the LEFT EDGE of the app opens the Vibex side menu,
 * following the finger (the drawer closes with a swipe to the left).
 *
 * Priority (see os/notifications/gesture.ts): a touch from the top edge is the
 * Notification Center's; only touches starting within LEFT_EDGE_PX of the
 * app's left side are considered here, and only a clearly horizontal move
 * engages — vertical scrolling, horizontal media swipes (which start away
 * from the edge) and the browser's own back gesture (which starts outside the
 * page, at the screen edge on iOS) are left alone.
 */
export function useEdgeSwipe(root: RefObject<HTMLElement | null>, opts: { enabled: boolean; onOpen: () => void }) {
  const o = useRef(opts);
  o.current = opts;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let active: { id: number; x: number; y: number; t: number; engaged: boolean } | null = null;
    let swallow = false;

    const down = (e: PointerEvent) => {
      if (!o.current.enabled || e.button !== 0 || inTopEdge(e.clientY)) return;
      const left = el.getBoundingClientRect().left;
      if (e.clientX - left > LEFT_EDGE_PX) return;
      active = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), engaged: false };
    };
    const move = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.id) return;
      const dx = e.clientX - active.x;
      const dy = e.clientY - active.y;
      if (!active.engaged) {
        if (Math.abs(dy) > ENGAGE_PX && Math.abs(dy) > dx) {
          active = null; // vertical: the page scrolls
          return;
        }
        if (dx < ENGAGE_PX || dx < Math.abs(dy) * 1.3) return;
        active.engaged = true;
      }
      drawerProgress.set(Math.max(0, Math.min(1, dx / DRAWER_WIDTH)));
    };
    const up = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.id) return;
      const a = active;
      active = null;
      if (!a.engaged) return;
      swallow = true;
      window.setTimeout(() => (swallow = false), 350);
      const v = (e.clientX - a.x) / Math.max(1, performance.now() - a.t);
      if (drawerProgress.get() > 0.35 || v > 0.6) o.current.onOpen();
      else void animate(drawerProgress, 0, { duration: 0.2 });
    };
    const touchMove = (e: TouchEvent) => {
      if (active?.engaged && e.cancelable) e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    el.addEventListener("touchmove", touchMove, { capture: true, passive: false });
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      el.removeEventListener("touchmove", touchMove, true);
      el.removeEventListener("click", click, true);
    };
  }, [root]);
}
