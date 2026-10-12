/**
 * Step 2.10 — who owns a touch that could mean several things.
 *
 * One rule for the whole system, highest first:
 *
 *   1. circle seek      (the ring of a playing video circle)
 *   2. voice seek       (the waveform of a voice message)
 *   3. swipe to reply   (a message dragged to the left)
 *   4. chat scroll      (vertical, native)
 *   5. chat swipe back  (a chat page dragged to the right)
 *   6. shell gesture bar (only from the home indicator at the bottom)
 *
 * Players and other owners of a drag mark their element with
 * `data-gesture-owner` (optionally with a name, e.g. "circle-seek"); every
 * lower-priority gesture asks `ownedByChild` on pointerdown and stays out.
 * Scrolling is the browser's (touch-action: pan-y), so a horizontal gesture
 * only engages once the move is clearly sideways; the gesture bar lives in
 * its own strip, so nothing in an app ever reaches it.
 */
export const GESTURE_PRIORITY = ["circle-seek", "voice-seek", "swipe-reply", "chat-scroll", "chat-swipe-back", "shell-gesture-bar"] as const;
export type GestureName = (typeof GESTURE_PRIORITY)[number];

/** The element (if any) under this target that owns its drags (a player, a seek bar, a carousel). */
export function ownedByChild(target: EventTarget | null): HTMLElement | null {
  return (target as HTMLElement | null)?.closest?.<HTMLElement>("[data-gesture-owner]") ?? null;
}

/** True when `mine` may start: nothing of a higher priority owns the touch. */
export function mayStart(mine: GestureName, target: EventTarget | null): boolean {
  const owner = ownedByChild(target);
  if (!owner) return true;
  const name = owner.getAttribute("data-gesture-owner") as GestureName | "" | null;
  // An unnamed owner (any player) outranks every gesture of the page.
  if (!name || !GESTURE_PRIORITY.includes(name)) return false;
  return GESTURE_PRIORITY.indexOf(name) > GESTURE_PRIORITY.indexOf(mine);
}
