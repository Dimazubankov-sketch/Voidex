import { motionValue } from "motion/react";

/** Horizontal travel (px) that switches apps; it must also clearly beat the vertical travel. */
export const SWITCH_THRESHOLD = 56;
/** Upward travel (px) below which a release puts the app back. */
export const SWITCHER_MIN_UP = 64;

/**
 * Pure decision of the phone gesture bar: what a finished swipe does.
 *
 *   sideways (distance, or a quick flick)   → the app opened before / after
 *   up, released in the middle              → the app switcher
 *   up far (≈40 % of the screen) or a fast flick up → home
 *   too small                               → the app goes back to its place
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
  if (up < 40) return null;
  if (up > height * 0.4 || (-vy > 900 && up > 80)) return "home";
  if (up >= SWITCHER_MIN_UP) return "switcher";
  return null;
}

/**
 * Step 2.9: the live position of the foreground app while the gesture bar is
 * dragged (the window follows the finger). 0/0 = at rest.
 */
export const barDrag = { x: motionValue(0), y: motionValue(0) };

/** How small the app gets while dragged up by `up` px on a screen `height` px tall. */
export function dragScale(up: number, height: number): number {
  if (up <= 0) return 1;
  return Math.max(0.5, 1 - (up / Math.max(height, 1)) * 0.9);
}

/** Corner radius of the dragged app (it turns into a card). */
export function dragRadius(up: number): number {
  return Math.max(0, Math.min(34, up / 4));
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
