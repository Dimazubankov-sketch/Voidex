/** Height of the PC system bar; windows (also maximized) start below it. */
export const SYSTEM_BAR_H = 40;

/**
 * Edge zones of the system gestures (Step 2.3), in CSS px from the edge.
 * A touch that STARTS inside one belongs to the system gesture, never to the
 * app or the home screen underneath:
 *   top    → Notification Center (phone, everywhere)
 *   left   → apps with a side menu (Vibex), back gestures
 */
export const TOP_EDGE_PX = 28;
export const LEFT_EDGE_PX = 22;

let probe: HTMLDivElement | null = null;
/** Safe-area inset at the top (iOS notch / status bar) in px — env() resolved by a hidden probe. */
export function safeTop(): number {
  if (typeof document === "undefined") return 0;
  if (!probe) {
    probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px)";
    document.body.appendChild(probe);
  }
  return Number.parseFloat(getComputedStyle(probe).paddingTop) || 0;
}

/** A touch starting here opens the Notification Center (never search, never the app). */
export function inTopEdge(y: number): boolean {
  return y <= safeTop() + TOP_EDGE_PX;
}
