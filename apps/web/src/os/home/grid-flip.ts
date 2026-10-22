import { useLayoutEffect, type RefObject } from "react";

/**
 * A2 / B3 / B7: animated reflow of the home grid after a deliberate change (a widget resized, removed,
 * taken out of a stack…). The caller takes a snapshot right BEFORE it changes the layout; once the
 * grid has rendered the new layout, everything that moved glides from where it was to its new cell
 * (transform only), and a widget card that changed size eases to it. Nothing is measured otherwise,
 * so ordinary renders and drags cost nothing. Reduced motion: no glide.
 */

interface Snapshot {
  at: number;
  cells: Map<string, DOMRect>;
  cards: Map<string, DOMRect>;
}

let snap: Snapshot | null = null;
const FRESH_MS = 800;
export const FLIP_MS = 280;
export const FLIP_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Call right before a layout change that should animate. */
export function captureGridFlip() {
  if (typeof document === "undefined" || reduced()) return;
  const cells = new Map<string, DOMRect>();
  const cards = new Map<string, DOMRect>();
  document.querySelectorAll<HTMLElement>("[data-home-grid] > [data-flip]").forEach((n) => {
    cells.set(n.dataset.flip!, n.getBoundingClientRect());
    const card = n.querySelector<HTMLElement>("[data-widget-card]");
    if (card) cards.set(n.dataset.flip!, card.getBoundingClientRect());
  });
  snap = { at: performance.now(), cells, cards };
}

/** Runs the glide in a grid after it rendered a layout change that was captured. */
export function useGridFlip(ref: RefObject<HTMLElement | null>, version: unknown) {
  useLayoutEffect(() => {
    const s = snap;
    const el = ref.current;
    if (!s || !el || performance.now() - s.at > FRESH_MS) return;
    let moved = false;
    el.querySelectorAll<HTMLElement>(":scope > [data-flip]").forEach((n) => {
      const key = n.dataset.flip!;
      const old = s.cells.get(key);
      if (!old) return;
      const now = n.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        moved = true;
        n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: FLIP_MS, easing: FLIP_EASE });
      }
      const card = n.querySelector<HTMLElement>("[data-widget-card]");
      const before = s.cards.get(key);
      if (card && before) {
        const after = card.getBoundingClientRect();
        if (Math.abs(after.width - before.width) > 0.5 || Math.abs(after.height - before.height) > 0.5) {
          moved = true;
          card.animate([{ width: `${before.width}px`, height: `${before.height}px` }, { width: `${after.width}px`, height: `${after.height}px` }], { duration: FLIP_MS, easing: FLIP_EASE });
        }
      }
    });
    if (moved) snap = null;
  }, [ref, version]);
}
