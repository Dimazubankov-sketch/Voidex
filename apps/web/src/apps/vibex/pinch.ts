import { useEffect, useRef, type RefObject } from "react";

/**
 * Step 2.11: two-finger pinch on one element (a video circle). Only that
 * element zooms: the page never does (the touches are taken: touch-action
 * none + preventDefault while two fingers are down). `begin` returns the
 * zoom at the start of a pinch; `change` gets the new one (the caller clamps:
 * never below 1x).
 */
export function usePinch(ref: RefObject<HTMLElement | null>, opts: { enabled: boolean; begin: () => number; change: (zoom: number) => void; end?: () => void }) {
  const o = useRef(opts);
  o.current = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el || !opts.enabled) return;
    let start: { dist: number; zoom: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      start = { dist: Math.max(1, dist(e.touches)), zoom: o.current.begin() };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      o.current.change(start.zoom * (dist(e.touches) / start.dist));
    };
    const onEnd = (e: TouchEvent) => {
      if (start && e.touches.length < 2) {
        start = null;
        o.current.end?.();
      }
    };
    // Safari's own pinch events: never zoom the page from here.
    const stopGesture = (e: Event) => e.preventDefault();
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    el.addEventListener("gesturestart", stopGesture as EventListener, { passive: false });
    el.addEventListener("gesturechange", stopGesture as EventListener, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("gesturestart", stopGesture as EventListener);
      el.removeEventListener("gesturechange", stopGesture as EventListener);
    };
  }, [ref, opts.enabled]);
}
