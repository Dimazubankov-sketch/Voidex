/**
 * B8: the phone home pager, reachable from widgets: a sideways swipe that starts on a widget still
 * turns the page (the widget keeps taps, its long press and its stack's vertical swipes).
 */
export interface PhonePager {
  move: (dx: number) => void;
  end: (dx: number, vx: number) => void;
}
export const phonePager: { current: PhonePager | null } = { current: null };
