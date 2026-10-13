import { motionValue } from "motion/react";

/** Horizontal travel (px) that switches apps; it must also clearly beat the vertical travel. */
export const SWITCH_THRESHOLD = 56;
/** Upward travel (px) below which a release puts the app back (Step 2.10: a small gesture). */
export const SWITCHER_MIN_UP = 48;
/** Release speed up (px/s) that counts as a quick flick: straight home. */
export const FLICK_HOME_VY = 1400;

/**
 * Pure decision of the phone gesture bar: what a finished swipe does.
 *
 *   sideways (distance, or a quick flick)           → the app opened before / after
 *   a small move up (< 48 px)                       → the app goes back to its place
 *   a quick sharp flick up                          → home
 *   held and dragged high (≈40 % of the screen)     → home
 *   anything in between (a short smooth swipe, or
 *   held in the middle and released)                → the app glides into the switcher
 *
 * `vx` / `vy` are the release velocities in px/s (up is negative), `height`
 * the screen height.
 */
export function gestureBarAction(dx: number, dy: number, ms: number, opts: { vx?: number; vy?: number; height?: number } = {}): "prev" | "next" | "home" | "switcher" | null {
  const up = -dy;
  const height = opts.height ?? 800;
  const vx = opts.vx ?? (dx / Math.max(ms, 1)) * 1000;
  const vy = opts.vy ?? (dy / Math.max(ms, 1)) * 1000;
  const sideways = Math.abs(dx) > Math.abs(dy) * 1.4;
  if (sideways && (Math.abs(dx) >= SWITCH_THRESHOLD || (Math.abs(dx) >= 24 && Math.abs(vx) > 650))) return dx > 0 ? "prev" : "next";
  if (up < SWITCHER_MIN_UP) return null;
  if (up > height * 0.4) return "home";
  if (-vy > FLICK_HOME_VY && up > 72) return "home";
  return "switcher";
}

/**
 * Step 2.9: the live position of the foreground app while the gesture bar is
 * dragged (the window follows the finger). 0/0 = at rest.
 */
export const barDrag = { x: motionValue(0), y: motionValue(0) };
// Step 2.10: motion stops a value's animation once nothing listens to it. When the switcher opens the
// app stops listening mid-settle, and the spring froze a pixel or two short: the app came back shifted
// sideways. A permanent observer keeps the settle running until it really is back at 0.
for (const v of [barDrag.x, barDrag.y]) v.on("change", () => {});

/**
 * How small the app gets while dragged up by `up` px on a screen `height` px
 * tall. Step 2.11 (the reference video): it shrinks quickly at first (about
 * 0.63 at a fifth of the screen) and then more slowly, never below 0.42.
 */
export function dragScale(up: number, height: number): number {
  if (up <= 0) return 1;
  const k = up / Math.max(height * 0.18, 1);
  return Math.max(0.42, 1 - 0.55 * (1 - Math.exp(-k)));
}

/** Corner radius of the dragged app (it turns into a card at once, like the phone's own corners). */
export function dragRadius(up: number): number {
  if (up <= 0) return 0;
  return Math.min(64, 26 + up * 0.5);
}

/**
 * Step 2.11: the dragged app as one transform about its centre (the window
 * itself moves; nothing inside it): the card shrinks towards the finger
 * with its bottom edge following it. `x` / `y` are the bar's drag.
 */
export function dragPose(x: number, y: number, height: number) {
  const s = dragScale(-y, height);
  return { x, y: y + (height / 2) * (1 - s), scale: s, borderRadius: dragRadius(-y) };
}

/**
 * Upward drag with resistance: the window follows the finger 1:1 at first
 * and slows down near the top, so it never leaves the screen.
 */
export function rubberUp(dy: number, height: number): number {
  if (dy >= 0) return dy * 0.15;
  const up = -dy;
  const limit = height * 0.72;
  return -(up < limit * 0.7 ? up : limit * 0.7 + (up - limit * 0.7) * 0.35);
}

/**
 * Where an app slid out to on a sideways switch (window id → x px). The window
 * stays there (out of sight) until it is shown again, so nothing flashes back
 * across the screen.
 */
export const slideHints = new Map<string, number>();
