/** Horizontal travel (px) that switches apps; it must also clearly beat the vertical travel. */
export const SWITCH_THRESHOLD = 56;

/**
 * Pure decision of the phone gesture bar: what a finished swipe does.
 * Right → the app opened before this one, left → the one after; up → home,
 * a shorter swipe up → the app switcher.
 */
export function gestureBarAction(dx: number, dy: number, ms: number): "prev" | "next" | "home" | "switcher" | null {
  const up = -dy;
  if (Math.abs(dx) >= SWITCH_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.4) return dx > 0 ? "prev" : "next";
  if (up < 40) return null;
  const speed = (up / Math.max(ms, 1)) * 1000;
  return up > 160 || speed > 700 ? "home" : "switcher";
}
