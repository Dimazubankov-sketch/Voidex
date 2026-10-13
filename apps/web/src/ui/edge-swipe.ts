import { useEffect, useRef, type RefObject } from "react";
import { animate } from "motion/react";
import { inTopEdge } from "@/os/metrics";
import { ownedByChild } from "@/os/gesture-priority";
import type { MotionValue } from "motion/react";

const ENGAGE_PX = 12;

/**
 * Phones: a swipe to the right opens the app's side drawer (PushDrawer),
 * following the finger; the drawer closes with a swipe to the left. Shared
 * by Vibex and Mail. Past ~35 % of the drawer (or a quick flick) it opens; a
 * small move puts it back.
 *
 * Step 2.10: the swipe may start anywhere on the screen, not only at its left
 * edge. What stays out (os/gesture-priority):
 *   - a touch from the top edge (the Notification Center's);
 *   - players, seek bars and carousels (data-gesture-owner);
 *   - anything that scrolls sideways itself (the stories strip, galleries);
 *   - text fields (a drag there selects text);
 *   - a move that is not clearly horizontal (vertical scrolling stays native).
 */
export function useEdgeSwipe(
  root: RefObject<HTMLElement | null>,
  opts: { enabled: boolean; onOpen: () => void; progress: MotionValue<number>; width: number },
) {
  const o = useRef(opts);
  o.current = opts;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let active: { id: number; x: number; y: number; t: number; engaged: boolean } | null = null;
    let swallow = false;

    const down = (e: PointerEvent) => {
      if (!o.current.enabled || e.button !== 0 || inTopEdge(e.clientY)) return;
      // Step 2.9: players (voice waveform, circle ring, carousels) own the drags that start on them.
      if (ownedByChild(e.target) || inSideScroller(e.target, el) || (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]")) return;
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
        // Something is being dragged by hand (a pinned chat lifted to reorder): not the menu.
        if (el.querySelector("[data-lifted]")) {
          active = null;
          return;
        }
        active.engaged = true;
        // Step 2.11: a close animation still running (swipe-open right after a close) yields to the finger.
        o.current.progress.stop();
      }
      const p = o.current.progress;
      // The drawer is never wider than 84 % of the app (see PushDrawer).
      p.set(Math.max(0, Math.min(1, dx / Math.min(o.current.width, el.clientWidth * 0.84))));
    };
    const up = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.id) return;
      const a = active;
      active = null;
      if (!a.engaged) return;
      swallow = true;
      window.setTimeout(() => (swallow = false), 350);
      const v = (e.clientX - a.x) / Math.max(1, performance.now() - a.t);
      if (o.current.progress.get() > 0.35 || v > 0.6) o.current.onOpen();
      else void animate(o.current.progress, 0, { duration: 0.2 });
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

/** Is the touch on something that scrolls sideways by itself (between the target and the app root)? */
function inSideScroller(target: EventTarget | null, root: HTMLElement): boolean {
  for (let n = target as HTMLElement | null; n && n !== root; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
  }
  return false;
}
