import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { cx } from "@/lib/cx";

/**
 * Update 3 · E2: a row of tabs (chips) moved by the finger instead of native overflow scrolling. The row
 * is `overflow: hidden` (iOS never draws its scroll indicator, nothing scrolls by itself) and the finger
 * drives its scroll position; a flick glides on with the finger's speed. Keyboard focus and
 * `scrollIntoView` still reveal a tab (a hidden overflow still scrolls by script). The row owns its
 * horizontal drags (`data-gesture-owner`): the page's swipe back and the side drawer stay out of it. A
 * tap after a drag does not switch the tab. The active tab is brought into view.
 *
 * When everything fits (a PC window, a wide phone) nothing moves and, with `fill`, the tabs share the
 * whole width in one line.
 */
export function DragStrip({
  children,
  activeKey,
  fill = false,
  className,
  innerClassName,
  testId,
  label,
}: {
  children: ReactNode;
  /** `data-strip-key` of the active child: brought into view when it changes. */
  activeKey?: string;
  /** Tabs share the full width when they fit. */
  fill?: boolean;
  className?: string;
  innerClassName?: string;
  testId?: string;
  label?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [fits, setFits] = useState(true);
  const drag = useRef<{ id: number; x: number; y: number; left: number; engaged: boolean; samples: { x: number; t: number }[] } | null>(null);
  const moved = useRef(false);
  const glide = useRef(0);

  const stopGlide = () => cancelAnimationFrame(glide.current);
  /** Scrolls to `to` (clamped), gliding with an ease-out unless reduced motion. */
  const scrollTo = (to: number, ms = 320) => {
    const o = outer.current;
    if (!o) return;
    stopGlide();
    const max = o.scrollWidth - o.clientWidth;
    const target = Math.max(0, Math.min(max, to));
    if (reduced || Math.abs(target - o.scrollLeft) < 1) {
      o.scrollLeft = target;
      return;
    }
    const from = o.scrollLeft;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      o.scrollLeft = from + (target - from) * (1 - Math.pow(1 - k, 3));
      if (k < 1) glide.current = requestAnimationFrame(tick);
    };
    glide.current = requestAnimationFrame(tick);
  };

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => setFits(i.scrollWidth <= o.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);

  // The active tab comes into view (centred when possible).
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i || !activeKey || fits) return;
    const el = i.querySelector<HTMLElement>(`[data-strip-key="${CSS.escape(activeKey)}"]`);
    if (!el) return;
    scrollTo(el.offsetLeft + el.offsetWidth / 2 - o.clientWidth / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, fits]);

  useLayoutEffect(() => () => stopGlide(), []);

  return (
    <div
      ref={outer}
      className={cx("relative overflow-hidden", className)}
      // Vertical scrolling of the page stays native; the row takes the sideways moves.
      style={{ touchAction: "pan-y" }}
      data-gesture-owner=""
      data-strip-fits={fits || undefined}
      data-testid={testId}
      role="tablist"
      aria-label={label}
      onPointerDown={(e) => {
        if (fits || e.button !== 0) return;
        stopGlide();
        moved.current = false;
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, engaged: false, samples: [{ x: e.clientX, t: performance.now() }] };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        if (!d.engaged) {
          if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(e.clientY - d.y)) return;
          d.engaged = true;
          moved.current = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* synthetic pointer */
          }
        }
        e.currentTarget.scrollLeft = d.left - dx;
        const now = performance.now();
        d.samples.push({ x: e.clientX, t: now });
        while (d.samples.length > 2 && now - d.samples[0]!.t > 80) d.samples.shift();
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d?.engaged || d.id !== e.pointerId) return;
        // A flick glides on with the finger's speed (px/ms), slowing down.
        const f = d.samples[0]!;
        const l = d.samples[d.samples.length - 1]!;
        const v = performance.now() - l.t > 90 ? 0 : (l.x - f.x) / Math.max(1, l.t - f.t);
        if (Math.abs(v) > 0.15) scrollTo(e.currentTarget.scrollLeft - v * 260, 420);
      }}
      onPointerCancel={() => (drag.current = null)}
      onClickCapture={(e) => {
        // The tap that ends a drag is not a tab choice.
        if (moved.current) {
          e.stopPropagation();
          e.preventDefault();
          moved.current = false;
        }
      }}
    >
      <div ref={inner} className={cx("flex w-max min-w-full", fill && fits && "[&>*]:flex-1", innerClassName)}>
        {children}
      </div>
    </div>
  );
}
