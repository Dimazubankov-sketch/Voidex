import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { cx } from "@/lib/cx";

/**
 * Update 3 · E2: a row of tabs (chips) that is moved by the finger instead of native overflow scrolling:
 * iOS never draws its scroll indicator under it, and the row owns its horizontal drags
 * (`data-gesture-owner`): the page's swipe back and the side drawer stay out of it. A flick glides on with
 * the finger's speed; a tap after a drag does not switch the tab. The active tab is brought into view.
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
  const x = useMotionValue(0);
  const reduced = useReducedMotion();
  const [room, setRoom] = useState({ min: 0, fits: true });
  const moved = useRef(false);

  // How far the row may move (0 … -overflow); re-measured when either box changes size.
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const over = i.scrollWidth - o.clientWidth;
      const next = { min: Math.min(0, -over), fits: over <= 1 };
      setRoom((r) => (r.min === next.min && r.fits === next.fits ? r : next));
      if (x.get() < next.min) x.set(next.min);
      if (next.fits) x.set(0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [x]);

  // The active tab comes into view (centred when possible), gliding.
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i || !activeKey || room.fits) return;
    const el = i.querySelector<HTMLElement>(`[data-strip-key="${CSS.escape(activeKey)}"]`);
    if (!el) return;
    const want = Math.max(room.min, Math.min(0, o.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2)));
    if (Math.abs(want - x.get()) < 1) return;
    if (reduced) x.set(want);
    else void animate(x, want, { type: "spring", stiffness: 420, damping: 40 });
  }, [activeKey, room, x, reduced]);

  return (
    <div
      ref={outer}
      className={cx("relative overflow-hidden", className)}
      // Vertical scrolling of the page stays native; the row takes the sideways moves.
      style={{ touchAction: "pan-y" }}
      data-gesture-owner=""
      data-strip-fits={room.fits || undefined}
      data-testid={testId}
      role="tablist"
      aria-label={label}
      onClickCapture={(e) => {
        // The tap that ends a drag is not a tab choice.
        if (moved.current) {
          e.stopPropagation();
          e.preventDefault();
          moved.current = false;
        }
      }}
    >
      <motion.div
        ref={inner}
        className={cx("flex w-max min-w-full", fill && room.fits && "[&>*]:flex-1", innerClassName)}
        style={{ x }}
        drag={room.fits ? false : "x"}
        dragConstraints={{ left: room.min, right: 0 }}
        dragElastic={0.12}
        dragTransition={{ power: 0.28, timeConstant: 220, bounceStiffness: 420, bounceDamping: 38 }}
        dragDirectionLock
        onDragStart={() => (moved.current = true)}
        onDragEnd={() => window.setTimeout(() => (moved.current = false), 60)}
      >
        {children}
      </motion.div>
    </div>
  );
}
