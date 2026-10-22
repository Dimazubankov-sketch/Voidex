/**
 * A4 — the VOIDEX shell does not zoom by accident on touch screens.
 *
 * Pinching the page (or double-tapping, see `touch-action: manipulation` in index.css) used to magnify the
 * whole OS, with no obvious way back. Pictures, video circles, Media and the Notes canvas zoom with their own
 * two-finger handlers, which keep working: this only stops the browser's page zoom.
 *
 * Not touched: system accessibility (iOS Zoom, Android magnification, text size), Ctrl / ⌘ + / − and trackpad
 * zoom on computers, the viewport meta (no user-scalable=no). If the page is already zoomed in, pinching is
 * allowed so it can always be zoomed back out. Settings → Персонализация can turn page zoom back on for this
 * device; an element can opt in with `data-allow-page-zoom`.
 */
const KEY = "vx.pageZoom";

export function pageZoomAllowed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setPageZoomAllowed(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the default stays */
  }
}

function allowed(target: EventTarget | null): boolean {
  if (pageZoomAllowed()) return true;
  if ((window.visualViewport?.scale ?? 1) > 1.01) return true; // let it be zoomed back out
  return !!(target as Element | null)?.closest?.("[data-allow-page-zoom]");
}

let installed = false;

export function installZoomGuard() {
  if (installed || typeof window === "undefined") return;
  const touch = window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window;
  if (!touch) return;
  installed = true;
  // Safari's pinch events (iOS ignores user-scalable=no, so this is the way to keep the shell still).
  const stop = (e: Event) => {
    if (!allowed(e.target)) e.preventDefault();
  };
  document.addEventListener("gesturestart", stop, { passive: false, capture: true });
  document.addEventListener("gesturechange", stop, { passive: false, capture: true });
  // Chrome / Android and Safari alike: a two-finger move is never a page zoom. App pinch handlers still
  // receive the events (preventDefault does not stop propagation).
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1 && e.cancelable && !allowed(e.target)) e.preventDefault();
    },
    { passive: false, capture: true },
  );
}
