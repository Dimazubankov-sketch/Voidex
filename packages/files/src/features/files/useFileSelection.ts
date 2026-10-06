'use client';
import { useEffect, useRef } from 'react';
import type React from 'react';
export function paintRange(ids: readonly string[], base: ReadonlySet<string>, a: number, b: number, remove: boolean) {
  const next = new Set(base);
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
    const id = ids[i];
    if (id) remove ? next.delete(id) : next.add(id);
  }
  return next;
}
export function selectionDirection(dx: number, dy: number) {
  return Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3
    ? 'paint'
    : Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)
      ? 'scroll'
      : 'pending';
}
export function useFileSelection(
  ids: string[],
  selected: Set<string>,
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>,
  scroll: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const latest = useRef({ ids, selected, setSelected, enabled });
  latest.current = { ids, selected, setSelected, enabled };
  const drag = useRef<{
      anchor: number;
      base: Set<string>;
      remove: boolean;
      x: number;
      y: number;
      px: number;
      py: number;
      active: boolean;
      scrolling: boolean;
      pointer?: number;
    } | null>(null),
    frame = useRef(0),
    suppress = useRef(0);
  const stop = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    drag.current = null;
  };
  function begin(id: string, x: number, y: number, pointer?: number) {
    const index = latest.current.ids.indexOf(id);
    if (index < 0) return;
    stop();
    drag.current = {
      anchor: index,
      base: new Set(latest.current.selected),
      remove: latest.current.selected.has(id),
      x,
      y,
      px: x,
      py: y,
      active: false,
      scrolling: false,
      pointer,
    };
  }
  function hit(x: number, y: number) {
    const node = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-file-id]');
    const d = drag.current;
    if (!node || !d || !scroll.current?.contains(node)) return;
    const n = latest.current.ids.indexOf(node.dataset.fileId || '');
    if (n >= 0) latest.current.setSelected(paintRange(latest.current.ids, d.base, d.anchor, n, d.remove));
  }
  function tick() {
    const d = drag.current,
      el = scroll.current;
    if (!d?.active || !el) return;
    const r = el.getBoundingClientRect();
    const speed = d.py < r.top + 42 ? -9 : d.py > r.bottom - 42 ? 9 : 0;
    if (speed) {
      el.scrollTop += speed;
      hit(d.px, Math.max(r.top + 5, Math.min(r.bottom - 5, d.py)));
    }
    frame.current = requestAnimationFrame(tick);
  }
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const start = (e: TouchEvent) => {
      if (!latest.current.enabled || e.touches.length !== 1) return;
      const node = (e.target as HTMLElement).closest<HTMLElement>('[data-file-id]');
      if (node) {
        const t = e.touches[0]!;
        begin(node.dataset.fileId!, t.clientX, t.clientY);
      }
    };
    const move = (e: TouchEvent) => {
      const d = drag.current;
      if (!d || e.touches.length !== 1) return;
      const t = e.touches[0]!;
      d.px = t.clientX;
      d.py = t.clientY;
      if (!d.active && !d.scrolling) {
        const direction = selectionDirection(t.clientX - d.x, t.clientY - d.y);
        if (direction === 'scroll') {
          d.scrolling = true;
          return;
        }
        if (direction === 'paint') {
          d.active = true;
          frame.current = requestAnimationFrame(tick);
        }
      }
      if (d.active && e.cancelable) {
        e.preventDefault();
        hit(t.clientX, t.clientY);
      }
    };
    const end = () => {
      if (drag.current?.active || drag.current?.scrolling) suppress.current = Date.now() + 500;
      stop();
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      stop();
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [scroll]);
  useEffect(() => {
    if (!enabled) stop();
    return stop;
  }, [enabled]);
  return {
    down(e: React.PointerEvent<HTMLElement>, id: string) {
      if (enabled && e.pointerType !== 'touch' && e.button === 0) begin(id, e.clientX, e.clientY, e.pointerId);
    },
    move(e: React.PointerEvent<HTMLElement>) {
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
    end(e: React.PointerEvent<HTMLElement>) {
      if (e.pointerType === 'touch') return;
      if (drag.current?.active) suppress.current = Date.now() + 500;
      stop();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    },
    cancel() {
      stop();
    },
    consumeClick() {
      if (Date.now() < suppress.current) {
        suppress.current = 0;
        return true;
      }
      return false;
    },
  };
}
