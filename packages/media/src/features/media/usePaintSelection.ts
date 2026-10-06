"use client";
import { useEffect, useRef } from "react";
import type React from "react";
import { paintRange } from "./selection";
export function usePaintSelection(
  ids: string[],
  selected: Set<string>,
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>,
  scroll: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const latest = useRef({ ids, selected, setSelected });
  latest.current = { ids, selected, setSelected };
  const drag = useRef<{
    anchor: number;
    end: number;
    base: Set<string>;
    remove: boolean;
    x: number;
    y: number;
    px: number;
    py: number;
    pointer: number;
    active: boolean;
  } | null>(null);
  const frame = useRef(0),
    suppress = useRef(0);
  function stop() {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    drag.current = null;
  }
  useEffect(() => {
    if (!enabled) stop();
    return stop;
  }, [enabled]);
  function hit(x: number, y: number) {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-media-id]");
    if (!el || !scroll.current?.contains(el)) return;
    const index = latest.current.ids.indexOf(el.dataset.mediaId || "");
    const d = drag.current;
    if (d && index >= 0) {
      d.end = index;
      latest.current.setSelected(paintRange(latest.current.ids, d.base, d.anchor, index, d.remove));
    }
  }
  function tick() {
    const d = drag.current,
      el = scroll.current;
    if (!d?.active || !el) return;
    const r = el.getBoundingClientRect();
    const dy = d.py < r.top + 48 ? -10 : d.py > r.bottom - 55 ? 10 : 0;
    if (dy) {
      el.scrollTop += dy;
      hit(d.px, Math.max(r.top + 8, Math.min(r.bottom - 8, d.py)));
    }
    frame.current = requestAnimationFrame(tick);
  }
  return {
    down(e: React.PointerEvent<HTMLButtonElement>, id: string) {
      if (!enabled || e.button !== 0) return;
      stop();
      suppress.current = 0;
      drag.current = {
        anchor: latest.current.ids.indexOf(id),
        end: 0,
        base: new Set(latest.current.selected),
        remove: latest.current.selected.has(id),
        x: e.clientX,
        y: e.clientY,
        px: e.clientX,
        py: e.clientY,
        pointer: e.pointerId,
        active: false,
      };
    },
    move(e: React.PointerEvent<HTMLButtonElement>) {
      const d = drag.current;
      if (!d || d.pointer !== e.pointerId) return;
      d.px = e.clientX;
      d.py = e.clientY;
      if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 9) {
        d.active = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        frame.current = requestAnimationFrame(tick);
      }
      if (d.active) {
        e.preventDefault();
        hit(e.clientX, e.clientY);
      }
    },
    end(e: React.PointerEvent<HTMLButtonElement>) {
      if (drag.current?.active) suppress.current = Date.now() + 500;
      stop();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    },
    cancel: stop,
    consumeClick() {
      if (suppress.current > Date.now()) {
        suppress.current = 0;
        return true;
      }
      return false;
    },
  };
}
