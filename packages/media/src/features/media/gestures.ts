/** Density changes are bounded and directional: spreading fingers enlarges tiles. */
export const galleryDensity = (n: number) => Math.max(2, Math.min(8, Math.round(n)));
export function pinchStep(ratio: number): number {
  return ratio > 1.2 ? -1 : ratio < 0.83 ? 1 : 0;
}
export function swipeSection(dx: number, dy: number): "library" | "collections" | null {
  return Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.8 ? (dx < 0 ? "collections" : "library") : null;
}

/** Horizontal gestures browse next to the left and previous to the right. */
export function swipeDirection(dx: number, dy: number, threshold = 60): -1 | 0 | 1 {
  return Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5 ? (dx < 0 ? 1 : -1) : 0;
}
/** Ignore pinch zoom; a resized layout viewport already excludes the keyboard. */
export function keyboardInset(layoutHeight: number, visibleHeight: number, offsetTop: number, scale = 1): number {
  return Math.abs(scale - 1) < 0.05 ? Math.max(0, layoutHeight - visibleHeight - offsetTop) : 0;
}
