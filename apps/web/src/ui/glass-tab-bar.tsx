import { useLayoutEffect, useRef, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { cx } from "@/lib/cx";

export interface GlassTab<K extends string> {
  key: K;
  /** Accessible name (and the small caption when `labels` is on). */
  label: string;
  /** The icon, given whether the tab is the active one. */
  icon: (active: boolean) => ReactNode;
  badge?: number;
  badgeTestId?: string;
  testId?: string;
}

/** The leading edge moves first (stiff), the trailing one follows (softer): the capsule stretches toward the new tab and settles. */
const LEAD = { type: "spring", stiffness: 520, damping: 42, mass: 0.9 } as const;
const TRAIL = { type: "spring", stiffness: 300, damping: 34, mass: 1 } as const;
/** Sideways travel (px) before a press on the bar becomes a swipe. */
const SWIPE_SLOP = 8;

/**
 * The system glass tab bar (Step 2.13 Vibex, Step 2.15 for every app with a
 * phone tab bar: Vibex, Clock). A floating, rounded bar of the system glass a
 * little above the bottom edge; the active tab sits in one capsule that
 * glides from tab to tab. Step 2.15: the bar can be swiped: the capsule
 * follows the finger along the bar and the tab under it is chosen when the
 * finger lifts; a tap still selects a tab directly.
 */
export function GlassTabBar<K extends string>({
  items,
  active,
  onSelect,
  ariaLabel,
  labels = false,
  testId,
  wrapTestId,
}: {
  items: GlassTab<K>[];
  active: K;
  onSelect: (key: K) => void;
  ariaLabel: string;
  /** Small captions under the icons (Clock); Vibex shows icons only. */
  labels?: boolean;
  testId?: string;
  wrapTestId?: string;
}) {
  const reduced = useReducedMotion();
  const bar = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<K, HTMLButtonElement>());
  const left = useMotionValue(0);
  const right = useMotionValue(0);
  const width = useTransform([left, right], ([l, r]) => Math.max(0, (r as number) - (l as number)));
  const placed = useRef(false);
  const lastIndex = useRef(items.findIndex((i) => i.key === active));
  const swipe = useRef<{ id: number; x: number; l: number; r: number; moving: boolean } | null>(null);
  const swiped = useRef(false);

  const edgesOf = (key: K) => {
    const el = buttons.current.get(key);
    const host = bar.current;
    if (!el || !host) return null;
    const b = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    return { l: b.left - h.left + 4, r: b.right - h.left - 4 };
  };

  useLayoutEffect(() => {
    const place = (animateIt: boolean) => {
      const e = edgesOf(active);
      if (!e) return;
      const index = items.findIndex((i) => i.key === active);
      if (!animateIt || reduced) {
        left.jump(e.l);
        right.jump(e.r);
      } else {
        const toRight = index > lastIndex.current;
        void animate(left, e.l, toRight ? TRAIL : LEAD);
        void animate(right, e.r, toRight ? LEAD : TRAIL);
      }
      lastIndex.current = index;
    };
    place(placed.current);
    placed.current = true;
    const ro = new ResizeObserver(() => place(false));
    if (bar.current) ro.observe(bar.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items, left, right, reduced]);

  /** The tab whose middle is nearest to a point along the bar. */
  const tabAt = (x: number): K => {
    let best = active;
    let dist = Infinity;
    for (const it of items) {
      const e = edgesOf(it.key);
      if (!e) continue;
      const d = Math.abs((e.l + e.r) / 2 - x);
      if (d < dist) {
        dist = d;
        best = it.key;
      }
    }
    return best;
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-2" data-testid={wrapTestId}>
      <nav
        ref={bar}
        role="tablist"
        aria-label={ariaLabel}
        className="vx-tabbar pointer-events-auto relative flex h-[60px] w-full max-w-[460px] touch-none select-none items-center rounded-full px-1"
        data-testid={testId}
        data-active={active}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          swiped.current = false;
          swipe.current = { id: e.pointerId, x: e.clientX, l: left.get(), r: right.get(), moving: false };
        }}
        onPointerMove={(e) => {
          const s = swipe.current;
          if (!s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x;
          if (!s.moving) {
            if (Math.abs(dx) < SWIPE_SLOP) return;
            s.moving = true;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* synthetic pointer */
            }
          }
          const w = s.r - s.l;
          const max = (bar.current?.clientWidth ?? 0) - w - 4;
          const l = Math.max(4, Math.min(max, s.l + dx));
          left.stop();
          right.stop();
          left.set(l);
          right.set(l + w);
        }}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s?.moving || s.id !== e.pointerId) return;
          swiped.current = true;
          const next = tabAt((left.get() + right.get()) / 2);
          if (next !== active) onSelect(next);
          else {
            // Back to the same tab: the capsule settles where it belongs.
            const edges = edgesOf(active);
            if (edges) {
              void animate(left, edges.l, LEAD);
              void animate(right, edges.r, LEAD);
            }
          }
        }}
        onPointerCancel={() => {
          const s = swipe.current;
          swipe.current = null;
          if (!s?.moving) return;
          const edges = edgesOf(active);
          if (edges) {
            void animate(left, edges.l, LEAD);
            void animate(right, edges.r, LEAD);
          }
        }}
        onClickCapture={(e) => {
          // The click at the end of a swipe is not a tap.
          if (swiped.current) {
            swiped.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <motion.span className="vx-tabbar-capsule pointer-events-none absolute top-[6px] h-[48px] rounded-full" style={{ left, width }} aria-hidden data-testid={testId ? `${testId}-capsule` : undefined} />
        {items.map((item) => {
          const on = item.key === active;
          return (
            <button
              key={item.key}
              ref={(el) => {
                if (el) buttons.current.set(item.key, el);
                else buttons.current.delete(item.key);
              }}
              type="button"
              role="tab"
              aria-selected={on}
              aria-current={on ? "page" : undefined}
              aria-label={item.label}
              onClick={() => onSelect(item.key)}
              className="relative flex h-full min-w-0 flex-1 items-center justify-center outline-none focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-primary/50"
              data-tab={item.key}
              data-testid={item.testId}
            >
              <span className={cx("relative flex items-center justify-center rounded-full", labels ? "h-11 w-full flex-col gap-0.5" : "size-11")}>
                <span className={cx("flex transition-colors duration-200", on ? "text-primary" : "text-text-secondary")}>{item.icon(on)}</span>
                {labels && <span className={cx("max-w-full truncate px-1 text-[10px] font-semibold leading-none", on ? "text-primary" : "text-text-secondary")}>{item.label}</span>}
                {(item.badge ?? 0) > 0 && (
                  <span
                    className="absolute -right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white ring-2 ring-[var(--vx-tabbar-ring)]"
                    data-testid={item.badgeTestId}
                  >
                    {item.badge! > 99 ? "99+" : item.badge}
                  </span>
                )}
              </span>
              {!labels && <span className="sr-only">{item.label}</span>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
