/**
 * Swipe-to-reveal rows of Voidex Clock (ported from Voidex-Clock
 * dist/swipe.js). One delegated controller per list:
 *
 *   - a swipe to the left reveals the red trash button; nothing is deleted
 *     until that button is pressed;
 *   - a swipe to the right (or a tap on the row) closes it again;
 *   - a vertical move is a scroll: the row lets it go (8 px axis lock);
 *   - the click that ends a drag never reaches the row (350 ms);
 *   - keyboard: ArrowLeft / Delete open the row and focus the trash,
 *     Escape / ArrowRight close it.
 *
 * Markup: [data-swipe-row] > .swipe-delete (button) + .swipe-front.
 */

export const SWIPE_WIDTH = 86;
export const swipeShouldOpen = (offset: number, velocity = 0) => offset < -36 || velocity < -0.42;

interface Closest {
  closest(selector: string): unknown;
}
export interface SwipeRowElement {
  dataset: Record<string, string | undefined>;
  classList: { add(...v: string[]): void; remove(...v: string[]): void; toggle(v: string, on?: boolean): unknown };
  style: { setProperty(name: string, value: string): void };
  querySelector(selector: string): unknown;
}
interface Focusable {
  tabIndex: number;
  setAttribute(name: string, value: string): void;
  focus?(): void;
}
interface Capturer {
  setPointerCapture?(id: number): void;
  releasePointerCapture?(id: number): void;
}
export interface SwipeRoot {
  querySelectorAll(selector: string): ArrayLike<SwipeRowElement> | Iterable<SwipeRowElement>;
  addEventListener(type: string, fn: (event: never) => void, options?: AddEventListenerOptions | boolean): void;
}
interface SwipePointer {
  target: Closest;
  button?: number;
  pointerId: number;
  clientX: number;
  clientY: number;
  type?: string;
  preventDefault(): void;
}
interface SwipeKey {
  target: Closest;
  key: string;
  preventDefault(): void;
}
interface SwipeClick {
  target: Closest;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

const mounted = new WeakMap<SwipeRoot, AbortController>();
const now = () => globalThis.performance?.now?.() ?? Date.now();
const rowsOf = (root: SwipeRoot) => Array.from(root.querySelectorAll("[data-swipe-row]") as ArrayLike<SwipeRowElement>);

export function setSwipeOpen(row: SwipeRowElement, open: boolean) {
  row.dataset.swipeOpen = String(open);
  row.classList.toggle("swipe-open", open);
  row.classList.remove("swipe-revealing");
  row.style.setProperty("--swipe-offset", `${open ? -SWIPE_WIDTH : 0}px`);
  const button = row.querySelector(".swipe-delete") as Focusable | null;
  if (button) {
    button.tabIndex = open ? 0 : -1;
    button.setAttribute("aria-hidden", String(!open));
  }
}

/** Closes every open row of a list (another tab, a new row). */
export function closeSwipes(root: SwipeRoot) {
  for (const r of rowsOf(root)) if (r.dataset.swipeOpen === "true") setSwipeOpen(r, false);
}

export function mountSwipes(root: SwipeRoot): () => void {
  unmountSwipes(root);
  const controller = new AbortController();
  const signal = controller.signal;
  mounted.set(root, controller);
  let gesture: {
    row: SwipeRowElement;
    front: Capturer | null;
    x: number;
    y: number;
    base: number;
    lastX: number;
    lastTime: number;
    velocity: number;
    offset: number;
    active: boolean;
  } | null = null;
  let blockedRow: SwipeRowElement | null = null;
  let blockedUntil = 0;

  root.addEventListener(
    "pointerdown",
    (event: SwipePointer) => {
      if (event.button !== undefined && event.button !== 0) return;
      const row = event.target.closest("[data-swipe-row]") as SwipeRowElement | null;
      for (const r of rowsOf(root)) if (r !== row) setSwipeOpen(r, false);
      if (!row || event.target.closest(".swipe-delete")) return;
      const base = row.dataset.swipeOpen === "true" ? -SWIPE_WIDTH : 0;
      gesture = { row, front: row.querySelector(".swipe-front") as Capturer | null, x: event.clientX, y: event.clientY, base, lastX: event.clientX, lastTime: now(), velocity: 0, offset: base, active: false };
    },
    { signal },
  );

  root.addEventListener(
    "pointermove",
    (event: SwipePointer) => {
      if (!gesture) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.active) {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
          gesture = null;
          return;
        }
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        gesture.active = true;
        gesture.row.classList.add("swipe-dragging", "swipe-revealing");
        try {
          gesture.front?.setPointerCapture?.(event.pointerId);
        } catch {
          /* the pointer is already gone */
        }
      }
      event.preventDefault();
      const t = now();
      gesture.velocity = (event.clientX - gesture.lastX) / Math.max(1, t - gesture.lastTime);
      gesture.lastTime = t;
      gesture.lastX = event.clientX;
      gesture.offset = Math.max(-SWIPE_WIDTH, Math.min(0, gesture.base + dx));
      gesture.row.style.setProperty("--swipe-offset", `${gesture.offset}px`);
    },
    { signal, passive: false },
  );

  const finish = (event: SwipePointer) => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    g.row.classList.remove("swipe-dragging");
    if (!g.active) return;
    const velocity = now() - g.lastTime > 100 ? 0 : g.velocity;
    setSwipeOpen(g.row, event.type === "pointercancel" ? g.base < 0 : swipeShouldOpen(g.offset, velocity));
    blockedRow = g.row;
    blockedUntil = now() + 350;
    try {
      g.front?.releasePointerCapture?.(event.pointerId);
    } catch {
      /* already released */
    }
  };
  root.addEventListener("pointerup", finish, { signal });
  root.addEventListener("pointercancel", finish, { signal });

  root.addEventListener(
    "click",
    (event: SwipeClick) => {
      const row = event.target.closest("[data-swipe-row]") as SwipeRowElement | null;
      if (row && row === blockedRow && now() < blockedUntil && !event.target.closest(".swipe-delete")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (row?.dataset.swipeOpen === "true" && event.target.closest(".swipe-front")) {
        setSwipeOpen(row, false);
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { signal, capture: true },
  );

  root.addEventListener(
    "keydown",
    (event: SwipeKey) => {
      const row = event.target.closest("[data-swipe-row]") as SwipeRowElement | null;
      if (!row) return;
      // Keys typed into a field inside a row stay with the field.
      if (event.target.closest("input, textarea, select")) return;
      if (event.key === "ArrowLeft" || event.key === "Delete") {
        event.preventDefault();
        setSwipeOpen(row, true);
        (row.querySelector(".swipe-delete") as Focusable | null)?.focus?.();
      } else if (event.key === "Escape" || event.key === "ArrowRight") {
        if (row.dataset.swipeOpen !== "true") return;
        event.preventDefault();
        setSwipeOpen(row, false);
      }
    },
    { signal },
  );
  return () => unmountSwipes(root);
}

export function unmountSwipes(root: SwipeRoot) {
  mounted.get(root)?.abort();
  mounted.delete(root);
}
